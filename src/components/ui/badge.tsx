import React from "react";
import { cn } from "./cn";

export type Tone = "green" | "red" | "amber" | "blue" | "slate";

/** Status chip. Always pair the colour with text (and ideally an icon): colour alone is not enough. */
export function Badge({ tone = "slate", children, icon }: { tone?: Tone; children: React.ReactNode; icon?: React.ReactNode }) {
  const t = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
    red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-300",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
    slate: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", t)}>{icon}{children}</span>;
}
