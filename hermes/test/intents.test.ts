import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pino from "pino";
import { decodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TREASURY_ABI } from "../src/abis";
import { loadBffConfig } from "../src/bff/config";
import {
  extractActionProposal,
  IntentService,
  MAX_U256,
  parseUsdcAmount,
  type IntentChain,
  type IntentChainState,
} from "../src/bff/intents";
import type { DbPool } from "../src/db";

const migrations = ["001_init.sql", "002_intents.sql"]
  .map((file) =>
    readFileSync(
      fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)),
      "utf8"
    )
  )
  .join("\n");

const db = new PGlite();
await db.exec(migrations);

const account = privateKeyToAccount(generatePrivateKey());
const now = Date.parse("2026-10-24T12:00:00.000Z");
const logger = pino({ level: "silent" });

const config = loadBffConfig({
  BFF_SESSION_SECRET: "s".repeat(64),
  BFF_PUBLIC_ORIGIN: "http://localhost:5173",
  BFF_COOKIE_SECURE: "false",
  BFF_INTENT_TTL_SECONDS: "900",
});

const baseState: IntentChainState = {
  paused: false,
  walletUsdc: 100_000_000n,
  treasuryTotal: 20_000_000n,
  allowance: 0n,
  minDeposit: 5_000_000n,
};

function fakeChain(overrides: Partial<IntentChainState> = {}): IntentChain {
  return {
    readState: vi.fn(async () => ({ ...baseState, ...overrides })),
    simulateDeposit: vi.fn(async () => {}),
    simulateWithdrawLocal: vi.fn(async () => {}),
    simulateCctpWithdraw: vi.fn(async () => {}),
  };
}

function service(chain: IntentChain, timestamp = now): IntentService {
  return new IntentService(
    config,
    db as unknown as DbPool,
    chain,
    logger,
    () => timestamp
  );
}

function decoded(intent: { data: string }) {
  return decodeFunctionData({
    abi: TREASURY_ABI,
    data: intent.data as `0x${string}`,
  });
}

beforeEach(async () => {
  await db.query("delete from intents");
  await db.query("delete from audit_events");
});

afterAll(async () => {
  await db.close();
});

describe("intent amount parsing", () => {
  it("parses USDC decimals exactly and rejects bad input", () => {
    expect(parseUsdcAmount("5")).toBe(5_000_000n);
    expect(parseUsdcAmount("5.000001")).toBe(5_000_001n);
    expect(() => parseUsdcAmount("1.0000001")).toThrow(/6 decimal/);
    expect(() => parseUsdcAmount("0")).toThrow(/greater than zero/);
    expect(() => parseUsdcAmount("1e3")).toThrow(/USDC amount/i);
  });
});

