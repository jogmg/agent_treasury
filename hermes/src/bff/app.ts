import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import pino, { type Logger } from "pino";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { ACTIVITY_EVENT_TYPES } from "../abis";
import { createArcClient } from "../arc";
import { createPool, toJsonValue } from "../db";
import {
  createSessionToken,
  createSiweChallenge,
  NonceStore,
  parseCookies,
  verifySessionToken,
  verifySiweLogin,
  type VerifiedSession,
} from "./auth";
import { requestHermesChat, type ChatMessage, type ChatResult } from "./chat";
import { getCctpDestination } from "../cctp-destinations";
import type { BffConfig } from "./config";
import { BffHttpError, isBffHttpError } from "./errors";
import {
  ArcIntentChain,
  extractActionProposal,
  IntentService,
  INTENT_CHAT_SYSTEM_PROMPT,
  parseUsdcAmount,
  type BffIntentService,
  type CctpDepositProposal,
  type IntentDraftRequest,
} from "./intents";
import { IntentMaintenance } from "./maintenance";
import { RateLimiter } from "./rate-limit";
import { BffReadService, ReadUnavailableError, type BffReader } from "./read";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{2,}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const INTENT_ID_RE = /^int_[a-f0-9]{32}$/;
const CHAT_JOB_ID_RE = /^[0-9a-f-]{36}$/i;
const CHAT_JOB_TTL_MS = 5 * 60_000;
const MAX_CHAT_JOBS = 100;

interface ChatJob {
  id: string;
  wallet: `0x${string}`;
  idempotencyKey: string;
  status: "pending" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  result?: ChatResult & {
    intent?: unknown;
    cctpDeposit?: CctpDepositProposal;
    actionError?: string;
  };
  error?: { status: number; code: string; message: string };
}

const nonceBodySchema = z.object({
  address: z.string().regex(ADDRESS_RE),
});

const verifyBodySchema = z.object({
  message: z.string().min(1).max(12_000),
  signature: z.string().regex(SIGNATURE_RE),
});

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4_000),
      })
    )
    .min(1)
    .max(20),
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,100}$/)
    .optional(),
});

const depositIntentBodySchema = z.object({
  amount: z.string().min(1).max(40),
});

const withdrawIntentBase = {
  amount: z.string().min(1).max(40).optional(),
  all: z.boolean().optional(),
};

const withdrawIntentBodySchema = z
  .object(withdrawIntentBase)
  .refine((body) => (body.all === true) !== (typeof body.amount === "string"), {
    message: "Provide either an amount or all=true.",
  });

const cctpIntentBodySchema = z
  .object({
    ...withdrawIntentBase,
    destinationDomain: z.number().int().nonnegative(),
    mintRecipient: z.string().regex(ADDRESS_RE).optional(),
  })
  .refine((body) => (body.all === true) !== (typeof body.amount === "string"), {
    message: "Provide either an amount or all=true.",
  });

const intentTxBodySchema = z.object({
  txHash: z.string().regex(TX_RE),
});

export interface AuthedRequest extends Request {
  wallet?: `0x${string}`;
  session?: VerifiedSession;
}

export interface BffDeps {
  reader?: BffReader;
  intents?: BffIntentService;
  logger?: Logger;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface BffApp {
  app: express.Express;
  maintenance: IntentMaintenance;
  close: () => Promise<void>;
}

function requestWallet(req: Request): `0x${string}` {
  const wallet = (req as AuthedRequest).wallet;
  if (!wallet)
    throw new BffHttpError(401, "unauthorized", "Sign in with your wallet.");
  return wallet;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.status(status).json({ error: { code, message } });
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function sessionCookieOptions(config: BffConfig) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain,
    path: "/",
    maxAge: config.sessionTtlSeconds * 1000,
  } as const;
}

function clearSessionCookie(res: Response, config: BffConfig): void {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain,
    path: "/",
  });
}

function createLogger(config: BffConfig): Logger {
  return pino({
    level: config.hermes.logLevel,
    base: { service: "hermes-bff" },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
      ],
      censor: "[redacted]",
    },
  });
}

