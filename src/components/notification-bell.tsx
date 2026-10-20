"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Bell, Info, X } from "lucide-react";
import { api, formatDateTime } from "@/lib/client";
import { cn } from "./ui";

type N = { id: string; type: string; title: string; body: string; link: string | null; severity: "INFO" | "WARNING" | "CRITICAL"; createdAt: string; read: boolean };
type Group = "expiry" | "stock" | "other";
type Data = { unread: number; groups: Record<Group, number>; items: N[] };
const TABS: { id: Group | null; label: string }[] = [{ id: null, label: "All" }, { id: "expiry", label: "Expiry" }, { id: "stock", label: "Stock" }, { id: "other", label: "Other" }];
const ICON = { CRITICAL: AlertOctagon, WARNING: AlertTriangle, INFO: Info };

/** Header bell and the notification drawer (roadmap 6.3): open alerts for this person, by kind, each linking to the fix. */
export function NotificationBell({ className }: { className?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const load = useCallback(() => api<Data>(`/api/notifications?take=100${group ? `&group=${group}` : ""}`).then(setData, () => {}), [group]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const read = (ids: string[] | "all") => api("/api/notifications", { body: { ids } }).then(load, () => {});
  const unread = data?.unread ?? 0;
  const total = data ? data.groups.expiry + data.groups.stock + data.groups.other : 0;

  return (
    <>
      <button ref={button} onClick={() => setOpen(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-controls="notification-drawer" className={cn("relative", className)}>
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-semibold leading-[18px] text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden />
          <div id="notification-drawer" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Notifications"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl outline-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-semibold">Notifications</h2>
              <div className="flex items-center gap-2">
                {unread > 0 && <button className="text-sm text-primary hover:underline" onClick={() => read("all")}>Mark all read</button>}
                <button onClick={() => setOpen(false)} aria-label="Close notifications" className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div role="tablist" aria-label="Kind" className="flex gap-1 border-b border-border px-3 py-2">
              {TABS.map((t) => {
                const n = t.id ? data?.groups[t.id] ?? 0 : total;
                return (
                  <button key={t.label} role="tab" aria-selected={group === t.id} onClick={() => setGroup(t.id)}
                    className={cn("rounded-lg px-2.5 py-1 text-sm", group === t.id ? "bg-primary text-on-primary" : "text-fg-muted hover:bg-muted")}>
                    {t.label}{n > 0 && <span className="ml-1 text-xs opacity-80">{n}</span>}
                  </button>
                );
              })}
            </div>
            {!data?.items.length ? <p className="p-6 text-sm text-fg-muted">Nothing needs your attention.</p> : (
              <ul className="flex-1 divide-y divide-border overflow-y-auto">
                {data.items.map((n) => {
                  const Icon = ICON[n.severity] ?? Info;
                  return (
                    <li key={n.id} className={cn("flex gap-3 p-3 text-sm", !n.read && "bg-primary/5")}>
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", n.severity === "CRITICAL" ? "text-danger" : n.severity === "WARNING" ? "text-warning" : "text-info")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={n.link ?? "#"} onClick={() => { setOpen(false); void read([n.id]); }} className={cn("block hover:underline", !n.read && "font-medium")}>{n.title}</Link>
                        {n.body && <p className="text-xs text-fg-muted">{n.body}</p>}
                        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
                          {formatDateTime(n.createdAt)}
                          {!n.read && <button className="text-primary hover:underline" onClick={() => read([n.id])}>Mark read</button>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
