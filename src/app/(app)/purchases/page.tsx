"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Modal, PageHeader, Pagination, SearchInput, TableSkeleton, TableWrap, Spinner } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { formatDate, qs, useApi, useDebounce } from "@/lib/client";

type P = { id: string; number: string; supplierInvoice: string | null; purchaseDate: string; total: string; paid: string; supplier: { name: string }; _count: { items: number } };
type Detail = P & { discount: string; subtotal: string; note: string | null; user: { name: string }; items: { id: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: string; salePrice: string; lineTotal: string; medicine: { name: string } }[] };

export default function PurchasesPage() {
  const money = useMoney(); const canCreate = useCan("purchases.create");
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const dq = useDebounce(q); const [view, setView] = useState<string | null>(null);
  useEffect(() => setPage(1), [dq]);
  const { data, error, loading, reload } = useApi<{ items: P[]; total: number; page: number; pageSize: number }>(`/api/purchases?${qs({ q: dq, page })}`);
  const detail = useApi<Detail>(view ? `/api/purchases/${view}` : null);
  return (
    <>
      <PageHeader title="Purchases" subtitle="Purchase invoices. Completing one adds stock by batch and updates the supplier ledger." actions={canCreate && <Link href="/stock-entry?new=PURCHASE_BILL" data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N"><Button><Plus className="h-4 w-4" /> New purchase</Button></Link>} />
      <Card>
        <div className="border-b border-slate-200 p-4 dark:border-slate-800"><SearchInput value={q} onChange={setQ} placeholder="Search purchase no., supplier invoice or supplier" className="max-w-md" /></div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No purchases yet" hint="Record a supplier invoice to add stock." /> : (
          <><TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Purchase</th><th className="th">Supplier</th><th className="th">Supplier invoice</th><th className="th">Date</th><th className="th text-right">Items</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data.items.map((p) => (<tr key={p.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td font-medium">{p.number}</td><td className="td">{p.supplier.name}</td><td className="td">{p.supplierInvoice ?? "—"}</td><td className="td">{formatDate(p.purchaseDate)}</td><td className="td text-right">{p._count.items}</td><td className="td text-right">{money(p.total)}</td><td className="td text-right">{money(p.paid)}</td>
              <td className="td">{Number(p.total) - Number(p.paid) > 0 ? <Badge tone="amber">Due {money(Number(p.total) - Number(p.paid))}</Badge> : <Badge tone="green">Paid</Badge>}</td>
              <td className="td"><Button size="sm" variant="ghost" aria-label={`View ${p.number}`} onClick={() => setView(p.id)}><Eye className="h-4 w-4" /></Button></td></tr>))}</tbody></TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
        )}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title={detail.data?.number ?? "Purchase"} wide>
        {!detail.data ? <Spinner /> : (
          <div className="space-y-3 text-sm">
            <p>{detail.data.supplier.name} · {formatDate(detail.data.purchaseDate)} · entered by {detail.data.user.name}</p>
            <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Medicine</th><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th><th className="th text-right">Cost</th><th className="th text-right">Sale price</th><th className="th text-right">Total</th></tr></thead>
              <tbody>{detail.data.items.map((i) => (<tr key={i.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td">{i.medicine.name}</td><td className="td">{i.batchNumber}</td><td className="td">{formatDate(i.expiryDate)}</td><td className="td text-right">{i.quantity}</td><td className="td text-right">{money(i.purchasePrice)}</td><td className="td text-right">{money(i.salePrice)}</td><td className="td text-right">{money(i.lineTotal)}</td></tr>))}</tbody></TableWrap>
            <p className="text-right">Subtotal {money(detail.data.subtotal)} · Discount {money(detail.data.discount)} · <b>Total {money(detail.data.total)}</b> · Paid {money(detail.data.paid)}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
