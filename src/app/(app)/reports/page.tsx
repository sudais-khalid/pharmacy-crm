"use client";
import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, TableSkeleton, TableWrap } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { downloadCsv, formatDate, formatNum, qs, useApi } from "@/lib/client";

type Col = { key: string; label: string; format?: "money" | "int" | "date" | "text" | "percent" };
type Report = { title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, string> | null; from: string; to: string };

const COST_REPORTS = ["profit", "purchases"];
const ALL_TYPES: [string, string, boolean][] = [
  ["sales", "Sales", true], ["profit", "Profit", true], ["purchases", "Purchases", true],
  ["lowStock", "Low stock", false], ["expired", "Expired medicines", false], ["customerBalances", "Customer balances", false], ["supplierBalances", "Supplier payables", false],
];

export default function ReportsPage() {
  const { settings, permissions } = useApp();
  const TYPES = permissions.includes("cost.view") ? ALL_TYPES : ALL_TYPES.filter((t) => !COST_REPORTS.includes(t[0]));
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState("sales"); const [from, setFrom] = useState(today.slice(0, 8) + "01"); const [to, setTo] = useState(today); const [group, setGroup] = useState("day");
  const ranged = TYPES.find((t) => t[0] === type)![2];
  const { data, error, loading, reload } = useApi<Report>(`/api/reports?${qs({ type, from, to, group })}`);
  const fmt = (col: Col, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (col.format === "money") return `${settings.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (col.format === "int") return formatNum(v);
    if (col.format === "date") return formatDate(String(v));
    return String(v);
  };
  return (
    <>
      <PageHeader title="Reports" subtitle="Calculated live from your database." actions={data && <>
        <Button variant="secondary" onClick={() => downloadCsv(`${type}-${from}-${to}.csv`, data.columns, data.rows)} disabled={!data.rows.length}><Download className="h-4 w-4" /> Export CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></>} />
      <Card className="no-print mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Report" className="min-w-[200px]"><Select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {ranged && <>
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Group by"><Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day</option><option value="month">Month</option></Select></Field></>}
      </Card>
      <Card className="print-area">
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : data && (
          <>
            <div className="border-b border-slate-200 p-4 dark:border-slate-800"><h2 className="text-lg font-semibold">{data.title}</h2>
              <p className="text-sm text-slate-500">{ranged ? `${formatDate(data.from)} – ${formatDate(data.to)} · ` : ""}{data.description}</p></div>
            {data.rows.length === 0 ? <EmptyState title="No data for this report" hint="Try a wider date range." /> : (
              <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800">{data.columns.map((c) => <th key={c.key} className={`th ${c.format === "money" || c.format === "int" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i} className="border-b border-slate-100 dark:border-slate-800/60">{data.columns.map((c) => <td key={c.key} className={`td ${c.format === "money" || c.format === "int" ? "text-right" : ""}`}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
                {data.totals && <tfoot><tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">{data.columns.map((c, i) => <td key={c.key} className={`td ${c.format === "money" || c.format === "int" ? "text-right" : ""}`}>{i === 0 ? "Total" : data.totals![c.key] !== undefined ? fmt(c, data.totals![c.key]) : ""}</td>)}</tr></tfoot>}
              </TableWrap>
            )}
          </>
        )}
      </Card>
    </>
  );
}
