import React from "react";
import { cn } from "./cn";
import { Card } from "./card";
import type { Tone } from "./badge";

export function StatCard({ label, value, icon, tone = "slate", hint }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: Tone; hint?: string }) {
  const bg = {
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
    slate: "bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200",
  }[tone];
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", bg)} aria-hidden>{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
        <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="truncate text-xs text-fg-muted">{hint}</p>}
      </div>
    </Card>
  );
}
