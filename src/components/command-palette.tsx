"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, FileText, PackagePlus, Pill, Search, Truck, UserRound, type LucideIcon } from "lucide-react";
import { api, qs, useDebounce } from "@/lib/client";
import { cn } from "./ui";

type Hit = { kind: "medicine" | "customer" | "supplier" | "invoice" | "stockEntry" | "batch"; id: string; title: string; detail: string; href: string };
type Item = { key: string; title: string; detail: string; href: string; icon: LucideIcon; group: string };
type NavLike = { href: string; label: string; icon: LucideIcon };
const KIND: Record<Hit["kind"], { label: string; icon: LucideIcon }> = {
  medicine: { label: "Medicines", icon: Pill }, customer: { label: "Customers", icon: UserRound }, supplier: { label: "Suppliers", icon: Truck },
  invoice: { label: "Invoices", icon: FileText }, stockEntry: { label: "Stock entries", icon: PackagePlus }, batch: { label: "Batches", icon: Boxes },
};

/** Opens the palette from anywhere (a header button). */
export const openCommandPalette = () => window.dispatchEvent(new Event("pcrm:palette"));

/**
 * Ctrl+K (or Cmd+K) command palette (roadmap 6.7): go to any screen the person may open, or find a
 * medicine, customer, supplier, invoice, stock entry or batch. Arrows to choose, Enter to open, Esc to close.
 */
export function CommandPalette({ nav }: { nav: readonly NavLike[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const dq = useDebounce(q.trim(), 150);

  useEffect(() => {
    const show = () => { back.current = document.activeElement as HTMLElement | null; setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyK") { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pcrm:palette", show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pcrm:palette", show); };
  }, []);
  useEffect(() => { if (open) { setQ(""); setHits([]); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open || dq.length < 2) { setHits([]); return; }
    let live = true;
    api<{ items: Hit[] }>(`/api/search?${qs({ q: dq })}`).then((r) => live && setHits(r.items), () => live && setHits([]));
    return () => { live = false; };
  }, [dq, open]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const pages = nav.filter((n) => !t || n.label.toLowerCase().includes(t)).slice(0, t ? 5 : 8)
      .map((n) => ({ key: `nav:${n.href}`, title: n.label, detail: "Go to", href: n.href, icon: n.icon, group: "Go to" }));
    const found = hits.map((h) => ({ key: `${h.kind}:${h.id}`, title: h.title, detail: h.detail, href: h.href, icon: KIND[h.kind].icon, group: KIND[h.kind].label }));
    return [...pages, ...found];
  }, [nav, q, hits]);
  useEffect(() => setActive(0), [items.length]);

  if (!open) return null;
  const close = () => { setOpen(false); back.current?.focus?.(); };
  const go = (it: Item | undefined) => { if (!it) return; setOpen(false); router.push(it.href); };

  let lastGroup = "";
  return (
    <div className="no-print fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search and go to" className="card w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-fg-muted" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicines, customers, invoices, batches, or go to a screen"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); close(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
            }} />
          <kbd className="rounded border border-border px-1.5 text-[11px] text-fg-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.key} role="presentation">
                {header && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{header}</p>}
                <button type="button" id={`palette-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(it)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-primary/10")}>
                  <it.icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{it.title}</span>
                  <span className="truncate text-xs text-fg-muted">{it.detail}</span>
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-6 text-center text-sm text-fg-muted">{dq.length < 2 ? "Type at least two letters." : "Nothing found."}</li>}
        </ul>
      </div>
    </div>
  );
}
