"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, DollarSign, PackageX, ShoppingBasket, Table2, TrendingUp, Truck, Wallet, BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, ErrorBox, PageHeader, Skeleton, StatCard, TableWrap, Tabs } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { formatDate, formatDateTime, formatNum, useApi } from "@/lib/client";

type Figures = { grossSales: number; discounts: number; returns: number; netSales: number; cogs?: number; grossProfit?: number; stockLosses: number; expenses: number; netProfit?: number; purchases: number; invoiceCount: number };
type Dash = {
  today: { sales: string; invoices: number; profit: string | null };
  lowStockCount: number; lowStock: { id: string; name: string; stock: number; minStock: number }[];
  expiringCount: number; expiredCount: number; warningDays: number;
  expiringBatches: { id: string; batchNumber: string; quantity: number; expiryDate: string; daysLeft: number; medicine: { name: string } }[];
  salesChart: { label: string; total: string; invoices: number }[];
  topMedicines: { name: string; qty: number; revenue: string }[];
  receivables: string | null; payables: string | null;
  owner: null | {
    today: Figures; monthToDate: Figures; last30: number; previous30: number;
    trend: { day: string; label: string; current: number; previous: number }[];
    byCategory: { category: string; sales: string; profit?: string }[];
    expenses: { category: string; amount: string }[];
    cashDifferences: { id: string; user: string; closedAt: string; difference: string; note: string | null }[];
  };
  ops: null | {
    toReview: number; expiringSoon: number; alertDays: number; orderStatus: Record<string, number>;
    ordersDue: { id: string; number: string; expectedDate: string; supplier: { name: string } }[];
    adjustments: { id: string; type: string; quantity: number; createdAt: string; note: string | null; medicine: { id: string; name: string }; batch: { batchNumber: string }; user: { name: string } | null }[];
  };
};
const MOVE: Record<string, string> = { ADJUSTMENT: "Correction", DAMAGE: "Damaged", EXPIRY: "Expired", SUPPLIER_RETURN: "Returned to supplier" };
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);

/** Dashboards (roadmap 8.8; UI plan 4.4): the business view for the owner, the stock view for pharmacists. */
export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Dash>("/api/dashboard");
  const [view, setView] = useState<"business" | "operations" | null>(null);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  const current = view ?? (data.owner ? "business" : data.ops ? "operations" : null);
  return (
    <>
      <PageHeader title="Dashboard" subtitle={current === "business" ? "How the pharmacy is doing" : "What needs doing in stock"} />
      {data.owner && data.ops && <div className="mb-4"><Tabs tabs={[{ id: "business", label: "Business" }, { id: "operations", label: "Stock and orders" }]} value={current!} onChange={setView} /></div>}
      {current === "business" && data.owner ? <Business data={data} owner={data.owner} /> : current === "operations" && data.ops ? <Operations data={data} ops={data.ops} /> : <Basic data={data} />}
    </>
  );
}

