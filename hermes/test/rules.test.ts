import { describe, expect, it } from "vitest";
import type { TreasuryState } from "../src/arc";
import { loadConfig } from "../src/config";
import {
  collectAlerts,
  evaluateTransfer,
  type TransferRow,
} from "../src/monitor/rules";

const config = loadConfig({});

function state(overrides: Partial<TreasuryState> = {}): TreasuryState {
  return {
    network: "Arc",
    chainId: 5042,
    treasury: config.network.addresses.treasury,
    agent: "0xD00fD0B006c01342522cAf4FA04D5f8910aB268c",
    asOfBlock: "27320000",
    asOfTime: new Date().toISOString(),
    paused: false,
    owner: "0xD00fD0B006c01342522cAf4FA04D5f8910aB268c",
    keeper: "0xD00fD0B006c01342522cAf4FA04D5f8910aB268c",
    gatewayReceiver: config.network.addresses.receiver,
    defaultVaultId: "1",
    cctpDomain: 26,
    nextWithdrawalId: "4",
    principal: "10000001",
    principalUsdc: "10.000001",
    totalBalance: "10000011",
    totalBalanceUsdc: "10.000011",
    vaultShares: "9992387766924438899",
    activeVaultId: "1",
    idleUsdc: "0",
    idleUsdcDisplay: "0",
    treasuryUsdcBalance: "0",
    treasuryUsdcBalanceDisplay: "0",
    agentUsdcBalance: "0",
    agentUsdcBalanceDisplay: "0",
    depositsByChain: { "6": "5000000", "26": "27000000" },
    vault: null,
    warnings: [],
    ...overrides,
  };
}

function transfer(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: 1,
    direction: "out",
    withdrawalId: 3,
    burnTxHash: `0x${"11".repeat(32)}`,
    burnBlock: "27317380",
    sourceDomain: 26,
    destinationDomain: 6,
    amount: "4999999",
    phase: "waiting",
    nonce: null,
    mintTxHash: null,
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    lastCheckedAt: null,
    ...overrides,
  };
}

describe("monitor rules", () => {
  it("flags a paused treasury", () => {
    const alerts = collectAlerts(config, state({ paused: true }), []);
    expect(alerts.some((alert) => alert.kind === "treasury-paused")).toBe(true);
    expect(
      alerts.find((alert) => alert.kind === "treasury-paused")?.severity
    ).toBe("critical");
  });

  it("flags keeper still equal to owner", () => {
    const alerts = collectAlerts(config, state(), []);
    expect(alerts.some((alert) => alert.kind === "keeper-is-owner")).toBe(true);
  });

  it("flags a receiver mismatch", () => {
    const alerts = collectAlerts(
      config,
      state({ gatewayReceiver: "0x0000000000000000000000000000000000000001" }),
      []
    );
    expect(alerts.some((alert) => alert.kind === "receiver-mismatch")).toBe(
      true
    );
  });

  it("keeps multiple read warnings distinct", () => {
    const alerts = collectAlerts(
      config,
      state({ warnings: ["Could not read principal", "Could not read vault"] }),
      []
    ).filter((alert) => alert.kind === "read-warning");
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((alert) => alert.dedupeKey)).size).toBe(2);
  });

  it("does not flag a healthy delivered transfer", () => {
    expect(evaluateTransfer(config, transfer({ phase: "done" }))).toEqual([]);
  });

  it("flags a waiting transfer older than 45 minutes", () => {
    const alerts = evaluateTransfer(config, transfer({ phase: "waiting" }));
    expect(alerts.map((alert) => alert.kind)).toContain("transfer-waiting");
  });

  it("flags a ready transfer older than 15 minutes", () => {
    const alerts = evaluateTransfer(
      config,
      transfer({
        phase: "ready",
        createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      })
    );
    expect(alerts.map((alert) => alert.kind)).toContain("transfer-ready");
  });

  it("alerts immediately for a delivered withdrawal with pending bookkeeping", () => {
    const alerts = evaluateTransfer(
      config,
      transfer({
        phase: "done",
        bookkeepingStatus: "pending",
        mintTxHash: `0x${"22".repeat(32)}`,
      })
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      severity: "info",
      kind: "withdrawal-bookkeeping-pending",
      subject: "3",
      payload: {
        withdrawalId: 3,
        amountUsdc: "4.999999",
        destination: "Base",
        message: expect.stringContaining("executeWithdrawal"),
      },
    });
  });

  it.each(["executed", "cancelled", "unknown"] as const)(
    "does not claim bookkeeping is pending when status is %s",
    (bookkeepingStatus) => {
      const alerts = evaluateTransfer(
        config,
        transfer({ phase: "done", bookkeepingStatus })
      );
      if (bookkeepingStatus === "unknown") {
        expect(alerts.map((alert) => alert.kind)).toEqual([
          "withdrawal-bookkeeping-unverified",
        ]);
      } else {
        expect(alerts).toEqual([]);
      }
    }
  );
});
