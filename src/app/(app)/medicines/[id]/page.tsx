"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil, Printer, Route } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Tabs, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { HistoryList } from "@/components/history";
import { MedicineSales } from "@/components/medicine-sales";
import { formatDate, formatDateTime, qs, useApi } from "@/lib/client";

type Batch = { id: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice?: string; salePrice: string; setAsideAt: string | null; setAsideNote: string | null };
type Medicine = {
  id: string; name: string; genericName: string | null; barcode: string | null; sku: string | null; unit: string; purchasePrice?: string; salePrice: string; minStock: number;
  prescriptionRequired: boolean; active: boolean; description: string | null; category: { name: string } | null; stock: number; batches: Batch[];
};
type Tab = "batches" | "card" | "sales" | "prices" | "suppliers" | "history";

/** Everything about one medicine (roadmap 6.8): batches with recall trace, stock card, sales, prices, suppliers and history. */
function MedicineInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const money = useMoney();
  const canManage = useCan("medicines.manage");
  const seesCost = useCan("cost.view");
  const seesSales = useCan("sales.view");
  const seesPurchases = useCan("purchases.view");
  const seesStock = useCan("inventory.view");
  const canAudit = useCan("audit.view");
  const { data, error, reload } = useApi<Medicine>(`/api/medicines/${id}`);
  const [tab, setTab] = useState<Tab>("batches");
  const [trace, setTrace] = useState<string | null>(sp.get("batch"));

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const today = new Date().toISOString().slice(0, 10);
  const tabs = [
    { id: "batches" as const, label: "Batches" },
    ...(seesStock ? [{ id: "card" as const, label: "Stock card" }] : []),
    ...(seesSales ? [{ id: "sales" as const, label: "Sales" }] : []),
    ...(seesPurchases ? [{ id: "prices" as const, label: "Purchase prices" }, { id: "suppliers" as const, label: "Suppliers" }] : []),
    ...(canAudit ? [{ id: "history" as const, label: "History" }] : []),
  ];

  return (
    <>
      <Link href="/medicines" className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" /> Medicines</Link>
      <PageHeader title={data.name} subtitle={[data.genericName, data.category?.name, data.unit].filter(Boolean).join(", ")}
        actions={canManage && <Link href={`/medicines?edit=${data.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted"><Pencil className="h-4 w-4" aria-hidden /> Edit</Link>} />
      <Card className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <dl className="contents">
        {([
          ["Sellable stock", <span key="s">{data.stock} {data.stock === 0 ? <Badge tone="red">Out</Badge> : data.stock <= data.minStock ? <Badge tone="amber">Low</Badge> : null}</span>],
          ["Minimum", data.minStock],
          ["Sale price", money(data.salePrice)],
          ...(seesCost && data.purchasePrice ? [["Cost price", money(data.purchasePrice)] as [string, React.ReactNode]] : []),
          ["Barcode", data.barcode ?? "-"],
          ["SKU", data.sku ?? "-"],
          ["Prescription", data.prescriptionRequired ? "Required" : "Not needed"],
          ["Status", data.active ? "Active" : "Archived"],
        ] as [string, React.ReactNode][]).map(([k, v]) => <div key={k}><dt className="text-xs text-fg-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      </Card>
      {data.description && <p className="mb-4 text-sm text-fg-muted">{data.description}</p>}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-3">
        {tab === "batches" && (
          <Card>
            {!data.batches.length ? <EmptyState title="No batches yet" hint="Stock arrives through Stock entry." /> : (
              <TableWrap>
                <thead><tr className="border-b border-border"><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th>{seesCost && <th className="th text-right">Cost</th>}<th className="th text-right">Price</th><th className="th text-right">Trace</th></tr></thead>
                <tbody>{data.batches.map((b) => (
                  <tr key={b.id} className="border-b border-border/60">
                    <td className="td font-medium">{b.batchNumber} {b.setAsideAt && <Badge tone="amber">Set aside</Badge>}</td>
                    <td className="td">{formatDate(b.expiryDate)} {b.expiryDate.slice(0, 10) < today && <Badge tone="red">Expired</Badge>}</td>
                    <td className="td text-right">{b.quantity}</td>
                    {seesCost && <td className="td text-right">{b.purchasePrice ? money(b.purchasePrice) : ""}</td>}
                    <td className="td text-right">{money(b.salePrice)}</td>
                    <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setTrace(b.id)} aria-label={`Trace batch ${b.batchNumber}`}><Route className="h-4 w-4" aria-hidden /> Trace</Button></td>
                  </tr>))}</tbody>
              </TableWrap>
            )}
          </Card>
        )}
        {tab === "card" && <StockCard medicineId={data.id} />}
        {tab === "sales" && <Card className="p-3"><MedicineSales medicineId={data.id} /></Card>}
        {(tab === "prices" || tab === "suppliers") && <Purchases medicineId={data.id} view={tab} />}
        {tab === "history" && <Card><HistoryList entity="Medicine" entityId={data.id} /></Card>}
      </div>
      {trace && <TraceDialog batchId={trace} onClose={() => setTrace(null)} />}
    </>
  );
}

type CardData = {
  opening: number; closing: number; totalIn: number; totalOut: number; in: Record<string, number>; out: Record<string, number>; truncated: boolean;
  lines: { id: string; type: string; quantity: number; balance: number; reference: string | null; note: string | null; createdAt: string; batchNumber: string; userName: string | null }[];
};
const TYPE: Record<string, string> = { OPENING: "Opening stock", PURCHASE: "Purchase", SALE: "Sale", SALE_CANCEL: "Sale cancelled", SALE_RETURN: "Customer return", ADJUSTMENT: "Correction", DAMAGE: "Damaged", EXPIRY: "Expired", SUPPLIER_RETURN: "Returned to supplier" };

/** Stock card (roadmap 6.5): opening, in and out by type, every movement with the running balance, closing. */
function StockCard({ medicineId }: { medicineId: string }) {
  const to0 = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(to0);
  const { data, error, reload } = useApi<CardData>(`/api/inventory/stock-card?${qs({ medicineId, from, to })}`);
  return (
    <Card>
      <div className="no-print flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <>
          <div className="grid gap-4 border-b border-border p-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-fg-muted">Opening</p><p className="text-lg font-semibold">{data.opening}</p></div>
            <div><p className="text-xs text-fg-muted">In</p><p className="text-lg font-semibold text-success">+{data.totalIn}</p><p className="text-xs text-fg-muted">{Object.entries(data.in).map(([k, v]) => `${TYPE[k] ?? k} ${v}`).join(", ")}</p></div>
            <div><p className="text-xs text-fg-muted">Out</p><p className="text-lg font-semibold text-danger">-{data.totalOut}</p><p className="text-xs text-fg-muted">{Object.entries(data.out).map(([k, v]) => `${TYPE[k] ?? k} ${v}`).join(", ")}</p></div>
            <div><p className="text-xs text-fg-muted">Closing</p><p className="text-lg font-semibold">{data.closing}</p></div>
          </div>
          {!data.lines.length ? <EmptyState title="No stock moved in these days" /> : (
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">When</th><th className="th">Movement</th><th className="th">Batch</th><th className="th">Reference</th><th className="th text-right">In</th><th className="th text-right">Out</th><th className="th text-right">Balance</th></tr></thead>
              <tbody>{data.lines.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="td whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                  <td className="td">{TYPE[l.type] ?? l.type}{l.userName && <span className="block text-xs text-fg-muted">{l.userName}</span>}</td>
                  <td className="td">{l.batchNumber}</td>
                  <td className="td">{l.reference ?? l.note ?? ""}</td>
                  <td className="td text-right text-success">{l.quantity > 0 ? l.quantity : ""}</td>
                  <td className="td text-right text-danger">{l.quantity < 0 ? -l.quantity : ""}</td>
                  <td className="td text-right font-medium">{l.balance}</td>
                </tr>))}</tbody>
            </TableWrap>
          )}
          {data.truncated && <p className="p-3 text-xs text-warning">Showing the first 2,000 movements. Choose fewer days to see them all; the totals above cover the whole range.</p>}
        </>
      )}
    </Card>
  );
}

type PurchaseLine = { id: string; batchNumber: string; quantity: number; bonusQty: number; purchasePrice?: string; discountPercent: string; effectiveCost?: string; salePrice: string; purchase: { id: string; number: string; purchaseDate: string; supplierInvoice: string | null; supplier: { id: string; name: string } } };
type Supplier = { id: string; name: string; purchases: number; units: number; lastDate: string; purchasePrice?: string };

function Purchases({ medicineId, view }: { medicineId: string; view: "prices" | "suppliers" }) {
  const money = useMoney();
  const { data, error, reload } = useApi<{ lines: PurchaseLine[]; suppliers: Supplier[] }>(`/api/medicines/${medicineId}/purchases`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  if (view === "suppliers") {
    return (
      <Card>
        {!data.suppliers.length ? <EmptyState title="Not bought from any supplier yet" /> : (
          <TableWrap>
            <thead><tr className="border-b border-border"><th className="th">Supplier</th><th className="th text-right">Purchases</th><th className="th text-right">Units</th><th className="th">Last bought</th><th className="th text-right">Last rate</th></tr></thead>
            <tbody>{data.suppliers.map((s) => (
              <tr key={s.id} className="border-b border-border/60"><td className="td"><Link className="text-primary hover:underline" href={`/suppliers/${s.id}`}>{s.name}</Link></td><td className="td text-right">{s.purchases}</td><td className="td text-right">{s.units}</td><td className="td">{formatDate(s.lastDate)}</td><td className="td text-right">{s.purchasePrice ? money(s.purchasePrice) : "Hidden"}</td></tr>))}</tbody>
          </TableWrap>
        )}
      </Card>
    );
  }
  return (
    <Card>
      {!data.lines.length ? <EmptyState title="No purchases yet" /> : (
        <TableWrap>
          <thead><tr className="border-b border-border"><th className="th">Date</th><th className="th">Supplier</th><th className="th">Purchase</th><th className="th">Batch</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Disc %</th><th className="th text-right">Unit cost</th><th className="th text-right">Sale price</th></tr></thead>
          <tbody>{data.lines.map((l) => (
            <tr key={l.id} className="border-b border-border/60">
              <td className="td whitespace-nowrap">{formatDate(l.purchase.purchaseDate)}</td><td className="td">{l.purchase.supplier.name}</td>
              <td className="td">{l.purchase.number}{l.purchase.supplierInvoice && <span className="block text-xs text-fg-muted">bill {l.purchase.supplierInvoice}</span>}</td>
              <td className="td">{l.batchNumber}</td><td className="td text-right">{l.quantity}{l.bonusQty > 0 && <span className="text-xs text-success"> +{l.bonusQty}</span>}</td>
              <td className="td text-right">{l.purchasePrice ? money(l.purchasePrice) : ""}</td><td className="td text-right">{Number(l.discountPercent) || ""}</td>
              <td className="td text-right">{l.effectiveCost ? money(l.effectiveCost) : ""}</td><td className="td text-right">{money(l.salePrice)}</td>
            </tr>))}</tbody>
        </TableWrap>
      )}
    </Card>
  );
}

type Trace = {
  batch: { batchNumber: string; expiryDate: string; quantity: number; medicine: { name: string } };
  purchased: number; sold: number; returned: number; inStock: number;
  purchases: { id: string; quantity: number; bonusQty: number; purchase: { number: string; purchaseDate: string; supplierInvoice: string | null; supplier: { name: string }; intake: { id: string; number: string } | null } }[];
  sales: { id: string; quantity: number; returnedQty: number; sale: { id: string; invoiceNo: string; createdAt: string; status: string; customerName: string | null; customerPhone: string | null; customer: { name: string; phone: string | null } | null } }[];
  movements: { id: string; type: string; quantity: number; reference: string | null; note: string | null; createdAt: string }[];
  holders: { name: string; phone: string | null; quantity: number }[];
};

/** Batch trace for a recall (roadmap 6.6): where it came from, who bought it, who still has some. */
function TraceDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, error } = useApi<Trace>(`/api/inventory/batches/${batchId}/trace`);
  return (
    <Modal open onClose={onClose} wide title={data ? `Batch ${data.batch.batchNumber}, ${data.batch.medicine.name}` : "Batch trace"}
      footer={<Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>}>
      {error ? <ErrorBox message={error} /> : !data ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <p>Expires {formatDate(data.batch.expiryDate)}. Bought {data.purchased}, sold {data.sold}, returned {data.returned}, in stock {data.inStock}.</p>
          <section>
            <h3 className="mb-1 font-semibold">Came from</h3>
            {!data.purchases.length && !data.movements.some((m) => m.type === "OPENING") ? <p className="text-fg-muted">No purchase recorded for this batch.</p> : (
              <ul className="space-y-1">
                {data.purchases.map((p) => <li key={p.id}>{formatDate(p.purchase.purchaseDate)}: {p.purchase.supplier.name}, {p.purchase.number}{p.purchase.supplierInvoice ? ` (bill ${p.purchase.supplierInvoice})` : ""}{p.purchase.intake ? `, stock entry ${p.purchase.intake.number}` : ""}, {p.quantity}{p.bonusQty ? ` + ${p.bonusQty} free` : ""}</li>)}
                {data.movements.filter((m) => m.type === "OPENING").map((m) => <li key={m.id}>{formatDate(m.createdAt)}: opening stock {m.quantity}{m.reference ? ` (${m.reference})` : ""}</li>)}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Who still has some</h3>
            {!data.holders.length ? <p className="text-fg-muted">Nobody: everything sold was returned, or nothing was sold.</p> : (
              <ul className="space-y-1">{data.holders.map((h, i) => <li key={i}><b>{h.name}</b>{h.phone ? `, ${h.phone}` : ""}: {h.quantity}</li>)}</ul>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Invoices</h3>
            {!data.sales.length ? <p className="text-fg-muted">Not sold yet.</p> : (
              <TableWrap>
                <tbody>{data.sales.map((s) => (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="td whitespace-nowrap">{formatDateTime(s.sale.createdAt)}</td>
                    <td className="td"><Link className="text-primary hover:underline" href={`/invoice/${s.sale.id}`}>{s.sale.invoiceNo}</Link> {s.sale.status === "CANCELLED" && <Badge tone="red">Cancelled</Badge>}</td>
                    <td className="td">{s.sale.customer?.name ?? s.sale.customerName ?? "Walk-in"}{(s.sale.customer?.phone ?? s.sale.customerPhone) && <span className="block text-xs text-fg-muted">{s.sale.customer?.phone ?? s.sale.customerPhone}</span>}</td>
                    <td className="td text-right">{s.quantity}{s.returnedQty > 0 && <span className="block text-xs text-warning">{s.returnedQty} returned</span>}</td>
                  </tr>))}</tbody>
              </TableWrap>
            )}
          </section>
          {data.movements.some((m) => m.type !== "OPENING") && (
            <section>
              <h3 className="mb-1 font-semibold">Corrections and write-offs</h3>
              <ul className="space-y-1">{data.movements.filter((m) => m.type !== "OPENING").map((m) => <li key={m.id}>{formatDate(m.createdAt)}: {TYPE[m.type] ?? m.type} {m.quantity > 0 ? `+${m.quantity}` : m.quantity}{m.note ? `, ${m.note}` : ""}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function MedicinePage() { return <Suspense><MedicineInner /></Suspense>; }
