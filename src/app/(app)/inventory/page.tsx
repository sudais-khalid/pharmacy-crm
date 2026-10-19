"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Tabs, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { api, formatDate, formatDateTime, formatNum, qs, useApi, useDebounce } from "@/lib/client";

type Batch = { id: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: string; salePrice: string; daysLeft: number; medicine: { id: string; name: string; genericName: string | null } };
type BatchList = { items: Batch[]; total: number; page: number; pageSize: number; summary: { units: number; stockValueCost?: string; stockValueRetail: string }; warningDays: number };
type Tab = "batches" | "expiry" | "low" | "movements";

function InventoryInner() {
  const sp = useSearchParams();
  const initial = (sp.get("tab") as Tab) || "batches";
  const [tab, setTab] = useState<Tab>(["batches", "expiry", "low", "movements"].includes(initial) ? initial : "batches");
  return (
    <>
      <PageHeader title="Inventory" subtitle="Batch-wise stock, expiry control and a full audit trail of every stock change." />
      <Tabs tabs={[{ id: "batches", label: "Batches" }, { id: "expiry", label: "Expiry" }, { id: "low", label: "Low stock" }, { id: "movements", label: "Stock movements" }]} value={tab} onChange={setTab} />
      {tab === "batches" && <BatchesTab />}
      {tab === "expiry" && <ExpiryTab />}
      {tab === "low" && <LowStockTab />}
      {tab === "movements" && <MovementsTab />}
    </>
  );
}

function BatchTable({ rows, onAdjust, showValues }: { rows: Batch[]; onAdjust?: (b: Batch) => void; showValues?: boolean }) {
  const money = useMoney();
  const seesCost = useCan("cost.view");
  return (
    <TableWrap>
      <thead><tr className="border-b border-slate-200 dark:border-slate-800">
        <th className="th">Medicine</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th>
        {seesCost && <th className="th text-right">Cost</th>}<th className="th text-right">Price</th>{showValues && <>{seesCost && <th className="th text-right">Purchase value</th>}<th className="th text-right">Sale value</th></>}{onAdjust && <th className="th text-right">Adjust</th>}
      </tr></thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60">
            <td className="td font-medium">{b.medicine.name}</td><td className="td">{b.batchNumber}</td>
            <td className="td">{formatDate(b.expiryDate)}{" "}
              {b.quantity > 0 && (b.daysLeft < 0 ? <Badge tone="red">Expired {-b.daysLeft}d ago</Badge> : b.daysLeft <= 30 ? <Badge tone="amber">{b.daysLeft} days left</Badge> : <span className="text-xs text-slate-500">{b.daysLeft}d</span>)}</td>
            <td className="td text-right">{b.quantity}</td>{seesCost && <td className="td text-right">{money(b.purchasePrice)}</td>}<td className="td text-right">{money(b.salePrice)}</td>
            {showValues && <>{seesCost && <td className="td text-right">{money(Number(b.purchasePrice) * b.quantity)}</td>}<td className="td text-right">{money(Number(b.salePrice) * b.quantity)}</td></>}
            {onAdjust && <td className="td text-right"><Button size="sm" variant="ghost" aria-label={`Adjust ${b.medicine.name} batch ${b.batchNumber}`} onClick={() => onAdjust(b)}><SlidersHorizontal className="h-4 w-4" /></Button></td>}
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function BatchesTab() {
  const money = useMoney();
  const canAdjust = useCan("inventory.adjust");
  const [q, setQ] = useState(""); const [filter, setFilter] = useState("instock"); const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, filter]);
  const { data, error, loading, reload } = useApi<BatchList>(`/api/inventory/batches?${qs({ q: dq, filter, page })}`);
  const [adjusting, setAdjusting] = useState<Batch | null>(null);
  return (
    <>
      {data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <StatCard label="Sellable units" value={formatNum(data.summary.units)} icon={<span className="text-sm font-bold">#</span>} />
          {data.summary.stockValueCost !== undefined && <StatCard label="Stock value (cost)" value={money(data.summary.stockValueCost)} icon={<span className="text-sm font-bold">₨</span>} tone="blue" />}
          <StatCard label="Stock value (retail)" value={money(data.summary.stockValueRetail)} icon={<span className="text-sm font-bold">₨</span>} tone="green" />
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <SearchInput value={q} onChange={setQ} placeholder="Search medicine or batch number" className="min-w-[220px] flex-1" />
          <Select aria-label="Batch filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
            <option value="instock">In stock (not expired)</option><option value="expiring">Expiring soon</option><option value="expired">Expired (with stock)</option><option value="empty">Empty batches</option><option value="all">All batches</option>
          </Select>
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No batches match" hint="Stock arrives through Purchases or as opening stock when adding a medicine." /> : (
          <><BatchTable rows={data.items} onAdjust={canAdjust ? setAdjusting : undefined} /><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
        )}
      </Card>
      {adjusting && <AdjustModal batch={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); reload(); }} />}
    </>
  );
}

