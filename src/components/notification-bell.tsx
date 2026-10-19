"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { api, formatDateTime } from "@/lib/client";
import { cn } from "./ui";

type N = { id: string; title: string; body: string; link: string | null; severity: "INFO" | "WARNING" | "CRITICAL"; createdAt: string; read: boolean };

/** Header bell with the open notifications for this person; refreshes every minute. */
export function NotificationBell({ className }: { className?: string }) {
  const [data, setData] = useState<{ unread: number; items: N[] } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = () => api<{ unread: number; items: N[] }>("/api/notifications").then(setData, () => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  async function readAll() {
    await api("/api/notifications", { body: { ids: "all" } }).catch(() => {});
    void load();
  }
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} className={cn("relative", className)}>
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-semibold leading-[18px] text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="card absolute right-0 z-50 mt-2 w-80 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button className="text-xs text-primary hover:underline" onClick={readAll}>Mark all read</button>}
          </div>
          {!data?.items.length ? <p className="p-4 text-sm text-fg-muted">Nothing needs your attention.</p> : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id} className={cn("p-3 text-sm", !n.read && "bg-brand-50/60 dark:bg-slate-800/60")}>
                  <Link href={n.link ?? "#"} onClick={() => { setOpen(false); void api("/api/notifications", { body: { ids: [n.id] } }).then(load, () => {}); }} className="block">
                    <span className={cn("font-medium", n.severity === "CRITICAL" && "text-danger", n.severity === "WARNING" && "text-warning")}>{n.title}</span>
                    {n.body && <span className="block text-xs text-fg-muted">{n.body}</span>}
                    <span className="block text-[11px] text-fg-muted">{formatDateTime(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
