import { create } from "zustand";
import type { ActivityEvent, ActivityEventType } from "../lib/activity";

export type TabId =
  | "overview"
  | "hermes"
  | "deposit"
  | "yield"
  | "withdraw"
  | "activity"
  | "settings";

export interface GrowthSnapshot {
  ts: number; // unix ms
  value: bigint; // totalBalance in raw 6-dec USDC units
}

interface StoredSnapshot {
  ts: number;
  value: string;
}

export interface UiState {
  activeTab: TabId;
  activityEvents: ActivityEvent[];
  activityFilter:
    | ActivityEventType
    | "all"
    | "inflight"
    | "deposits"
    | "withdrawals";
  activityLoading: boolean;
  growthHistory: GrowthSnapshot[];
  growthKey: string;
  /** Draft selected from a chat action card or `?intent=` deep link. */
  reviewIntentId: string | null;

  setTab: (tab: TabId) => void;
  setReviewIntent: (id: string | null) => void;
  setEvents: (events: ActivityEvent[]) => void;
  setFilter: (
    f: ActivityEventType | "all" | "inflight" | "deposits" | "withdrawals"
  ) => void;
  setActivityLoading: (b: boolean) => void;
  setGrowthContext: (agent?: string, treasury?: string) => void;
  pushSnapshot: (value: bigint, agent?: string, treasury?: string) => void;
}

// Growth history is scoped to (treasury, agent). A snapshot from one wallet or
// one deployment must never be plotted against another account's balance.
const LS_KEY = "agent-treasury-growth-v2";
const LEGACY_LS_KEY = "agent-treasury-growth-v1";
const MAX_POINTS = 300;
const MIN_SNAPSHOT_GAP_MS = 60_000;

type StoredHistory = Record<string, StoredSnapshot[]>;

function scopeKey(agent: string, treasury: string): string {
  return `${treasury.toLowerCase()}:${agent.toLowerCase()}`;
}

function readStore(): StoredHistory {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as StoredHistory;
  } catch {
    return {};
  }
}

function writeStore(all: StoredHistory) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* quota/unavailable: keep the in-memory history */
  }
}

function parseSnapshots(list: StoredSnapshot[] | undefined): GrowthSnapshot[] {
  if (!Array.isArray(list)) return [];
  try {
    return list
      .filter(
        (s): s is StoredSnapshot =>
          !!s && typeof s.ts === "number" && typeof s.value === "string"
      )
      .map((s) => ({ ts: s.ts, value: BigInt(s.value) }))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

function loadHistory(key: string): GrowthSnapshot[] {
  return parseSnapshots(readStore()[key]);
}

// Drop the old unscoped format once. It contained no wallet/deployment identity,
// so it cannot be safely attributed to the currently connected account.
function clearLegacyHistory() {
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    /* ignore */
  }
}

clearLegacyHistory();

export const useUiStore = create<UiState>((setState) => ({
  activeTab: "overview",
  activityEvents: [],
  activityFilter: "all",
  activityLoading: false,
  growthHistory: [],
  growthKey: "",
  reviewIntentId: null,

  setTab: (tab) => setState((s) => ({ ...s, activeTab: tab })),
  setReviewIntent: (id) => setState((s) => ({ ...s, reviewIntentId: id })),
  setEvents: (events) => setState((s) => ({ ...s, activityEvents: events })),
  setFilter: (f) => setState((s) => ({ ...s, activityFilter: f })),
  setActivityLoading: (b) => setState((s) => ({ ...s, activityLoading: b })),

  setGrowthContext: (agent, treasury) =>
    setState((s) => {
      if (!agent || !treasury) {
        return s.growthKey === "" && s.growthHistory.length === 0
          ? s
          : { ...s, growthKey: "", growthHistory: [] };
      }

      const key = scopeKey(agent, treasury);
      if (key === s.growthKey) return s;
      return { ...s, growthKey: key, growthHistory: loadHistory(key) };
    }),

  pushSnapshot: (value, agent, treasury) => {
    if (!agent || !treasury) return;
    const key = scopeKey(agent, treasury);

    setState((s) => {
      const all = readStore();
      const list = Array.isArray(all[key]) ? all[key] : [];
      const now = Date.now();
      const last = list[list.length - 1];

      if (last && now - last.ts < MIN_SNAPSHOT_GAP_MS) {
        // Keep the most recent point current instead of adding a dense cluster
        // of 10-second samples on the chart.
        last.ts = now;
        last.value = value.toString();
      } else {
        list.push({ ts: now, value: value.toString() });
        if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
      }

      all[key] = list;
      writeStore(all);

      if (key !== s.growthKey) return s;
      return { ...s, growthHistory: parseSnapshots(list) };
    });
  },
}));
