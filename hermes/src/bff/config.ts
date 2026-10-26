import { z } from "zod";
import { loadConfig, type HermesConfig } from "../config";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalBoolean = z.preprocess(
  emptyToUndefined,
  z.enum(["true", "false"]).optional()
);

const envSchema = z.object({
  BFF_HOST: optionalString,
  BFF_PORT: z.coerce.number().int().positive().default(8789),
  BFF_PUBLIC_ORIGIN: optionalUrl,
  BFF_ALLOWED_ORIGINS: optionalString,
  BFF_SESSION_SECRET: optionalString,
  BFF_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  BFF_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  BFF_COOKIE_NAME: optionalString,
  BFF_COOKIE_SECURE: optionalBoolean,
  BFF_COOKIE_SAMESITE: z.preprocess(
    emptyToUndefined,
    z.enum(["lax", "strict", "none"]).optional()
  ),
  BFF_COOKIE_DOMAIN: optionalString,
  BFF_TRUST_PROXY: optionalBoolean,
  BFF_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  BFF_CHAT_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
  BFF_NONCE_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  BFF_INTENT_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(12),
  BFF_INTENT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  BFF_INTENT_MAINTENANCE_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60),
  HERMES_USER_URL: optionalUrl,
  HERMES_USER_API_KEY: optionalString,
  HERMES_USER_CHAT_PATH: optionalString,
});

export type CookieSameSite = "lax" | "strict" | "none";

export interface BffConfig {
  hermes: HermesConfig;
  host: string;
  port: number;
  publicOrigin: string;
  allowedOrigins: Set<string>;
  sessionSecret: string;
  sessionTtlSeconds: number;
  nonceTtlSeconds: number;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  cookieDomain: string | undefined;
  trustProxy: boolean;
  chatTimeoutMs: number;
  chatRateLimitPerMinute: number;
  nonceRateLimitPerMinute: number;
  intentRateLimitPerMinute: number;
  intentTtlSeconds: number;
  intentMaintenanceSeconds: number;
  hermesUserUrl: string | undefined;
  hermesUserApiKey: string | undefined;
  hermesUserChatPath: string;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "BFF_PUBLIC_ORIGIN must be an origin without a path, query, or hash"
    );
  }
  return url.origin;
}

function parseOrigins(
  value: string | undefined,
  fallback: string
): Set<string> {
  const raw = (value ?? fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (raw.length === 0)
    throw new Error("BFF_ALLOWED_ORIGINS must contain at least one origin");
  return new Set(raw.map(normalizeOrigin));
}

function validateSessionSecret(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "BFF_SESSION_SECRET is required. Generate one with: openssl rand -hex 32"
    );
  }
  if (value.length < 32 || value.startsWith("replace-with-")) {
    throw new Error("BFF_SESSION_SECRET must be at least 32 random characters");
  }
  return value;
}

export function loadBffConfig(env: NodeJS.ProcessEnv = process.env): BffConfig {
  const parsed = envSchema.parse(env);
  const hermes = loadConfig(env);
  const production = env.NODE_ENV === "production";
  if (production && !parsed.BFF_PUBLIC_ORIGIN) {
    throw new Error("BFF_PUBLIC_ORIGIN is required in production");
  }
  const publicOrigin = normalizeOrigin(
    parsed.BFF_PUBLIC_ORIGIN ?? "http://localhost:5173"
  );
  if (production && !publicOrigin.startsWith("https://")) {
    throw new Error("BFF_PUBLIC_ORIGIN must use https in production");
  }
  const allowedOrigins = parseOrigins(parsed.BFF_ALLOWED_ORIGINS, publicOrigin);
  const sessionSecret = validateSessionSecret(parsed.BFF_SESSION_SECRET);
  const hermesUserApiKey = parsed.HERMES_USER_API_KEY?.startsWith(
    "replace-with-"
  )
    ? undefined
    : parsed.HERMES_USER_API_KEY;

  if (parsed.HERMES_USER_URL && !hermesUserApiKey) {
    throw new Error(
      "HERMES_USER_API_KEY is required when HERMES_USER_URL is configured"
    );
  }
  if (!parsed.HERMES_USER_URL && hermesUserApiKey) {
    throw new Error(
      "HERMES_USER_URL is required when HERMES_USER_API_KEY is configured"
    );
  }

  const chatPath =
    parsed.HERMES_USER_CHAT_PATH ?? "/p/user/v1/chat/completions";
  if (
    !chatPath.startsWith("/") ||
    chatPath.startsWith("//") ||
    chatPath.includes("\\")
  ) {
    throw new Error(
      "HERMES_USER_CHAT_PATH must be a same-origin absolute path"
    );
  }

  const sameSite = parsed.BFF_COOKIE_SAMESITE ?? "lax";
  const cookieSecure = parsed.BFF_COOKIE_SECURE
    ? parsed.BFF_COOKIE_SECURE === "true"
    : production || sameSite === "none";
  if (production && !cookieSecure) {
    throw new Error("BFF_COOKIE_SECURE must be true in production");
  }
  if (sameSite === "none" && !cookieSecure) {
    throw new Error(
      "BFF_COOKIE_SECURE must be true when BFF_COOKIE_SAMESITE is none"
    );
  }

  return {
    hermes,
    host: parsed.BFF_HOST ?? "127.0.0.1",
    port: parsed.BFF_PORT,
    publicOrigin,
    allowedOrigins,
    sessionSecret,
    sessionTtlSeconds: parsed.BFF_SESSION_TTL_SECONDS,
    nonceTtlSeconds: parsed.BFF_NONCE_TTL_SECONDS,
    cookieName: parsed.BFF_COOKIE_NAME ?? "at_hermes_session",
    cookieSecure,
    cookieSameSite: sameSite,
    cookieDomain: parsed.BFF_COOKIE_DOMAIN,
    trustProxy: parsed.BFF_TRUST_PROXY === "true",
    chatTimeoutMs: parsed.BFF_CHAT_TIMEOUT_MS,
    chatRateLimitPerMinute: parsed.BFF_CHAT_RATE_LIMIT_PER_MINUTE,
    nonceRateLimitPerMinute: parsed.BFF_NONCE_RATE_LIMIT_PER_MINUTE,
    intentRateLimitPerMinute: parsed.BFF_INTENT_RATE_LIMIT_PER_MINUTE,
    intentTtlSeconds: parsed.BFF_INTENT_TTL_SECONDS,
    intentMaintenanceSeconds: parsed.BFF_INTENT_MAINTENANCE_SECONDS,
    hermesUserUrl: parsed.HERMES_USER_URL?.replace(/\/$/, ""),
    hermesUserApiKey,
    hermesUserChatPath: chatPath,
  };
}