function Business({ data, owner }: { data: Dash; owner: NonNullable<Dash["owner"]> }) {
  const money = useMoney();
  const [table, setTable] = useState(false);
  const change = pct(owner.last30, owner.previous30);
  const expenseTotal = owner.expenses.reduce((s, e) => s + Number(e.amount), 0);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Today's sales" value={money(owner.today.netSales)} hint={`${owner.today.invoiceCount} invoice${owner.today.invoiceCount === 1 ? "" : "s"}, after returns`} icon={<DollarSign className="h-5 w-5" />} tone="green" />
        <StatCard label="Today's gross profit" value={money(owner.today.grossProfit ?? 0)} icon={<TrendingUp className="h-5 w-5" />} tone="blue" />
        <StatCard label="Net profit this month" value={money(owner.monthToDate.netProfit ?? 0)} hint={`Sales ${money(owner.monthToDate.netSales)}, expenses ${money(owner.monthToDate.expenses)}`} icon={<BarChart3 className="h-5 w-5" />} tone={(owner.monthToDate.netProfit ?? 0) >= 0 ? "green" : "red"} />
        <StatCard label="Customers owe" value={money(data.receivables ?? 0)} icon={<Wallet className="h-5 w-5" />} />
        <StatCard label="Owed to suppliers" value={money(data.payables ?? 0)} icon={<Truck className="h-5 w-5" />} tone="amber" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Sales: last 30 days against the 30 before</h2>
              <p className="text-sm text-fg-muted">{money(owner.last30)} {change !== null && <Badge tone={change >= 0 ? "green" : "red"}>{change >= 0 ? "+" : ""}{change}%</Badge>} against {money(owner.previous30)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setTable(!table)} aria-pressed={table}><Table2 className="h-4 w-4" aria-hidden /> {table ? "Chart" : "Numbers"}</Button>
          </div>
          {table ? (
            <div className="max-h-64 overflow-y-auto"><TableWrap><thead><tr className="border-b border-border"><th className="th">Day</th><th className="th text-right">Sales</th><th className="th text-right">30 days before</th></tr></thead>
              <tbody>{owner.trend.map((t) => <tr key={t.day} className="border-b border-border/60"><td className="td">{formatDate(t.day)}</td><td className="td text-right">{money(t.current)}</td><td className="td text-right">{money(t.previous)}</td></tr>)}</tbody></TableWrap></div>
          ) : (
            <div className="h-64" role="img" aria-label="Line chart of daily sales for the last 30 days against the 30 days before">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={owner.trend} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b855" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} width={60} />
                  <Tooltip formatter={(v: number, name) => [money(v), name === "current" ? "Sales" : "30 days before"]} contentStyle={{ borderRadius: 8 }} />
                  <Legend formatter={(v) => (v === "current" ? "Last 30 days" : "The 30 days before")} />
                  <Line type="monotone" dataKey="current" stroke="rgb(var(--brand-600))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="previous" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Profit by category this month</h2>
          {!owner.byCategory.length ? <p className="py-8 text-center text-sm text-fg-muted">No sales this month yet.</p> : (
            <div className="h-64" role="img" aria-label="Bar chart of gross profit by category this month">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={owner.byCategory.map((c) => ({ ...c, profit: Number(c.profit ?? 0) }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="category" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [money(v), "Gross profit"]} contentStyle={{ borderRadius: 8 }} />
                  <Bar dataKey="profit" fill="rgb(var(--brand-600))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Expenses this month</h2><Link href="/expenses" className="text-sm text-primary hover:underline">All expenses</Link></div>
          {!owner.expenses.length ? <p className="py-6 text-center text-sm text-fg-muted">No expenses recorded this month.</p> : (
            <ul className="space-y-2 text-sm">{owner.expenses.map((e) => (
              <li key={e.category}>
                <div className="flex justify-between"><span>{e.category}</span><span className="font-medium">{money(e.amount)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.round((Number(e.amount) / expenseTotal) * 100)}%` }} /></div>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Cash drawer differences</h2><Link href="/cash" className="text-sm text-primary hover:underline">Cash drawer</Link></div>
          {!owner.cashDifferences.length ? <p className="py-6 text-center text-sm text-fg-muted">Every drawer closed in the last 30 days balanced.</p> : (
            <ul className="divide-y divide-border text-sm">{owner.cashDifferences.map((d) => (
              <li key={d.id} className="py-2"><Link href={`/cash/${d.id}`} className="flex justify-between hover:underline"><span>{d.user}, {formatDateTime(d.closedAt)}</span><Badge tone={Number(d.difference) < 0 ? "red" : "amber"}>{Number(d.difference) > 0 ? "+" : ""}{money(d.difference)}</Badge></Link>{d.note && <p className="text-xs text-fg-muted">{d.note}</p>}</li>
            ))}</ul>
          )}
        </Card>
        <TopSellers items={data.topMedicines} />
      </div>
      <p className="mt-4 text-xs text-fg-muted">Net profit = sales after discounts and returns, less the cost of the batches sold, stock written off and expenses. <Link href="/reports?type=pnl" className="text-primary hover:underline">Profit and loss</Link></p>
    </>
  );
}

function Operations({ data, ops }: { data: Dash; ops: NonNullable<Dash["ops"]> }) {
  const due = ops.ordersDue.length;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={`Expiring within ${ops.alertDays} days`} value={formatNum(ops.expiringSoon)} icon={<CalendarClock className="h-5 w-5" />} tone={ops.expiringSoon ? "amber" : "green"} />
        <StatCard label="Expired with stock" value={formatNum(data.expiredCount)} icon={<PackageX className="h-5 w-5" />} tone={data.expiredCount ? "red" : "green"} />
        <StatCard label="Low stock" value={formatNum(data.lowStockCount)} icon={<AlertTriangle className="h-5 w-5" />} tone={data.lowStockCount ? "amber" : "green"} />
        <StatCard label="Stock entries to review" value={formatNum(ops.toReview)} icon={<ClipboardCheck className="h-5 w-5" />} tone={ops.toReview ? "blue" : "green"} />
        <StatCard label="Orders due" value={formatNum(due)} hint={`${ops.orderStatus.SENT ?? 0} sent, ${ops.orderStatus.PARTIALLY_RECEIVED ?? 0} partly received, ${ops.orderStatus.DRAFT ?? 0} drafts`} icon={<ShoppingBasket className="h-5 w-5" />} tone={due ? "amber" : "green"} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between p-4 pb-2"><h2 className="font-semibold">Expiring and expired</h2><Link href="/inventory?tab=expiry" className="text-sm text-primary hover:underline">Write off or set aside</Link></div>
          {!data.expiringBatches.length ? <p className="p-6 text-center text-sm text-fg-muted">No batches are close to expiry.</p> : (
            <TableWrap><thead><tr className="border-b border-border"><th className="th">Medicine</th><th className="th">Batch</th><th className="th text-right">Qty</th><th className="th">Expiry</th></tr></thead>
              <tbody>{data.expiringBatches.map((b) => (
                <tr key={b.id} className="border-b border-border/60"><td className="td">{b.medicine.name}</td><td className="td">{b.batchNumber}</td><td className="td text-right">{b.quantity}</td>
                  <td className="td">{formatDate(b.expiryDate)} {b.daysLeft < 0 ? <Badge tone="red">Expired</Badge> : <Badge tone="amber">{b.daysLeft}d</Badge>}</td></tr>))}</tbody></TableWrap>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between p-4 pb-2"><h2 className="font-semibold">Low stock</h2><Link href="/orders?tab=reorder" className="text-sm text-primary hover:underline">Add to an order</Link></div>
          {!data.lowStock.length ? <p className="p-6 text-center text-sm text-fg-muted">All medicines are above their minimum.</p> : (
            <TableWrap><thead><tr className="border-b border-border"><th className="th">Medicine</th><th className="th text-right">In stock</th><th className="th text-right">Minimum</th></tr></thead>
              <tbody>{data.lowStock.map((m) => (
                <tr key={m.id} className="border-b border-border/60"><td className="td"><Link href={`/medicines/${m.id}`} className="hover:text-primary hover:underline">{m.name}</Link></td>
                  <td className="td text-right">{m.stock === 0 ? <Badge tone="red">Out</Badge> : <Badge tone="amber">{m.stock}</Badge>}</td><td className="td text-right">{m.minStock}</td></tr>))}</tbody></TableWrap>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between p-4 pb-2"><h2 className="font-semibold">Orders due</h2><Link href="/orders" className="text-sm text-primary hover:underline">Supply orders</Link></div>
          {!due ? <p className="p-6 text-center text-sm text-fg-muted">No order is due today or late.</p> : (
            <ul className="divide-y divide-border px-4 pb-2 text-sm">{ops.ordersDue.map((o) => (
              <li key={o.id} className="flex justify-between py-2"><Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.number}</Link><span>{o.supplier.name}, due {formatDate(o.expectedDate)}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <div className="p-4 pb-2"><h2 className="font-semibold">Recent corrections and write-offs</h2></div>
          {!ops.adjustments.length ? <p className="p-6 text-center text-sm text-fg-muted">None yet.</p> : (
            <ul className="divide-y divide-border px-4 pb-2 text-sm">{ops.adjustments.map((a) => (
              <li key={a.id} className="py-2"><div className="flex justify-between"><span><Link href={`/medicines/${a.medicine.id}`} className="hover:underline">{a.medicine.name}</Link>, batch {a.batch.batchNumber}</span><span className={a.quantity < 0 ? "text-danger" : "text-success"}>{a.quantity > 0 ? "+" : ""}{a.quantity}</span></div>
                <p className="text-xs text-fg-muted">{MOVE[a.type] ?? a.type}, {formatDateTime(a.createdAt)}{a.user ? `, ${a.user.name}` : ""}{a.note ? `: ${a.note}` : ""}</p></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** For roles with neither view (the counter's own summary is in the POS). */
function Basic({ data }: { data: Dash }) {
  const money = useMoney();
  const canReports = useCan("reports.view");
  const chart = data.salesChart.map((d) => ({ ...d, total: Number(d.total) }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's sales" value={money(data.today.sales)} hint={`${data.today.invoices} invoice${data.today.invoices === 1 ? "" : "s"}`} icon={<DollarSign className="h-5 w-5" />} tone="green" />
        <StatCard label="Low stock" value={formatNum(data.lowStockCount)} icon={<AlertTriangle className="h-5 w-5" />} tone={data.lowStockCount ? "amber" : "green"} />
        <StatCard label={`Expiring within ${data.warningDays} days`} value={formatNum(data.expiringCount)} icon={<CalendarClock className="h-5 w-5" />} tone={data.expiringCount ? "amber" : "green"} />
        <StatCard label="Expired with stock" value={formatNum(data.expiredCount)} icon={<PackageX className="h-5 w-5" />} tone={data.expiredCount ? "red" : "green"} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <h2 className="mb-3 font-semibold">Sales: last 14 days</h2>
          <div className="h-64" role="img" aria-label="Bar chart of daily sales for the last 14 days">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b855" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={56} />
                <Tooltip formatter={(v: number) => [money(v), "Sales"]} contentStyle={{ borderRadius: 8 }} />
                <Bar dataKey="total" fill="rgb(var(--brand-600))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <TopSellers items={data.topMedicines} />
      </div>
      {canReports && <p className="mt-4 text-xs text-fg-muted">See Reports for details.</p>}
    </>
  );
}

function TopSellers({ items }: { items: Dash["topMedicines"] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">Top sellers (30 days)</h2>
      {!items.length ? <p className="py-8 text-center text-sm text-fg-muted">No sales yet.</p> : (
        <ol className="space-y-3">{items.map((m, i) => (
          <li key={m.name} className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
            <span className="text-sm font-medium">{formatNum(m.qty)} sold</span>
          </li>
        ))}</ol>
      )}
    </Card>
  );
}