function totalChatCharacters(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

function parseActivityTypes(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const requested = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) return null;
  if (requested.length > ACTIVITY_EVENT_TYPES.size) return null;
  if (requested.some((entry) => !ACTIVITY_EVENT_TYPES.has(entry))) return null;
  return requested;
}

export function createBffApp(config: BffConfig, deps: BffDeps = {}): BffApp {
  const logger = deps.logger ?? createLogger(config);
  const now = deps.now ?? Date.now;
  // Only the default reader owns the Postgres pool. An injected reader (tests
  // or a host integration) is responsible for its own resources.
  const pool =
    !deps.reader && config.hermes.databaseUrl
      ? createPool(config.hermes)
      : null;
  const reader = deps.reader ?? new BffReadService(config.hermes, pool, logger);
  const publicClient = createArcClient(config.hermes);
  const intentChain = new ArcIntentChain(config.hermes, publicClient);
  const intents =
    deps.intents ?? new IntentService(config, pool, intentChain, logger, now);
  const maintenance = new IntentMaintenance({
    pool,
    chain: intentChain,
    logger,
  });
  const nonceStore = new NonceStore(config.nonceTtlSeconds * 1000, now);
  const nonceLimiter = new RateLimiter(
    config.nonceRateLimitPerMinute,
    60_000,
    now
  );
  const chatLimiter = new RateLimiter(
    config.chatRateLimitPerMinute,
    60_000,
    now
  );
  const intentLimiter = new RateLimiter(
    config.intentRateLimitPerMinute,
    60_000,
    now
  );
  const chatJobs = new Map<string, ChatJob>();
  const chatJobByKey = new Map<string, string>();

  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    // Sessions, balances, and activity must never be served from a stale cache.
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use((req, res, next) => {
    const origin = req.get("origin");
    res.setHeader("Vary", "Origin");
    if (origin) {
      if (!config.allowedOrigins.has(origin)) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendError(
            res,
            403,
            "origin_not_allowed",
            "This origin is not allowed."
          );
          return;
        }
      } else {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

    if (req.method === "OPTIONS") {
      if (origin && !config.allowedOrigins.has(origin)) {
        sendError(
          res,
          403,
          "origin_not_allowed",
          "This origin is not allowed."
        );
        return;
      }
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type,x-hermes-client,idempotency-key"
      );
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const startedAt = now();
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: now() - startedAt,
        },
        "request"
      );
    });
    next();
  });

  const readSession = (req: Request): VerifiedSession | null =>
    verifySessionToken(
      parseCookies(req.headers.cookie)[config.cookieName],
      config.sessionSecret,
      now()
    );

  const requireSession = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const session = readSession(req);
    if (!session) {
      clearSessionCookie(res, config);
      sendError(res, 401, "unauthorized", "Sign in with your wallet.");
      return;
    }
    (req as AuthedRequest).wallet = session.address;
    (req as AuthedRequest).session = session;
    next();
  };

  const requestIdempotencyKey = (req: Request): string | undefined => {
    const value = req.get("idempotency-key");
    return value && IDEMPOTENCY_RE.test(value) ? value : undefined;
  };

  const freshIntentId = (req: Request): string => {
    const id = String(req.params.id ?? "").toLowerCase();
    if (!INTENT_ID_RE.test(id)) {
      throw new BffHttpError(
        400,
        "invalid_request",
        "A valid draft id is required."
      );
    }
    return id;
  };

  const draftIntent = async (
    req: Request,
    res: Response,
    next: NextFunction,
    request: IntentDraftRequest
  ): Promise<void> => {
    try {
      const wallet = requestWallet(req);
      const limit = intentLimiter.consume(`intent:${wallet.toLowerCase()}`);
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfterSeconds));
        sendError(
          res,
          429,
          "rate_limited",
          "Too many drafts. Try again shortly."
        );
        return;
      }
      const result = await intents.create(
        wallet,
        request,
        requestIdempotencyKey(req)
      );
      res.status(result.created ? 201 : 200).json({ intent: result.intent });
    } catch (error) {
      next(error);
    }
  };

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "hermes-bff",
      readOnly: true,
      chatConfigured: Boolean(config.hermesUserUrl && config.hermesUserApiKey),
    });
  });

  app.get("/api/session", (req, res) => {
    const session = readSession(req);
    if (!session) {
      clearSessionCookie(res, config);
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      wallet: session.address,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/auth/logout", (_req, res) => {
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  app.post("/auth/siwe/nonce", (req, res) => {
    const limit = nonceLimiter.consume(`nonce:${clientIp(req)}`);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      sendError(
        res,
        429,
        "rate_limited",
        "Too many sign-in attempts. Try again shortly."
      );
      return;
    }

    const parsed = nonceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "A valid wallet address is required."
      );
      return;
    }

    try {
      const entry = nonceStore.issue(parsed.data.address as `0x${string}`);
      const challenge = createSiweChallenge({
        address: entry.address,
        publicOrigin: config.publicOrigin,
        chainId: config.hermes.network.chainId,
        nonce: entry.nonce,
        expiresAt: entry.expiresAt,
        now: now(),
      });
      res.json(challenge);
    } catch (error) {
      logger.warn({ err: error }, "could not create SIWE challenge");
      sendError(
        res,
        400,
        "invalid_address",
        "A valid wallet address is required."
      );
    }
  });

  app.post("/auth/siwe/verify", async (req, res) => {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "A SIWE message and signature are required."
      );
      return;
    }

    let parsedMessage: ReturnType<typeof parseSiweMessage>;
    try {
      parsedMessage = parseSiweMessage(parsed.data.message);
    } catch {
      sendError(
        res,
        401,
        "invalid_signature",
        "The sign-in message is incomplete."
      );
      return;
    }
    if (!parsedMessage.nonce) {
      sendError(
        res,
        401,
        "invalid_signature",
        "The sign-in message is incomplete."
      );
      return;
    }
    const nonce = nonceStore.consume(parsedMessage.nonce);
    if (!nonce) {
      sendError(
        res,
        401,
        "invalid_nonce",
        "The sign-in challenge is missing or expired."
      );
      return;
    }

    try {
      const address = await verifySiweLogin({
        client: publicClient,
        message: parsed.data.message,
        signature: parsed.data.signature as `0x${string}`,
        publicOrigin: config.publicOrigin,
        chainId: config.hermes.network.chainId,
        nonce,
        now: now(),
      });
      const session = createSessionToken(
        address,
        config.sessionSecret,
        config.sessionTtlSeconds,
        now()
      );
      res.cookie(
        config.cookieName,
        session.token,
        sessionCookieOptions(config)
      );
      res.json({
        authenticated: true,
        wallet: address,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      logger.warn({ err: error }, "SIWE verification failed");
      sendError(
        res,
        401,
        "invalid_signature",
        "The wallet signature could not be verified."
      );
    }
  });

  app.get("/api/config", requireSession, (_req, res) => {
    res.json(toJsonValue(reader.configResponse()));
  });

  app.get("/api/treasury", requireSession, async (req, res, next) => {
    try {
      const state = await reader.treasury(requestWallet(req));
      res.json(toJsonValue(state));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/activity", requireSession, async (req, res, next) => {
    try {
      const rawLimit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 30;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
        : 30;
      const types = parseActivityTypes(req.query.types);
      if (req.query.types !== undefined && types === null) {
        sendError(res, 400, "invalid_request", "Unknown activity type filter.");
        return;
      }
      const result = await reader.activity(
        requestWallet(req),
        limit,
        types ?? undefined
      );
      res.json(toJsonValue(result));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cctp/:burnTx", requireSession, async (req, res, next) => {
    const burnTx = String(req.params.burnTx ?? "").toLowerCase();
    if (!TX_RE.test(burnTx)) {
      sendError(
        res,
        400,
        "invalid_request",
        "A valid burn transaction hash is required."
      );
      return;
    }
    try {
      res.json(toJsonValue(await reader.cctp(burnTx)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/transfers", requireSession, async (req, res, next) => {
    const burnTx =
      typeof req.query.burnTx === "string"
        ? req.query.burnTx.toLowerCase()
        : "";
    if (!TX_RE.test(burnTx)) {
      sendError(
        res,
        400,
        "invalid_request",
        "A valid burn transaction hash is required."
      );
      return;
    }
    try {
      res.json(
        toJsonValue({
          transfers: await reader.transfers(burnTx, requestWallet(req)),
        })
      );
    } catch (error) {
      if (error instanceof ReadUnavailableError) {
        sendError(res, 503, "db_unavailable", error.message);
        return;
      }
      next(error);
    }
  });

  app.post("/api/intents/deposit", requireSession, async (req, res, next) => {
    const parsed = depositIntentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Enter a USDC deposit amount.");
      return;
    }
    await draftIntent(req, res, next, {
      kind: "deposit",
      amount: parsed.data.amount,
    });
  });

  app.post(
    "/api/intents/withdraw-local",
    requireSession,
    async (req, res, next) => {
      const parsed = withdrawIntentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          "invalid_request",
          "Enter an amount or request all funds."
        );
        return;
      }
      await draftIntent(req, res, next, {
        kind: "withdrawLocal",
        amount: parsed.data.amount,
        all: parsed.data.all,
      });
    }
  );

  app.post(
    "/api/intents/cctp-withdraw",
    requireSession,
    async (req, res, next) => {
      const parsed = cctpIntentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          "invalid_request",
          "Enter an amount and a supported destination."
        );
        return;
      }
      await draftIntent(req, res, next, {
        kind: "cctpWithdraw",
        amount: parsed.data.amount,
        all: parsed.data.all,
        destinationDomain: parsed.data.destinationDomain,
        mintRecipient: parsed.data.mintRecipient,
      });
    }
  );

  app.get("/api/intents/:id", requireSession, async (req, res, next) => {
    try {
      const wallet = requestWallet(req);
      res.json({ intent: await intents.get(freshIntentId(req), wallet) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/intents/:id/tx", requireSession, async (req, res, next) => {
    try {
      const wallet = requestWallet(req);
      const id = freshIntentId(req);
      const parsed = intentTxBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          "invalid_request",
          "A valid transaction hash is required."
        );
        return;
      }
      res.json({
        intent: await intents.submit(
          id,
          wallet,
          parsed.data.txHash.toLowerCase()
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat", requireSession, async (req, res) => {
    const wallet = requestWallet(req);
    const limit = chatLimiter.consume(`chat:${wallet.toLowerCase()}`);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      sendError(
        res,
        429,
        "rate_limited",
        "Too many chat messages. Try again shortly."
      );
      return;
    }

    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "Send one to twenty chat messages."
      );
      return;
    }
    const messages = parsed.data.messages as ChatMessage[];
    if (messages[messages.length - 1]?.role !== "user") {
      sendError(
        res,
        400,
        "invalid_request",
        "The last chat message must be from the user."
      );
      return;
    }
    if (totalChatCharacters(messages) > 12_000) {
      sendError(res, 400, "invalid_request", "The chat context is too large.");
      return;
    }

    const headerKey = req.get("idempotency-key");
    const idempotencyKey =
      headerKey && IDEMPOTENCY_RE.test(headerKey) ? headerKey : randomUUID();

    const jobKey = `${wallet.toLowerCase()}:${idempotencyKey}`;
    const existingJobId = chatJobByKey.get(jobKey);
    const existingJob = existingJobId ? chatJobs.get(existingJobId) : undefined;
    if (existingJob && now() - existingJob.updatedAt < CHAT_JOB_TTL_MS) {
      res
        .status(202)
        .json({ jobId: existingJob.id, status: existingJob.status });
      return;
    }

    for (const [id, job] of chatJobs) {
      if (
        job.status !== "pending" &&
        now() - job.updatedAt >= CHAT_JOB_TTL_MS
      ) {
        chatJobs.delete(id);
        chatJobByKey.delete(
          `${job.wallet.toLowerCase()}:${job.idempotencyKey}`
        );
      }
    }
    if (chatJobs.size >= MAX_CHAT_JOBS) {
      sendError(
        res,
        503,
        "chat_busy",
        "The tool is busy right now. Try again shortly."
      );
      return;
    }

    const job: ChatJob = {
      id: randomUUID(),
      wallet,
      idempotencyKey,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    };
    chatJobs.set(job.id, job);
    chatJobByKey.set(jobKey, job.id);
    res.status(202).json({ jobId: job.id, status: job.status });

    void (async () => {
      try {
        const result = await requestHermesChat({
          config,
          wallet,
          messages,
          conversationId: parsed.data.conversationId,
          idempotencyKey,
          system: INTENT_CHAT_SYSTEM_PROMPT,
          logger,
          fetchImpl: deps.fetchImpl,
        });
        const action = extractActionProposal(result.reply);
        const fallbackReply = action.proposal
          ? "I prepared an unsigned draft for you to review."
          : "I could not validate that draft. Ask again with the amount and destination.";
        const reply = action.reply || fallbackReply;
        let response: ChatJob["result"] = action.error
          ? { ...result, reply, actionError: action.error }
          : { ...result, reply };

        if (!action.error && action.proposal) {
          try {
            if (action.proposal.kind === "cctpDeposit") {
              if (
                !getCctpDestination(config.hermes, action.proposal.sourceDomain)
              ) {
                throw new BffHttpError(
                  400,
                  "invalid_source",
                  "Choose a supported CCTP source chain."
                );
              }
              parseUsdcAmount(action.proposal.amount);
              response = { ...result, reply, cctpDeposit: action.proposal };
            } else {
              const created = await intents.create(
                wallet,
                action.proposal,
                `chat:${idempotencyKey}`
              );
              response = { ...result, reply, intent: created.intent };
            }
          } catch (error) {
            const actionError =
              isBffHttpError(error) && error.status < 500
                ? error.message
                : "Drafting is unavailable right now. You can still ask about your treasury.";
            logger.warn(
              { err: error, wallet, intentKind: action.proposal.kind },
              "chat action could not be drafted"
            );
            response = {
              ...result,
              reply:
                action.reply ||
                "I could not prepare that draft. Ask again in a moment.",
              actionError,
            };
          }
        }

        job.result = response;
        job.status = "completed";
        job.updatedAt = now();
      } catch (error) {
        const failure = isBffHttpError(error)
          ? { status: error.status, code: error.code, message: error.message }
          : {
              status: 502,
              code: "chat_upstream_error",
              message: "The tool is unavailable right now. Try again.",
            };
        job.error = failure;
        job.status = "failed";
        job.updatedAt = now();
        logger.warn(
          { wallet, code: failure.code, status: failure.status },
          "chat job failed"
        );
      }
    })();
  });

  app.get("/api/chat/jobs/:id", requireSession, (req, res) => {
    const id = String(req.params.id ?? "").toLowerCase();
    if (!CHAT_JOB_ID_RE.test(id)) {
      sendError(
        res,
        400,
        "invalid_request",
        "A valid chat job id is required."
      );
      return;
    }
    const job = chatJobs.get(id);
    if (!job || job.wallet.toLowerCase() !== requestWallet(req).toLowerCase()) {
      sendError(res, 404, "chat_job_not_found", "Chat response not found.");
      return;
    }
    if (job.status === "pending") {
      res.status(202).json({ status: job.status });
      return;
    }
    if (job.status === "failed") {
      sendError(
        res,
        job.error?.status ?? 502,
        job.error?.code ?? "chat_failed",
        job.error?.message ?? "The tool is unavailable right now."
      );
      return;
    }
    res.json({ status: job.status, response: job.result });
  });

  app.use((_req, res) => {
    sendError(res, 404, "not_found", "Not found.");
  });

  app.use(
    (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        sendError(
          res,
          400,
          "invalid_json",
          "The request body is not valid JSON."
        );
        return;
      }
      if (isBffHttpError(error)) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      logger.error({ err: error }, "unhandled BFF error");
      sendError(res, 500, "internal_error", "Unexpected server error.");
    }
  );

  return {
    app,
    maintenance,
    close: async () => {
      maintenance.stop();
      await reader.close();
    },
  };
}
