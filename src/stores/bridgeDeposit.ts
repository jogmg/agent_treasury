/**
 * Cross-chain deposit flow (source-chain CCTP burn -> Arc receiver credit).
 *
 * New burns set the Arc CCTPReceiverV2 as both mintRecipient and
 * destinationCaller; the receiver credits the agent in one Arc transaction.
 * Legacy burns (minted to the wallet) are still recoverable through the same
 * store. Kept separate from the Arc-local deposit flow so a long-running
 * attestation poll cannot overwrite the local deposit UI state. The active
 * flow and a small list of recent source burns are persisted so a page refresh
 * does not lose the only copy of the burn hash.
 */
import { create } from "zustand";

export type BridgeDepositStatus =
  | "idle"
  | "approving"
  | "burning"
  | "waiting"
  | "ready"
  | "minting"
  | "arc-approving"
  | "depositing"
  | "done"
  | "error";

export const BRIDGE_STATUS_LABEL: Record<BridgeDepositStatus, string> = {
  idle: "Idle",
  approving: "Approving source",
  burning: "Burning source",
  waiting: "Waiting for Circle",
  ready: "Ready to mint",
  minting: "Processing on Arc",
  "arc-approving": "Approving on Arc",
  depositing: "Depositing",
  done: "Credited",
  error: "Needs attention",
};

export function isBridgeDepositInProgress(
  status: BridgeDepositStatus
): boolean {
  return (
    status === "approving" ||
    status === "burning" ||
    status === "waiting" ||
    status === "ready" ||
    status === "minting" ||
    status === "arc-approving" ||
    status === "depositing"
  );
}

export interface BridgeDepositCurrent {
  status: BridgeDepositStatus;
  owner: string;
  sourceDomain: number;
  amount: string;
  approveHash: string;
  burnHash: string;
  mintHash: string;
  arcApproveHash: string;
  depositHash: string;
  message: string;
  attestation: string;
  error: string;
  chatActionId: string;
}

export interface BridgeDepositRecord {
  owner: string;
  sourceDomain: number;
  burnHash: string;
  amount: string;
  status: BridgeDepositStatus;
  createdAt: number;
}

export interface BridgeDepositState extends BridgeDepositCurrent {
  recent: BridgeDepositRecord[];

  setBridgeDeposit: (
    patch: Partial<
      Omit<
        BridgeDepositState,
        | "setBridgeDeposit"
        | "resetBridgeDeposit"
        | "discardBridgeDeposit"
        | "restoreBridgeDeposit"
        | "clearBridgeHistory"
        | "recent"
      >
    >
  ) => void;
  resetBridgeDeposit: () => void;
  discardBridgeDeposit: () => void;
  restoreBridgeDeposit: (record: BridgeDepositRecord) => void;
  clearBridgeHistory: () => void;
}

const STORAGE_KEY = "agent-treasury-bridge-deposit-v1";
const MAX_RECENT = 10;

const INITIAL_CURRENT: BridgeDepositCurrent = {
  status: "idle",
  owner: "",
  sourceDomain: 0,
  amount: "",
  approveHash: "",
  burnHash: "",
  mintHash: "",
  arcApproveHash: "",
  depositHash: "",
  message: "",
  attestation: "",
  error: "",
  chatActionId: "",
};

const CURRENT_KEYS = Object.keys(
  INITIAL_CURRENT
) as (keyof BridgeDepositCurrent)[];

