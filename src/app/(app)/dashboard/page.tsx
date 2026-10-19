"use client";
import Link from "next/link";
import { AlertTriangle, CalendarClock, DollarSign, Pill, ShoppingBag, TrendingUp, Users, PackageX, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, ErrorBox, PageHeader, Skeleton, StatCard, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { formatDate, formatNum, useApi } from "@/lib/client";

type Dash = {
  today: { sales: string; invoices: number; profit: string | null };
  totalCustomers: number; totalMedicines: number; lowStockCount: number;
  lowStock: { id: string; name: string; stock: number; minStock: number }[];
  expiringCount: number; expiredCount: number; warningDays: number;
  expiringBatches: { id: string; batchNumber: string; quantity: number; expiryDate: string; daysLeft: number; medicine: { name: string } }[];
  salesChart: { label: string; total: string; invoices: number }[];
  topMedicines: { name: string; qty: number; revenue: string }[];
  receivables: string | null; payables: string | null;
};

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Dash>("/api/dashboard");
  const money = useMoney();
  const canReports = useCan("reports.view");

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  const chart = data.salesChart.map((d) => ({ ...d, total: Number(d.total) }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live overview of your pharmacy" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's sales" value={money(data.today.sales)} hint={`${data.today.invoices} invoice${data.today.invoices === 1 ? "" : "s"}`} icon={<DollarSign className="h-5 w-5" />} tone="green" />
        {data.today.profit !== null ? <StatCard label="Today's gross profit" value={money(data.today.profit)} icon={<TrendingUp className="h-5 w-5" />} tone="blue" /> : <StatCard label="Invoices today" value={formatNum(data.today.invoices)} icon={<ShoppingBag className="h-5 w-5" />} tone="blue" />}
        <StatCard label="Customers" value={formatNum(data.totalCustomers)} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Medicines" value={formatNum(data.totalMedicines)} icon={<Pill className="h-5 w-5" />} />
        <StatCard label="Low-stock medicines" value={formatNum(data.lowStockCount)} icon={<AlertTriangle className="h-5 w-5" />} tone={data.lowStockCount ? "amber" : "green"} />
        <StatCard label={`Expiring ≤ ${data.warningDays} days`} value={formatNum(data.expiringCount)} icon={<CalendarClock className="h-5 w-5" />} tone={data.expiringCount ? "amber" : "green"} />
        <StatCard label="Expired batches in stock" value={formatNum(data.expiredCount)} icon={<PackageX className="h-5 w-5" />} tone={data.expiredCount ? "red" : "green"} />
        {data.receivables !== null && <StatCard label="Customer credit (udhaar)" value={money(data.receivables)} hint={`Supplier payable ${money(data.payables)}`} icon={<Wallet className="h-5 w-5" />} />}
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
                <Bar dataKey="total" fill="#2a9d93" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Top sellers (30 days)</h2>
          {data.topMedicines.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No sales yet.</p> : (
            <ol className="space-y-3">
              {data.topMedicines.map((m, i) => (
                <li key={m.name} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="text-sm font-medium">{formatNum(m.qty)} sold</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between p-4 pb-2"><h2 className="font-semibold">Low-stock medicines</h2><Link href="/medicines?stock=low" className="text-sm text-brand-700 hover:underline dark:text-brand-300">View all</Link></div>
          {data.lowStock.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">All medicines are above their minimum level.</p> : (
            <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Medicine</th><th className="th text-right">In stock</th><th className="th text-right">Minimum</th></tr></thead>
              <tbody>{data.lowStock.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td">{m.name}</td>
                  <td className="td text-right">{m.stock === 0 ? <Badge tone="red">Out of stock</Badge> : <Badge tone="amber">{m.stock} left</Badge>}</td>
                  <td className="td text-right">{m.minStock}</td></tr>))}</tbody></TableWrap>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between p-4 pb-2"><h2 className="font-semibold">Expiring / expired batches</h2><Link href="/inventory?tab=expiry" className="text-sm text-brand-700 hover:underline dark:text-brand-300">View all</Link></div>
          {data.expiringBatches.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No batches are close to expiry.</p> : (
            <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Medicine</th><th className="th">Batch</th><th className="th text-right">Qty</th><th className="th">Expiry</th></tr></thead>
              <tbody>{data.expiringBatches.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td">{b.medicine.name}</td><td className="td">{b.batchNumber}</td><td className="td text-right">{b.quantity}</td>
                  <td className="td">{formatDate(b.expiryDate)} {b.daysLeft < 0 ? <Badge tone="red">Expired</Badge> : <Badge tone="amber">{b.daysLeft}d</Badge>}</td></tr>))}</tbody></TableWrap>
          )}
        </Card>
      </div>
      {canReports && <p className="mt-4 text-xs text-slate-500">Profit = net sales − cost of the exact batches sold. See Reports for details.</p>}
    </>
  );
}