describe("IntentService", () => {
  it("creates a deposit draft with a server-derived call and approval warning", async () => {
    const chain = fakeChain({ allowance: 0n });
    const result = await service(chain).create(account.address, {
      kind: "deposit",
      amount: "25",
    });

    expect(result.created).toBe(true);
    expect(result.intent).toMatchObject({
      wallet: account.address.toLowerCase(),
      kind: "deposit",
      chainId: 5042,
      to: "0xf71b5d1a19d72b98675785123fae811698be6f63",
      value: "0",
      amount: "25000000",
      status: "draft",
      simulation: { ok: true, warning: "approval_required" },
    });
    expect(result.intent.mintRecipient).toBeNull();
    expect(decoded(result.intent)).toMatchObject({
      functionName: "deposit",
      args: [25_000_000n],
    });
    // The allowance check is a warning; the deposit is not simulated until approve.
    expect(chain.simulateDeposit).not.toHaveBeenCalled();
    expect(chain.simulateWithdrawLocal).not.toHaveBeenCalled();
  });

  it("rejects deposits below the on-chain minimum without writing a row", async () => {
    const chain = fakeChain();
    await expect(
      service(chain).create(account.address, { kind: "deposit", amount: "3" })
    ).rejects.toMatchObject({ status: 400, code: "below_minimum" });

    const rows = await db.query("select count(*)::int as count from intents");
    expect((rows.rows[0] as { count: number }).count).toBe(0);
  });

  it("creates a CCTP draft for an allowlisted domain and wallet recipient", async () => {
    const chain = fakeChain();
    const result = await service(chain).create(account.address, {
      kind: "cctpWithdraw",
      amount: "10",
      destinationDomain: 6,
    });

    expect(result.intent).toMatchObject({
      kind: "cctpWithdraw",
      amount: "10000000",
      destinationDomain: 6,
      mintRecipient: account.address,
      simulation: { ok: true },
    });
    expect(chain.simulateCctpWithdraw).toHaveBeenCalledTimes(1);
    expect(decoded(result.intent)).toMatchObject({
      functionName: "requestWithdrawal",
      args: [
        account.address,
        10_000_000n,
        6,
        `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`,
      ],
    });
  });

  it("rejects withdraw-all for a cross-chain draft", async () => {
    const chain = fakeChain();
    await expect(
      service(chain).create(account.address, {
        kind: "cctpWithdraw",
        all: true,
        destinationDomain: 6,
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects Arc and unknown CCTP destinations, and invalid recipients", async () => {
    const chain = fakeChain();
    await expect(
      service(chain).create(account.address, {
        kind: "cctpWithdraw",
        amount: "10",
        destinationDomain: 26,
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_destination" });

    await expect(
      service(chain).create(account.address, {
        kind: "cctpWithdraw",
        amount: "10",
        destinationDomain: 999,
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_destination" });

    await expect(
      service(chain).create(account.address, {
        kind: "cctpWithdraw",
        amount: "10",
        destinationDomain: 6,
        mintRecipient: "0xnot-an-address",
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_recipient" });
  });

  it("stores withdraw-all with the max sentinel and the resolved balance", async () => {
    const chain = fakeChain({ treasuryTotal: 12_345_678n });
    const result = await service(chain).create(account.address, {
      kind: "withdrawLocal",
      all: true,
    });

    expect(result.intent).toMatchObject({
      kind: "withdrawLocal",
      amount: "12345678",
      isMax: true,
    });
    expect(decoded(result.intent)).toMatchObject({
      functionName: "withdrawLocal",
      args: [MAX_U256],
    });
  });

  it("rejects an amount combined with all for a local withdrawal", async () => {
    await expect(
      service(fakeChain()).create(account.address, {
        kind: "withdrawLocal",
        all: true,
        amount: "10",
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("treats all and an explicit amount as different idempotent requests", async () => {
    const chain = fakeChain({ treasuryTotal: 10_000_000n });
    const svc = service(chain);
    const first = await svc.create(
      account.address,
      { kind: "withdrawLocal", all: true },
      "idem-max"
    );
    expect(first.intent.amount).toBe("10000000");

    await expect(
      svc.create(
        account.address,
        { kind: "withdrawLocal", amount: "10" },
        "idem-max"
      )
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("replays a stored withdraw-all draft without re-reading chain state", async () => {
    const chain = fakeChain({ treasuryTotal: 10_000_000n });
    const svc = service(chain);
    const first = await svc.create(
      account.address,
      { kind: "withdrawLocal", all: true },
      "idem-max-replay"
    );

    const replay = await svc.create(
      account.address,
      { kind: "withdrawLocal", all: true },
      "idem-max-replay"
    );

    expect(replay.created).toBe(false);
    expect(replay.intent.id).toBe(first.intent.id);
    expect(replay.intent.amount).toBe("10000000");
    expect(chain.readState).toHaveBeenCalledTimes(1);
  });

  it("replays the same idempotency key and rejects a different request", async () => {
    const chain = fakeChain();
    const svc = service(chain);
    const first = await svc.create(
      account.address,
      { kind: "deposit", amount: "25" },
      "idem-1"
    );
    const replay = await svc.create(
      account.address,
      { kind: "deposit", amount: "25" },
      "idem-1"
    );

    expect(replay.created).toBe(false);
    expect(replay.intent.id).toBe(first.intent.id);

    await expect(
      svc.create(account.address, { kind: "deposit", amount: "30" }, "idem-1")
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });

    const rows = await db.query("select count(*)::int as count from intents");
    expect((rows.rows[0] as { count: number }).count).toBe(1);
  });

  it("expires a draft on read after the TTL", async () => {
    const chain = fakeChain();
    const created = await service(chain).create(account.address, {
      kind: "deposit",
      amount: "25",
    });

    const expired = await service(chain, now + 901_000).get(
      created.intent.id,
      account.address
    );
    expect(expired.status).toBe("expired");
  });

  it("records a submitted tx hash once and scopes intents to the wallet", async () => {
    const chain = fakeChain();
    const created = await service(chain).create(account.address, {
      kind: "deposit",
      amount: "25",
    });
    const txHash = `0x${"a".repeat(64)}`;

    const submitted = await service(chain).submit(
      created.intent.id,
      account.address,
      txHash
    );
    expect(submitted).toMatchObject({
      status: "submitted",
      txHash,
    });

    const replay = await service(chain).submit(
      created.intent.id,
      account.address,
      txHash.toUpperCase().replace("0X", "0x")
    );
    expect(replay.txHash).toBe(txHash);

    await expect(
      service(chain).submit(
        created.intent.id,
        account.address,
        `0x${"b".repeat(64)}`
      )
    ).rejects.toMatchObject({ status: 409 });

    const other = privateKeyToAccount(generatePrivateKey());
    await expect(
      service(chain).get(created.intent.id, other.address)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns a clear 503 without Postgres", async () => {
    const svc = new IntentService(config, null, fakeChain(), logger);
    await expect(
      svc.create(account.address, { kind: "deposit", amount: "25" })
    ).rejects.toMatchObject({ status: 503, code: "db_unavailable" });
  });
});

describe("chat action proposal", () => {
  it("extracts one tagged proposal and removes the envelope", () => {
    const result = extractActionProposal(
      'I can prepare that.\n\n<hermes_action>{"kind":"cctpWithdraw","amount":"10","destinationDomain":6}</hermes_action>'
    );
    expect(result.error).toBeUndefined();
    expect(result.reply).toBe("I can prepare that.");
    expect(result.proposal).toEqual({
      kind: "cctpWithdraw",
      amount: "10",
      destinationDomain: 6,
    });
  });

  it("accepts the fenced form", () => {
    const result = extractActionProposal(
      'Ready.\n```hermes-action\n{"kind":"withdrawLocal","all":true}\n```'
    );
    expect(result.reply).toBe("Ready.");
    expect(result.proposal).toEqual({ kind: "withdrawLocal", all: true });
  });

  it("extracts a typed inbound CCTP deposit handoff", () => {
    const result = extractActionProposal(
      '<hermes_action>{"kind":"cctpDeposit","amount":"12.5","sourceDomain":"6"}</hermes_action>'
    );
    expect(result.error).toBeUndefined();
    expect(result.proposal).toEqual({
      kind: "cctpDeposit",
      amount: "12.5",
      sourceDomain: 6,
    });
  });

  it("rejects an inbound CCTP deposit without an explicit source domain", () => {
    const result = extractActionProposal(
      '<hermes_action>{"kind":"cctpDeposit","amount":"12.5"}</hermes_action>'
    );
    expect(result.proposal).toBeNull();
    expect(result.error).toMatch(/could not validate/i);
  });

  it("does not treat ordinary JSON as an action", () => {
    const result = extractActionProposal('{"kind":"deposit","amount":"5"}');
    expect(result.proposal).toBeNull();
    expect(result.reply).toBe('{"kind":"deposit","amount":"5"}');
  });

  it("rejects invalid or duplicate envelopes", () => {
    const invalid = extractActionProposal(
      '<hermes_action>{"kind":"transferEverything","amount":"5"}</hermes_action>'
    );
    expect(invalid.proposal).toBeNull();
    expect(invalid.error).toMatch(/could not validate/i);

    const duplicate = extractActionProposal(
      '<hermes_action>{"kind":"deposit","amount":"5"}</hermes_action>' +
        '<hermes_action>{"kind":"deposit","amount":"6"}</hermes_action>'
    );
    expect(duplicate.proposal).toBeNull();
    expect(duplicate.error).toMatch(/more than one/i);

    const mixedForms = extractActionProposal(
      '<hermes_action>{"kind":"deposit","amount":"5"}</hermes_action>\n' +
        '```hermes-action\n{"kind":"deposit","amount":"6"}\n```'
    );
    expect(mixedForms.proposal).toBeNull();
    expect(mixedForms.error).toMatch(/more than one/i);
  });
});
