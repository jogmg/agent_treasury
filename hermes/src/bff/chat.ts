import type { Logger } from "pino";
import type { BffConfig } from "./config";
import { BffHttpError } from "./errors";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  reply: string;
  model: string | null;
  usage: Record<string, unknown> | null;
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const part of value) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function extractReply(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const body = data as {
    output_text?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    output?: Array<{ content?: unknown }>;
  };
  const outputText = extractText(body.output_text);
  if (outputText) return outputText;

  const choiceContent = body.choices?.[0]?.message?.content;
  const choiceText = extractText(choiceContent);
  if (choiceText) return choiceText;

  if (Array.isArray(body.output)) {
    const parts: string[] = [];
    for (const item of body.output) {
      const text = extractText(item?.content);
      if (text) parts.push(text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return null;
}

export async function requestHermesChat(options: {
  config: BffConfig;
  wallet: `0x${string}`;
  messages: ChatMessage[];
  conversationId?: string;
  idempotencyKey: string;
  system?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}): Promise<ChatResult> {
  const { config } = options;
  if (!config.hermesUserUrl || !config.hermesUserApiKey) {
    throw new BffHttpError(
      503,
      "chat_unconfigured",
      "Chat is not available yet. The read-only treasury tools are still available."
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  // Hermes follows the OpenAI Chat Completions shape: server-owned instructions
  // must be a `system` message, not a top-level `system` field. The latter is
  // ignored by the upstream router, which would silently drop the action format.
  const messages = options.system
    ? [
        { role: "system" as const, content: options.system },
        ...options.messages,
      ]
    : options.messages;
  const body: Record<string, unknown> = {
    messages,
    stream: false,
  };

  // A standalone User gateway may expose `/v1/chat/completions` instead of the
  // profile-scoped host-gateway route. Try the configured path first, then the
  // neutral OpenAI-compatible path on a route-level 404.
  const paths = [config.hermesUserChatPath];
  if (!paths.includes("/v1/chat/completions"))
    paths.push("/v1/chat/completions");

  let response: Response | null = null;
  let lastRouteError: unknown = null;
  for (const path of paths) {
    const url = new URL(path, `${config.hermesUserUrl}/`);
    try {
      const candidate = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.hermesUserApiKey}`,
          "x-hermes-session-key": `bff:${options.wallet.toLowerCase()}:${
            options.conversationId ?? "default"
          }`,
          "idempotency-key": options.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.chatTimeoutMs),
      });
      if (candidate.status === 404 && path !== paths[paths.length - 1]) {
        lastRouteError = new Error(`Hermes route ${path} was not found`);
        if (candidate.body)
          await candidate.body.cancel().catch(() => undefined);
        continue;
      }
      response = candidate;
      break;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        options.logger.warn(
          { wallet: options.wallet },
          "Chat request timed out"
        );
        throw new BffHttpError(
          504,
          "chat_timeout",
          "The request took too long. Try again."
        );
      }
      options.logger.error(
        { err: error, wallet: options.wallet },
        "Chat request failed"
      );
      throw new BffHttpError(
        502,
        "chat_upstream_error",
        "Chat is unavailable right now."
      );
    }
  }

  if (!response) {
    options.logger.error(
      { err: lastRouteError, wallet: options.wallet },
      "Chat route was not found"
    );
    throw new BffHttpError(
      502,
      "chat_upstream_error",
      "Chat is unavailable right now."
    );
  }

  const text = await response.text();
  if (!response.ok) {
    options.logger.error(
      {
        status: response.status,
        wallet: options.wallet,
        body: text.slice(0, 500),
      },
      "Chat request returned an error"
    );
    throw new BffHttpError(
      502,
      "chat_upstream_error",
      "The request failed. Try again."
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    options.logger.error(
      { wallet: options.wallet, body: text.slice(0, 500) },
      "Chat response was not JSON"
    );
    throw new BffHttpError(
      502,
      "chat_invalid_response",
      "The response could not be read."
    );
  }

  const reply = extractReply(data);
  if (!reply) {
    options.logger.error(
      { wallet: options.wallet, body: text.slice(0, 500) },
      "Chat response contained no text"
    );
    throw new BffHttpError(
      502,
      "chat_invalid_response",
      "The response was empty."
    );
  }

  const record = data as { model?: unknown; usage?: unknown };
  return {
    reply,
    model: typeof record.model === "string" ? record.model : null,
    usage:
      record.usage && typeof record.usage === "object"
        ? (record.usage as Record<string, unknown>)
        : null,
  };
}
