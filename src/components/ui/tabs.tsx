"use client";
import { cn } from "./cn";

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium", value === t.id ? "border-primary text-brand-700 dark:text-brand-300" : "border-transparent text-fg-muted hover:text-fg")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
