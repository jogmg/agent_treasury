import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBridgeDepositInProgress,
  useBridgeDepositStore,
} from "./bridgeDeposit";

const HASH = `0x${"11".repeat(32)}`;
const OTHER_HASH = `0x${"22".repeat(32)}`;

beforeEach(() => {
  useBridgeDepositStore.setState({ recent: [] });
  useBridgeDepositStore.getState().resetBridgeDeposit();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cross-chain deposit flow", () => {
  it("only treats non-terminal flow stages as in progress", () => {
    expect(isBridgeDepositInProgress("waiting")).toBe(true);
    expect(isBridgeDepositInProgress("ready")).toBe(true);
    expect(isBridgeDepositInProgress("burning")).toBe(true);
    expect(isBridgeDepositInProgress("done")).toBe(false);
    expect(isBridgeDepositInProgress("error")).toBe(false);
    expect(isBridgeDepositInProgress("idle")).toBe(false);
  });

  it("tracks the source burn and destination mint separately", () => {
    const { setBridgeDeposit } = useBridgeDepositStore.getState();
    setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 6,
      amount: "10000000",
      burnHash: HASH,
    });

    let state = useBridgeDepositStore.getState();
    expect(state.status).toBe("waiting");
    expect(state.sourceDomain).toBe(6);
    expect(state.burnHash).toBe(HASH);
    expect(state.mintHash).toBe("");

    setBridgeDeposit({
      status: "ready",
      message: "0xmessage",
      attestation: "0xattestation",
    });
    state = useBridgeDepositStore.getState();
    expect(state.status).toBe("ready");
    expect(state.message).toBe("0xmessage");

    setBridgeDeposit({ status: "done", mintHash: "0xmint" });
    state = useBridgeDepositStore.getState();
    expect(state.status).toBe("done");
    expect(state.mintHash).toBe("0xmint");
  });

  it("persists the originating Hermes action with the active transfer", () => {
    useBridgeDepositStore.getState().setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 6,
      amount: "10000000",
      burnHash: HASH,
      chatActionId: "session-1:action-1",
    });

    expect(useBridgeDepositStore.getState().chatActionId).toBe(
      "session-1:action-1"
    );
  });

  it("resets the active flow but keeps the source burn in recent history", () => {
    const { setBridgeDeposit, resetBridgeDeposit } =
      useBridgeDepositStore.getState();
    setBridgeDeposit({
      status: "error",
      owner: "0xabc",
      sourceDomain: 0,
      amount: "10000000",
      burnHash: HASH,
      error: "reverted",
    });
    resetBridgeDeposit();

    const state = useBridgeDepositStore.getState();
    expect(state.status).toBe("idle");
    expect(state.error).toBe("");
    expect(state.burnHash).toBe("");
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0].burnHash).toBe(HASH);
  });

  it("discards the active burn and removes it from recent history", () => {
    const { setBridgeDeposit, discardBridgeDeposit } =
      useBridgeDepositStore.getState();
    setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 6,
      amount: "10000000",
      burnHash: HASH,
    });
    setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 6,
      amount: "20000000",
      burnHash: OTHER_HASH,
    });

    discardBridgeDeposit();

    const state = useBridgeDepositStore.getState();
    expect(state.status).toBe("idle");
    expect(state.burnHash).toBe("");
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0].burnHash).toBe(HASH);
  });

  it("updates the recent record and does not duplicate the same hash", () => {
    const { setBridgeDeposit } = useBridgeDepositStore.getState();
    setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 0,
      amount: "10000000",
      burnHash: HASH,
    });
    setBridgeDeposit({ status: "ready" });
    setBridgeDeposit({ status: "done" });

    const recent = useBridgeDepositStore.getState().recent;
    expect(recent).toHaveLength(1);
    expect(recent[0].status).toBe("done");
  });

  it("restores a saved source burn as a waiting flow", () => {
    const { setBridgeDeposit, resetBridgeDeposit, restoreBridgeDeposit } =
      useBridgeDepositStore.getState();
    setBridgeDeposit({
      status: "done",
      owner: "0xabc",
      sourceDomain: 3,
      amount: "25000000",
      burnHash: HASH,
    });
    setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 6,
      amount: "10000000",
      burnHash: OTHER_HASH,
    });
    resetBridgeDeposit();

    const record = useBridgeDepositStore
      .getState()
      .recent.find((entry) => entry.burnHash === HASH);
    expect(record).toBeDefined();
    restoreBridgeDeposit(record!);

    const state = useBridgeDepositStore.getState();
    expect(state.status).toBe("waiting");
    expect(state.burnHash).toBe(HASH);
    expect(state.amount).toBe("25000000");
    expect(state.sourceDomain).toBe(3);
    expect(state.error).toBe("");
  });

  it("writes the active burn and recent list to localStorage", () => {
    const backing = new Map<string, string>();
    const origStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => backing.set(key, value),
        removeItem: (key: string) => backing.delete(key),
        clear: () => backing.clear(),
      },
      writable: true,
      configurable: true,
    });
    // restore after test
    afterEach(() => {
      Object.defineProperty(globalThis, "localStorage", {
        value: origStorage,
        writable: true,
        configurable: true,
      });
    });

    useBridgeDepositStore.getState().setBridgeDeposit({
      status: "waiting",
      owner: "0xabc",
      sourceDomain: 0,
      amount: "10000000",
      burnHash: HASH,
    });

    const saved = [...backing.values()][0];
    expect(saved).toContain(HASH);
    expect(saved).toContain('"status":"waiting"');
    expect(saved).toContain('"recent"');
  });
});
