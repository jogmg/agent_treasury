import { clsx } from "clsx";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  className?: string;
  icon?: ReactNode;
}

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
  icon,
}: Props) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-700 bg-[#0A0E11]/55 p-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {icon && (
          <span className={accent ? "text-green-300" : "text-slate-500"}>
            {icon}
          </span>
        )}
      </div>
      <p
        className={clsx(
          "mt-2 font-mono text-2xl font-semibold tabular-nums",
          accent ? "text-green-300" : "text-white"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
