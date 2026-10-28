import { getAddress, type PublicClient } from "viem";
import {
  createSiweMessage,
  generateSiweNonce,
  parseSiweMessage,
  verifySiweMessage,
} from "viem/siwe";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface NonceEntry {
  address: `0x${string}`;
  nonce: string;
  expiresAt: number;
}

export class NonceStore {
  private readonly entries = new Map<string, NonceEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  issue(address: `0x${string}`): NonceEntry {
    this.cleanup();
    const entry = {
      address: getAddress(address),
      nonce: generateSiweNonce(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.entries.set(entry.nonce, entry);
    return entry;
  }

  consume(nonce: string): NonceEntry | null {
    this.cleanup();
    const entry = this.entries.get(nonce);
    if (!entry) return null;
    this.entries.delete(nonce);
    return entry.expiresAt > this.now() ? entry : null;
  }

  cleanup(): void {
    const now = this.now();
    for (const [nonce, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(nonce);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface SessionPayload {
  v: 1;
  address: `0x${string}`;
  iat: number;
  exp: number;
}

export interface VerifiedSession extends SessionPayload {
  expiresAt: string;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(
  address: `0x${string}`,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now()
): { token: string; payload: SessionPayload; expiresAt: string } {
  const payload: SessionPayload = {
    v: 1,
    address: getAddress(address),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  const token = `${body}.${signBody(body, secret)}`;
  return {
    token,
    payload,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now()
): VerifiedSession | null {
  if (!token) return null;
  const split = token.indexOf(".");
  if (split <= 0 || split === token.length - 1) return null;
  const body = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = signBody(body, secret);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Partial<SessionPayload>;
  if (payload.v !== 1) return null;
  if (typeof payload.address !== "string") return null;
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number")
    return null;
  const nowSeconds = Math.floor(now / 1000);
  if (payload.exp <= nowSeconds) return null;
  if (payload.iat > nowSeconds + 60) return null;
  try {
    const address = getAddress(payload.address);
    return {
      v: 1,
      address,
      iat: payload.iat,
      exp: payload.exp,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

export function parseCookies(
  header: string | undefined
): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

export interface SiweChallenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export function createSiweChallenge(options: {
  address: `0x${string}`;
  publicOrigin: string;
  chainId: number;
  nonce: string;
  expiresAt: number;
  now?: number;
}): SiweChallenge {
  const now = options.now ?? Date.now();
  const origin = new URL(options.publicOrigin);
  const issuedAt = new Date(now);
  const expirationTime = new Date(options.expiresAt);
  const message = createSiweMessage({
    address: getAddress(options.address),
    chainId: options.chainId,
    domain: origin.host,
    uri: origin.origin,
    version: "1",
    nonce: options.nonce,
    issuedAt,
    expirationTime,
    statement: "Sign in to Glimmerlock. This request does not move funds.",
  });
  return {
    message,
    nonce: options.nonce,
    expiresAt: expirationTime.toISOString(),
  };
}

export async function verifySiweLogin(options: {
  client: PublicClient;
  message: string;
  signature: `0x${string}`;
  publicOrigin: string;
  chainId: number;
  nonce: NonceEntry;
  now?: number;
}): Promise<`0x${string}`> {
  const now = options.now ?? Date.now();
  const parsed = parseSiweMessage(options.message);
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.uri) {
    throw new Error("The SIWE message is incomplete.");
  }
  const address = getAddress(parsed.address);
  if (address !== options.nonce.address) {
    throw new Error("The SIWE address does not match the nonce request.");
  }
  if (parsed.chainId !== options.chainId) {
    throw new Error("The SIWE chain does not match the active Arc network.");
  }
  const origin = new URL(options.publicOrigin);
  if (parsed.domain !== origin.host) {
    throw new Error("The SIWE domain does not match this application.");
  }
  if (parsed.uri !== origin.origin) {
    throw new Error("The SIWE URI does not match this application.");
  }
  if (parsed.nonce !== options.nonce.nonce) {
    throw new Error("The SIWE nonce does not match the challenge.");
  }

  const valid = await verifySiweMessage(options.client, {
    address,
    domain: origin.host,
    nonce: options.nonce.nonce,
    message: options.message,
    signature: options.signature,
    time: new Date(now),
  });
  if (!valid) throw new Error("The SIWE signature is invalid.");
  return address;
}