function ExpiryTab() {
  const [range, setRange] = useState("expired");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range]);
  const params = range === "expired" ? { filter: "expired" } : { filter: "expiring", days: range === "setting" ? "" : range };
  const { data, error, loading, reload } = useApi<BatchList>(`/api/inventory/batches?${qs({ ...params, page })}`);
  const ranges = [["expired", "Expired"], ["7", "Within 7 days"], ["30", "Within 30 days"], ["60", "Within 60 days"], ["90", "Within 90 days"], ["setting", "Warning period (Settings)"]];
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-slate-200 p-4 dark:border-slate-800" role="group" aria-label="Expiry range">
        {ranges.map(([v, l]) => <Button key={v} size="sm" variant={range === v ? "primary" : "secondary"} aria-pressed={range === v} onClick={() => setRange(v)}>{l}</Button>)}
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="Nothing here" hint="No batches with stock fall in this range." /> : (
        <><BatchTable rows={data.items} showValues /><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
      )}
      {range === "expired" && !!data?.items.length && <p className="border-t border-slate-200 p-3 text-xs text-slate-500 dark:border-slate-800">Expired stock can never be sold. Remove it from the Batches tab using Adjust, then Expired.</p>}
    </Card>
  );
}

function LowStockTab() {
  const canCreate = useCan("purchases.create");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ items: { id: string; name: string; genericName: string | null; stock: number; minStock: number; category: { name: string } | null }[]; total: number; page: number; pageSize: number }>(`/api/medicines?${qs({ stock: "low", page })}`);
  return (
    <Card>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="Everything is well stocked" /> : (
        <>
          <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Medicine</th><th className="th">Category</th><th className="th text-right">In stock</th><th className="th text-right">Minimum</th></tr></thead>
            <tbody>{data.items.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.genericName}</div></td><td className="td">{m.category?.name ?? "-"}</td>
                <td className="td text-right">{m.stock === 0 ? <Badge tone="red">Out of stock</Badge> : <Badge tone="amber">{m.stock}</Badge>}</td><td className="td text-right">{m.minStock}</td></tr>))}</tbody></TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          {canCreate && <div className="border-t border-slate-200 p-3 dark:border-slate-800"><Link href="/purchases/new" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Create a purchase to restock →</Link></div>}
        </>
      )}
    </Card>
  );
}

type Move = { id: string; type: string; quantity: number; balanceAfter: number; reference: string | null; note: string | null; createdAt: string; medicine: { name: string }; batch: { batchNumber: string }; user: { name: string } | null };
function MovementsTab() {
  const [q, setQ] = useState(""); const [type, setType] = useState(""); const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, type]);
  const { data, error, loading, reload } = useApi<{ items: Move[]; total: number; page: number; pageSize: number }>(`/api/inventory/movements?${qs({ q: dq, type, page, pageSize: 25 })}`);
  const tone = (t: string) => (t === "SALE" || t === "DAMAGE" || t === "EXPIRY" ? "red" : t === "PURCHASE" || t === "OPENING" || t === "SALE_CANCEL" ? "green" : "blue") as "red" | "green" | "blue";
  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <SearchInput value={q} onChange={setQ} placeholder="Search medicine, batch or reference" className="min-w-[220px] flex-1" />
        <Select aria-label="Movement type" value={type} onChange={(e) => setType(e.target.value)} className="w-44"><option value="">All types</option>{["OPENING", "PURCHASE", "SALE", "SALE_CANCEL", "ADJUSTMENT", "DAMAGE", "EXPIRY"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No stock movements yet" /> : (
        <><TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">When</th><th className="th">Type</th><th className="th">Medicine</th><th className="th">Batch</th><th className="th text-right">Change</th><th className="th text-right">Balance</th><th className="th">Reference</th><th className="th">By</th></tr></thead>
          <tbody>{data.items.map((m) => (
            <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td whitespace-nowrap">{formatDateTime(m.createdAt)}</td><td className="td"><Badge tone={tone(m.type)}>{m.type.replace("_", " ")}</Badge></td><td className="td">{m.medicine.name}</td><td className="td">{m.batch.batchNumber}</td>
              <td className={`td text-right font-medium ${m.quantity < 0 ? "text-red-600" : "text-emerald-600"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td><td className="td text-right">{m.balanceAfter}</td>
              <td className="td">{m.reference ?? m.note ?? "-"}</td><td className="td">{m.user?.name ?? "-"}</td></tr>))}</tbody></TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
      )}
    </Card>
  );
}

function AdjustModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState("REMOVE"); const [quantity, setQuantity] = useState(""); const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try { await api("/api/inventory/adjust", { body: { batchId: batch.id, kind, quantity, note } }); toast.success("Stock updated"); onDone(); }
    catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Adjust stock" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="adj-form" loading={saving}>Apply</Button></>}>
      <p className="mb-4 text-sm"><b>{batch.medicine.name}</b> · batch {batch.batchNumber} · currently <b>{batch.quantity}</b> units</p>
      <form id="adj-form" onSubmit={submit} className="space-y-4">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="ADD">Add stock (count correction)</option><option value="REMOVE">Remove stock (count correction)</option><option value="DAMAGE">Damaged</option><option value="EXPIRY">Expired: write off</option></Select></Field>
        <Field label="Quantity"><Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required data-autofocus /></Field>
        <Field label="Reason" hint="Recorded in the stock movement history"><Textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} /></Field>
      </form>
    </Modal>
  );
}

export default function InventoryPage() { return <Suspense><InventoryInner /></Suspense>; }