interface PersistedState {
  current: BridgeDepositCurrent;
  recent: BridgeDepositRecord[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isStatus(value: unknown): value is BridgeDepositStatus {
  return (
    value === "idle" ||
    value === "approving" ||
    value === "burning" ||
    value === "waiting" ||
    value === "ready" ||
    value === "minting" ||
    value === "arc-approving" ||
    value === "depositing" ||
    value === "done" ||
    value === "error"
  );
}

function isBurnHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function extractCurrent(
  state: BridgeDepositState | BridgeDepositCurrent
): BridgeDepositCurrent {
  const current = {} as BridgeDepositCurrent;
  for (const key of CURRENT_KEYS) {
    // Object.assign avoids a union-assignment error while keeping the runtime
    // shape limited to the persisted fields.
    Object.assign(current, { [key]: state[key] });
  }
  return current;
}

function normalizeCurrent(input: unknown): BridgeDepositCurrent {
  if (!input || typeof input !== "object") return { ...INITIAL_CURRENT };
  const raw = input as Partial<BridgeDepositCurrent>;
  const status = isStatus(raw.status) ? raw.status : "idle";
  const owner = asString(raw.owner);
  const sourceDomain = Number(raw.sourceDomain);
  const burnHash = asString(raw.burnHash);
  const amount = asString(raw.amount);

  const current: BridgeDepositCurrent = {
    status,
    owner,
    sourceDomain: Number.isInteger(sourceDomain) ? sourceDomain : 0,
    amount,
    approveHash: asString(raw.approveHash),
    burnHash,
    mintHash: asString(raw.mintHash),
    arcApproveHash: asString(raw.arcApproveHash),
    depositHash: asString(raw.depositHash),
    message: asString(raw.message),
    attestation: asString(raw.attestation),
    error: asString(raw.error),
    chatActionId: asString(raw.chatActionId),
  };

  // A refresh can happen after a wallet prompt but before the transaction hash
  // exists. Do not leave the UI stuck on an in-flight status.
  if (current.status === "approving" || current.status === "burning") {
    current.status = current.burnHash ? "waiting" : "idle";
  } else if (
    current.status === "minting" ||
    current.status === "arc-approving" ||
    current.status === "depositing"
  ) {
    current.status = current.burnHash
      ? current.message && current.attestation
        ? "ready"
        : "waiting"
      : "idle";
  } else if (current.status === "waiting" && !current.burnHash) {
    current.status = "idle";
  } else if (current.status === "error" && !current.burnHash) {
    current.status = "idle";
  }

  if (!current.owner) {
    return { ...INITIAL_CURRENT };
  }

  return current;
}

function normalizeRecord(input: unknown): BridgeDepositRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<BridgeDepositRecord>;
  const owner = asString(raw.owner);
  const sourceDomain = Number(raw.sourceDomain);
  const burnHash = asString(raw.burnHash);
  const amount = asString(raw.amount);
  const status = isStatus(raw.status) ? raw.status : "waiting";
  const createdAt = Number(raw.createdAt);

  if (
    !owner ||
    !isBurnHash(burnHash) ||
    !Number.isInteger(sourceDomain) ||
    !amount
  ) {
    return null;
  }

  return {
    owner,
    sourceDomain,
    burnHash,
    amount,
    status,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

function loadPersisted(): PersistedState {
  const empty: PersistedState = { current: { ...INITIAL_CURRENT }, recent: [] };
  if (typeof localStorage === "undefined") return empty;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { current?: unknown; recent?: unknown };
    const current = normalizeCurrent(parsed.current);
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent
          .map(normalizeRecord)
          .filter((record): record is BridgeDepositRecord => record !== null)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, MAX_RECENT)
      : [];

    // Make sure the active burn is also visible in the recovery list.
    if (
      current.burnHash &&
      !recent.some(
        (record) =>
          record.burnHash.toLowerCase() === current.burnHash.toLowerCase()
      )
    ) {
      recent.unshift({
        owner: current.owner,
        sourceDomain: current.sourceDomain,
        burnHash: current.burnHash,
        amount: current.amount,
        status: current.status,
        createdAt: Date.now(),
      });
    }

    return { current, recent: recent.slice(0, MAX_RECENT) };
  } catch {
    return empty;
  }
}

function persist(current: BridgeDepositCurrent, recent: BridgeDepositRecord[]) {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedState = {
      current,
      recent: recent.slice(0, MAX_RECENT),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota/unavailable: keep the in-memory copy.
  }
}

function upsertRecent(
  recent: BridgeDepositRecord[],
  current: BridgeDepositCurrent
): BridgeDepositRecord[] {
  if (!isBurnHash(current.burnHash)) return recent;

  const existing = recent.find(
    (record) => record.burnHash.toLowerCase() === current.burnHash.toLowerCase()
  );
  const next: BridgeDepositRecord = {
    owner: current.owner,
    sourceDomain: current.sourceDomain,
    burnHash: current.burnHash,
    amount: current.amount,
    status: current.status,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  return [
    next,
    ...recent.filter(
      (record) =>
        record.burnHash.toLowerCase() !== current.burnHash.toLowerCase()
    ),
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECENT);
}

const persisted = loadPersisted();

export const useBridgeDepositStore = create<BridgeDepositState>((setState) => ({
  ...persisted.current,
  recent: persisted.recent,

  setBridgeDeposit: (patch) =>
    setState((state) => {
      const current = { ...extractCurrent(state), ...patch };
      const recent = upsertRecent(state.recent, current);
      persist(current, recent);
      return { ...state, ...current, recent };
    }),

  resetBridgeDeposit: () =>
    setState((state) => {
      const current = { ...INITIAL_CURRENT };
      persist(current, state.recent);
      return { ...state, ...current };
    }),

  /** Reset the active flow and forget its burn hash entirely. */
  discardBridgeDeposit: () =>
    setState((state) => {
      const current = { ...INITIAL_CURRENT };
      const recent = state.burnHash
        ? state.recent.filter(
            (record) =>
              record.burnHash.toLowerCase() !== state.burnHash.toLowerCase()
          )
        : state.recent;
      persist(current, recent);
      return { ...state, ...current, recent };
    }),

  restoreBridgeDeposit: (record) =>
    setState((state) => {
      const current: BridgeDepositCurrent = {
        ...INITIAL_CURRENT,
        status: "waiting",
        owner: record.owner,
        sourceDomain: record.sourceDomain,
        amount: record.amount,
        burnHash: record.burnHash,
      };
      const recent = upsertRecent(state.recent, current);
      persist(current, recent);
      return { ...state, ...current, recent };
    }),

  clearBridgeHistory: () =>
    setState((state) => {
      const current = extractCurrent(state);
      persist(current, []);
      return { ...state, recent: [] };
    }),
}));
