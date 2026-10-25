import { encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { ADDRESSES, ARC_CHAIN_ID, TREASURY_ABI } from "../lib/contracts";
import type { HermesIntent } from "../lib/hermes";
import { assertFreshHermesIntent } from "./useHermesIntentExecution";

const wallet = "0x0000000000000000000000000000000000000001" as const;

function draft(overrides: Partial<HermesIntent> = {}): HermesIntent {
  return {
    id: "int_0123456789abcdef0123456789abcdef",
    wallet,
    kind: "deposit",
    chainId: ARC_CHAIN_ID,
    to: ADDRESSES.treasury,
    data: encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: "deposit",
      args: [5_000_000n],
    }),
    value: "0",
    amount: "5000000",
    isMax: false,
    destinationDomain: null,
    mintRecipient: null,
    status: "draft",
    simulation: { ok: true },
    txHash: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    ...overrides,
  };
}

describe("Hermes intent execution guard", () => {
  it("allows a current wallet-bound server draft with matching treasury calldata", () => {
    const intent = draft();
    expect(() => assertFreshHermesIntent(intent, intent, wallet)).not.toThrow();
  });

  it("rejects another wallet, target, network, or expired draft", () => {
    const intent = draft();
    expect(() =>
      assertFreshHermesIntent(
        intent,
        intent,
        "0x0000000000000000000000000000000000000002"
      )
    ).toThrow(/connected wallet/i);
    expect(() =>
      assertFreshHermesIntent(draft({ to: wallet }), intent, wallet)
    ).toThrow(/network or treasury/i);
    expect(() =>
      assertFreshHermesIntent(draft({ chainId: 1 }), intent, wallet)
    ).toThrow(/network or treasury/i);
    expect(() =>
      assertFreshHermesIntent(
        draft({ expiresAt: new Date(Date.now() - 1).toISOString() }),
        intent,
        wallet
      )
    ).toThrow(/no longer active/i);
  });

  it("rejects modified calldata even when the server draft is otherwise valid", () => {
    const intent = draft({ data: "0xdeadbeef" });
    expect(() => assertFreshHermesIntent(intent, intent, wallet)).toThrow(
      /does not match/i
    );
  });

  it("rejects a draft whose values differ from the displayed action", () => {
    expect(() =>
      assertFreshHermesIntent(draft(), draft({ amount: "6000000" }), wallet)
    ).toThrow(/draft changed/i);
  });
});
