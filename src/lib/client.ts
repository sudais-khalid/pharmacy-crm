"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/")) {
      window.location.href = url.startsWith("/api/platform/") ? "/platform/login" : "/login";
    }
    throw new ApiError(data.error || "Request failed", res.status, data.fields);
  }
  return data as T;
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    api<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  return sp.toString();
}

export function formatMoney(v: unknown, currency = "PKR") {
  const n = Number(v ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNum(v: unknown) {
  return Number(v ?? 0).toLocaleString("en-US");
}

/** Date-only values (expiry etc.) → DD/MM/YYYY without timezone shifts. */
export function formatDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const s = typeof v === "string" ? v : v.toISOString();
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
