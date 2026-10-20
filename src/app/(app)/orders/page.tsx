"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ShoppingBasket } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, TableSkeleton, TableWrap, Tabs, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { api, formatDate, formatDateTime, qs, useApi } from "@/lib/client";
import { ORDER_STATUS, type OrderRow } from "./order-status";

type Tab = "open" | "all" | "reorder";

/** Supply orders (roadmap 7.4 to 7.6): open orders, every order, and what to reorder. */
function OrdersInner() {
  const sp = useSearchParams();
  const canOrder = useCan("purchases.create");
  const initial = sp.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial === "reorder" || initial === "all" ? initial : "open");
  return (
    <>
      <PageHeader title="Supply orders" subtitle="Orders to suppliers, what has arrived and what is still pending."
        actions={canOrder && <Link href="/orders/new" data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary/90"><Plus className="h-4 w-4" aria-hidden /> New order</Link>} />
      <Tabs tabs={[{ id: "open", label: "Open" }, { id: "all", label: "All orders" }, ...(canOrder ? [{ id: "reorder" as const, label: "Reorder suggestions" }] : [])]} value={tab} onChange={setTab} />
      <div className="mt-3">{tab === "reorder" ? <Reorder /> : <OrderList status={tab} />}</div>
    </>
  );
}

function OrderList({ status }: { status: "open" | "all" }) {
  const money = useMoney();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const { data, error, loading, reload } = useApi<{ items: OrderRow[]; total: number; page: number; pageSize: number }>(`/api/orders?${qs({ status, page })}`);
  return (
    <Card>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title={status === "open" ? "No open orders" : "No orders yet"} hint="Make one with New order, or from the reorder suggestions." /> : (
        <>
          <TableWrap>
            <thead><tr className="border-b border-border"><th className="th">Order</th><th className="th">Supplier</th><th className="th">Made</th><th className="th">Needed by</th><th className="th">Status</th><th className="th text-right">Lines</th><th className="th text-right">Pending units</th><th className="th text-right">Estimate</th></tr></thead>
            <tbody>{data.items.map((o) => {
              const late = o.expectedDate && ["SENT", "PARTIALLY_RECEIVED"].includes(o.status) && o.expectedDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
              return (
                <tr key={o.id} className="border-b border-border/60">
                  <td className="td font-medium"><Link className="text-primary hover:underline" href={`/orders/${o.id}`}>{o.number}</Link></td>
                  <td className="td">{o.supplier.name}</td>
                  <td className="td whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                  <td className="td whitespace-nowrap">{o.expectedDate ? formatDate(o.expectedDate) : ""} {late && <Badge tone="red">Overdue</Badge>}</td>
                  <td className="td"><Badge tone={ORDER_STATUS[o.status]?.tone ?? "slate"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge></td>
                  <td className="td text-right">{o.lines}</td><td className="td text-right">{o.pending}</td><td className="td text-right">{money(o.estimatedTotal)}</td>
                </tr>
              );
            })}</tbody>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

type Suggestion = { medicineId: string; name: string; unit: string; stock: number; onOrder: number; minStock: number; dailyUse: number; suggestedQty: number; supplierId: string | null; supplierName: string | null; lastPrice: number | null };

/** What runs low, with a quantity and a supplier for each; chosen lines become one draft per supplier. */
function Reorder() {
  const toast = useToast();
  const router = useRouter();
  const money = useMoney();
  const { data, error, loading, reload } = useApi<{ items: Suggestion[] }>("/api/orders/reorder");
  const suppliers = useApi<{ items: { id: string; name: string }[] }>("/api/suppliers?pageSize=100&active=1");
  const [picks, setPicks] = useState<Record<string, { on: boolean; qty: string; supplierId: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setPicks(Object.fromEntries(data.items.map((s) => [s.medicineId, { on: Boolean(s.supplierId), qty: String(s.suggestedQty), supplierId: s.supplierId ?? "" }])));
  }, [data]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <TableSkeleton />;
  if (!data.items.length) return <Card><EmptyState title="Nothing needs reordering" hint="Medicines appear here when stock plus what is on order falls to the minimum, or to what sells during the supplier's lead time." /></Card>;
  const chosen = data.items.filter((s) => picks[s.medicineId]?.on && picks[s.medicineId].supplierId && Number(picks[s.medicineId].qty) > 0);
  const supplierCount = new Set(chosen.map((s) => picks[s.medicineId].supplierId)).size;
  const set = (id: string, patch: Partial<{ on: boolean; qty: string; supplierId: string }>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ orders: { id: string; number: string }[] }>("/api/orders/reorder", { body: { picks: chosen.map((s) => ({ medicineId: s.medicineId, supplierId: picks[s.medicineId].supplierId, quantity: Number(picks[s.medicineId].qty) })) } });
      toast.success(`${r.orders.length} draft order${r.orders.length === 1 ? "" : "s"} made: ${r.orders.map((o) => o.number).join(", ")}`);
      router.push(r.orders.length === 1 ? `/orders/${r.orders[0].id}` : "/orders");
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <TableWrap>
        <thead><tr className="border-b border-border"><th className="th w-8" /><th className="th">Medicine</th><th className="th text-right">In stock</th><th className="th text-right">On order</th><th className="th text-right">Minimum</th><th className="th text-right">Sells a day</th><th className="th">Order</th><th className="th">From</th></tr></thead>
        <tbody>{data.items.map((s) => {
          const p = picks[s.medicineId];
          if (!p) return null;
          return (
            <tr key={s.medicineId} className="border-b border-border/60">
              <td className="td"><input type="checkbox" aria-label={`Order ${s.name}`} checked={p.on} onChange={(e) => set(s.medicineId, { on: e.target.checked })} /></td>
              <td className="td"><Link href={`/medicines/${s.medicineId}`} className="font-medium hover:text-primary hover:underline">{s.name}</Link>{s.lastPrice !== null && <span className="block text-xs text-fg-muted">last {money(s.lastPrice)}</span>}</td>
              <td className="td text-right">{s.stock === 0 ? <Badge tone="red">Out</Badge> : s.stock}</td>
              <td className="td text-right">{s.onOrder || ""}</td><td className="td text-right">{s.minStock}</td><td className="td text-right">{s.dailyUse || ""}</td>
              <td className="td"><Input aria-label={`Quantity of ${s.name}`} type="number" min="1" className="w-20" value={p.qty} onChange={(e) => set(s.medicineId, { qty: e.target.value })} /></td>
              <td className="td"><Select aria-label={`Supplier for ${s.name}`} className="min-w-[160px]" value={p.supplierId} onChange={(e) => set(s.medicineId, { supplierId: e.target.value, on: Boolean(e.target.value) })}>
                <option value="">Choose a supplier</option>
                {suppliers.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select></td>
            </tr>
          );
        })}</tbody>
      </TableWrap>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border p-3 text-sm">
        <span>{chosen.length} medicine{chosen.length === 1 ? "" : "s"} for {supplierCount} supplier{supplierCount === 1 ? "" : "s"}</span>
        <Button onClick={create} loading={busy} disabled={!chosen.length}><ShoppingBasket className="h-4 w-4" aria-hidden /> Make one draft per supplier</Button>
      </div>
    </Card>
  );
}

export default function OrdersPage() { return <Suspense><OrdersInner /></Suspense>; }
