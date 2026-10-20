"use client";
import { useState } from "react";
import { Input } from "./ui";
import { qs, useApi, useDebounce } from "@/lib/client";

export type PickedMedicine = { id: string; name: string; purchasePrice: string; salePrice: string };

export function MedicinePicker({ value, onPick, label = "Medicine" }: { value: PickedMedicine | null; onPick: (m: PickedMedicine) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const { data } = useApi<{ items: PickedMedicine[] }>(open && dq ? `/api/medicines?${qs({ q: dq, pageSize: 8 })}` : null);
  return (
    <div className="relative">
      <Input aria-label={label} placeholder="Search medicine…" value={open ? q : value?.name ?? q}
        onFocus={() => { setOpen(true); setQ(""); }} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && dq && data && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full min-w-[220px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {data.items.length === 0 && <li className="p-3 text-sm text-fg-muted">No match</li>}
          {data.items.map((m) => (
            <li key={m.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(m); setOpen(false); setQ(""); }}>{m.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
