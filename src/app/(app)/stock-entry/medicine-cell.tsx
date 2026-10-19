"use client";
import { forwardRef, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { qs, useApi, useDebounce } from "@/lib/client";
import { cn } from "@/components/ui";

export type CellMedicine = { id: string; name: string; salePrice?: string; purchasePrice?: string };
type Item = { id: string; name: string; genericName: string | null; barcode: string | null; salePrice: string; purchasePrice?: string };

/**
 * The medicine cell of the stock entry grid: type to search (name, generic, barcode), arrows and Enter to
 * choose, a scanner's Enter picks an exact barcode at once, and "New medicine" for anything unknown.
 * Other keys (Tab, Ctrl+D, F2) are left to the grid.
 */
export const MedicineCell = forwardRef<HTMLInputElement, {
  value: CellMedicine | null; printed: string; invalid?: boolean; disabled?: boolean;
  onPick: (m: CellMedicine) => void; onCreate: (name: string) => void; onGridKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  "data-row": number; "data-col": string;
}>(function MedicineCell({ value, printed, invalid, disabled, onPick, onCreate, onGridKey, ...data }, ref) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounce(q, 180);
  const { data: found } = useApi<{ items: Item[] }>(open && dq.trim() ? `/api/medicines?${qs({ q: dq.trim(), pageSize: 8 })}` : null);
  const items = found?.items ?? [];
  useEffect(() => setActive(0), [dq]);

  const choose = (m: Item) => {
    onPick({ id: m.id, name: m.name, salePrice: m.salePrice, purchasePrice: m.purchasePrice });
    setOpen(false);
    setQ("");
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && q) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
      if (e.key === "Escape") { setOpen(false); setQ(""); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const exact = items.find((m) => m.barcode && m.barcode === q.trim());
        if (exact) return choose(exact);
        if (active < items.length && items[active]) return choose(items[active]);
        if (q.trim()) { onCreate(q.trim()); setOpen(false); setQ(""); }
        return;
      }
    }
    onGridKey(e);
  }

  return (
    <div className="relative">
      <input ref={ref} {...data} disabled={disabled} aria-label="Medicine" aria-invalid={invalid || undefined} autoComplete="off" spellCheck={false}
        className={cn("w-full min-w-[200px] rounded border bg-surface px-2 py-1 text-sm", invalid ? "border-danger" : "border-border")}
        placeholder={printed ? `Printed: ${printed}` : "Type to search..."}
        value={open ? q : value?.name ?? ""}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setOpen(true); setQ(e.target.value); }}
        onKeyDown={onKeyDown} />
      {open && q.trim() && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[280px] overflow-auto rounded-lg border border-border bg-surface shadow-lg">
          {items.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button type="button" className={cn("w-full px-3 py-1.5 text-left text-sm", i === active ? "bg-muted" : "hover:bg-muted")} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m)}>
                {m.name}{m.genericName && <span className="ml-1 text-xs text-fg-muted">{m.genericName}</span>}
              </button>
            </li>
          ))}
          <li role="option" aria-selected={active === items.length}>
            <button type="button" className={cn("flex w-full items-center gap-1 px-3 py-1.5 text-left text-sm text-primary", active === items.length ? "bg-muted" : "hover:bg-muted")} onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(q.trim()); setOpen(false); setQ(""); }}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> New medicine &quot;{q.trim()}&quot;
            </button>
          </li>
        </ul>
      )}
    </div>
  );
});
