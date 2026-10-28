import { clsx } from "clsx";
import type { TabId } from "../stores/ui";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "hermes", label: "Chat" },
  { id: "deposit", label: "Deposit" },
  { id: "yield", label: "Yield" },
  { id: "withdraw", label: "Withdraw" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

interface Props {
  active: TabId;
  onChange: (t: TabId) => void;
}

export function TabBar({ active, onChange }: Props) {
  return (
    <div className="scrollbar-none flex gap-0.5 overflow-x-auto border-b border-slate-800 bg-[#0a0f1e] px-4 sm:px-6">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors",
            active === t.id
              ? "border-b-2 border-emerald-400 text-emerald-400"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
