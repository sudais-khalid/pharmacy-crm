"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, TableSkeleton, TableWrap } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { downloadCsv, formatDate, formatNum, qs, useApi } from "@/lib/client";

type Col = { key: string; label: string; format?: "money" | "int" | "date" | "text" | "percent" };
type Report = {
  type: string; title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, string> | null; from: string; to: string; ranged: boolean;
  comparison: { label: string; current: number; previous: number; previousFrom: string; previousTo: string } | null;
};
type Listed = { id: string; title: string; group: string; ranged: boolean; grouped: boolean };

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Date presets (roadmap 8.4); weeks start on Monday. */
function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const monday = new Date(y, m, d - ((now.getDay() + 6) % 7));
  return [
    { id: "today", label: "Today", from: iso(now), to: iso(now) },
    { id: "yesterday", label: "Yesterday", from: iso(new Date(y, m, d - 1)), to: iso(new Date(y, m, d - 1)) },
    { id: "week", label: "This week", from: iso(monday), to: iso(now) },
    { id: "month", label: "This month", from: iso(new Date(y, m, 1)), to: iso(now) },
    { id: "lastMonth", label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { id: "year", label: "This year", from: iso(new Date(y, 0, 1)), to: iso(now) },
  ];
}
const numeric = (c: Col) => c.format === "money" || c.format === "int" || c.format === "percent";

function ReportsInner() {
  const { settings } = useApp();
  const sp = useSearchParams();
  const list = useApi<{ items: Listed[] }>("/api/reports/list");
  const PRESETS = presets();
  const month = PRESETS.find((p) => p.id === "month")!;
  const [type, setType] = useState(sp.get("type") || "sales");
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const [group, setGroup] = useState("day");
  const def = list.data?.items.find((r) => r.id === type);
  const params = qs({ type, from, to, group });
  const { data, error, loading, reload } = useApi<Report>(list.data ? `/api/reports?${params}` : null);
  const groups = [...new Set(list.data?.items.map((r) => r.group))];
  const preset = PRESETS.find((p) => p.from === from && p.to === to)?.id ?? "";
  const fmt = (col: Col, v: unknown) => {
    if (v === null || v === undefined || v === "") return "-";
    if (col.format === "money") return `${settings.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (col.format === "int") return formatNum(v);
    if (col.format === "percent") return `${Number(v).toFixed(1)}%`;
    if (col.format === "date") return formatDate(String(v));
    return String(v);
  };
  const cmp = data?.comparison;
  const change = cmp && cmp.previous ? Math.round(((cmp.current - cmp.previous) / Math.abs(cmp.previous)) * 100) : null;
  if (list.error) return <ErrorBox message={list.error} onRetry={list.reload} />;
  return (
    <>
      <PageHeader title="Reports" subtitle="Calculated live from your records." actions={data && <>
        <Button variant="secondary" onClick={() => downloadCsv(`${type}-${from}-${to}.csv`, data.columns, data.rows)} disabled={!data.rows.length}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
        <a href={`/api/reports/export?${params}`} className={`inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-muted ${data.rows.length ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!data.rows.length}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel</a>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button></>} />
      <Card className="no-print mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Report" className="min-w-[220px]"><Select value={type} onChange={(e) => setType(e.target.value)}>
          {!list.data && <option>Loading</option>}
          {groups.map((g) => <optgroup key={g} label={g}>{list.data!.items.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</optgroup>)}
        </Select></Field>
        {def?.ranged && <>
          <Field label="Period"><Select value={preset} onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) { setFrom(p.from); setTo(p.to); } }}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}{!preset && <option value="">Custom</option>}</Select></Field>
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          {def.grouped && <Field label="Group by"><Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day</option><option value="month">Month</option></Select></Field>}</>}
      </Card>
      {list.data && !def ? <EmptyState title="This report is not available to you" hint="Choose another report from the list." /> : (
        <Card className="print-area">
          {error ? <ErrorBox message={error} onRetry={reload} /> : (loading && !data) || !data ? <TableSkeleton /> : (
            <>
              <div className="print-only border-b border-border p-4 text-center">
                <p className="text-lg font-bold">{settings.pharmacyName}</p>
                <p className="text-xs">{[settings.address, settings.city, settings.phone].filter(Boolean).join(", ")}</p>
                {settings.licenseNumber && <p className="text-xs">Licence {settings.licenseNumber}</p>}
              </div>
              <div className="border-b border-border p-4"><h2 className="text-lg font-semibold">{data.title}</h2>
                <p className="text-sm text-fg-muted">{data.ranged ? `${formatDate(data.from)} to ${formatDate(data.to)}. ` : `As of ${formatDate(new Date())}. `}{data.description}</p></div>
              {cmp && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border bg-muted/40 px-4 py-3 text-sm">
                  <span>{cmp.label}: <strong>{fmt({ key: "", label: "", format: "money" }, cmp.current)}</strong></span>
                  <span className="text-fg-muted">Same length before ({formatDate(cmp.previousFrom)} to {formatDate(cmp.previousTo)}): {fmt({ key: "", label: "", format: "money" }, cmp.previous)}</span>
                  {change !== null && <Badge tone={change >= 0 ? "green" : "red"}>{change >= 0 ? "+" : ""}{change}%</Badge>}
                </div>
              )}
              {data.rows.length === 0 ? <EmptyState title="Nothing to show for this report" hint={data.ranged ? "Try a wider date range." : undefined} /> : (
                <TableWrap><thead><tr className="border-b border-border">{data.columns.map((c) => <th key={c.key} className={`th ${numeric(c) ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r, i) => <tr key={i} className="border-b border-border/60">{data.columns.map((c) => <td key={c.key} className={`td ${numeric(c) ? "text-right" : ""}`}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
                  {data.totals && <tfoot><tr className="border-t-2 border-border font-semibold">{data.columns.map((c, i) => <td key={c.key} className={`td ${numeric(c) ? "text-right" : ""}`}>{i === 0 ? "Total" : data.totals![c.key] !== undefined ? fmt(c, data.totals![c.key]) : ""}</td>)}</tr></tfoot>}
                </TableWrap>
              )}
              <p className="print-only p-4 text-xs">Printed {new Date().toLocaleString()}</p>
            </>
          )}
        </Card>
      )}
    </>
  );
}

/** Reports (roadmap 8.3 to 8.7): grouped list, date presets, comparison with the period before, CSV, Excel and print. */
export default function ReportsPage() {
  return <Suspense fallback={<TableSkeleton />}><ReportsInner /></Suspense>;
}
