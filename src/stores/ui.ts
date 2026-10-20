import { create } from 'zustand'
import type { ActivityEvent, ActivityEventType } from '../lib/activity'

export type TabId = 'overview' | 'deposit' | 'yield' | 'withdraw' | 'activity' | 'settings'

export interface GrowthSnapshot {
  ts:    number  // unix ms
  value: bigint  // totalBalance in raw bigint
}

export interface UiState {
  activeTab:       TabId
  activityEvents:  ActivityEvent[]
  activityFilter:  ActivityEventType | 'all'
  activityLoading: boolean
  growthHistory:   GrowthSnapshot[]

  setTab:    (tab: TabId) => void
  setEvents: (events: ActivityEvent[]) => void
  setFilter: (f: ActivityEventType | 'all') => void
  setActivityLoading: (b: boolean) => void
  pushSnapshot: (v: bigint) => void
}

// Persist growth history to localStorage
const LS_KEY = 'agent-treasury-growth-v1'
function loadHistory(): GrowthSnapshot[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { ts: number; value: string }[]
    return parsed.map((s) => ({ ts: s.ts, value: BigInt(s.value) }))
  } catch {
    return []
  }
}
function saveHistory(h: GrowthSnapshot[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(h.map(s => ({ ts: s.ts, value: s.value.toString() }))))
  } catch { /* ignore */ }
}

export const useUiStore = create<UiState>((setState) => ({
  activeTab:       'overview',
  activityEvents:  [],
  activityFilter:  'all',
  activityLoading: false,
  growthHistory:   loadHistory(),

  setTab:    (tab) => setState((s) => ({ ...s, activeTab: tab })),
  setEvents: (events) => setState((s) => ({ ...s, activityEvents: events })),
  setFilter: (f) => setState((s) => ({ ...s, activityFilter: f })),
  setActivityLoading: (b) => setState((s) => ({ ...s, activityLoading: b })),
  pushSnapshot: (value) => setState((s) => {
    const now = Date.now()
    // Dedupe: only add if >5 min since last and value changed
    const last = s.growthHistory[s.growthHistory.length - 1]
    if (last && now - last.ts < 5 * 60_000 && last.value === value) return s
    const updated = [...s.growthHistory, { ts: now, value }].slice(-200) // keep last 200 pts
    saveHistory(updated)
    return { ...s, growthHistory: updated }
  }),
}))
