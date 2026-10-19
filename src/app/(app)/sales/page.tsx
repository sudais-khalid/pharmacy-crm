"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Printer, Undo2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { api, formatDateTime, qs, useApi, useDebounce } from "@/lib/client";

type Sale = { id: string; invoiceNo: string; createdAt: string; total: string; amountPaid: string; paymentMethod: string; status: "COMPLETED" | "CANCELLED"; customer: { name: string } | null; customerName: string | null; user: { name: string }; _count: { items: number; returns: number } };

export default function SalesPage() {
  const money = useMoney();
  const toast = useToast();
  const canCancel = useCan("sales.cancel");
  const canReturn = useCan("returns.create");
  const seesAll = useCan("sales.viewAll");
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status, from, to]);
  const { data, error, loading, reload } = useApi<{ items: Sale[]; total: number; page: number; pageSize: number }>(`/api/sales?${qs({ q: dq, status, from, to, page })}`);
  const [cancelling, setCancelling] = useState<Sale | null>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    try { await api(`/api/sales/${cancelling.id}/cancel`, { body: { reason } }); toast.success(`${cancelling.invoiceNo} cancelled – stock restored`); setCancelling(null); setReason(""); reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Invoices" subtitle={seesAll ? "Every sale, with reprint, returns and cancellation." : "Your sales, with reprint."} />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <SearchInput value={q} onChange={setQ} placeholder="Invoice number, customer or phone" className="min-w-[220px] flex-1" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></Select>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No invoices found" hint="Make a sale from the POS screen." /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Invoice</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Cashier</th><th className="th">Payment</th><th className="th text-right">Total</th><th className="th text-right">Balance</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>{data.items.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="td font-medium"><Link href={`/invoice/${s.id}`} className="text-brand-700 hover:underline dark:text-brand-300">{s.invoiceNo}</Link></td>
                  <td className="td whitespace-nowrap">{formatDateTime(s.createdAt)}</td><td className="td">{s.customer?.name ?? s.customerName ?? "Walk-in"}</td><td className="td">{s.user.name}</td>
                  <td className="td capitalize">{s.paymentMethod.toLowerCase()}</td><td className="td text-right">{money(s.total)}</td>
                  <td className="td text-right">{Number(s.total) - Number(s.amountPaid) > 0 ? <Badge tone="amber">{money(Number(s.total) - Number(s.amountPaid))}</Badge> : "—"}</td>
                  <td className="td">{s.status === "COMPLETED" ? <Badge tone="green">Completed</Badge> : <Badge tone="red">Cancelled</Badge>} {s._count.returns > 0 && <Badge tone="amber">Returns</Badge>}</td>
                  <td className="td"><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Print ${s.invoiceNo}`} onClick={() => window.open(`/invoice/${s.id}?print=1`, "_blank")}><Printer className="h-4 w-4" /></Button>
                    {canReturn && s.status === "COMPLETED" && <Link href={`/returns/new?sale=${s.id}`} aria-label={`Return items from ${s.invoiceNo}`} title="Return items" className="inline-flex items-center rounded-lg px-2 py-1.5 hover:bg-muted"><Undo2 className="h-4 w-4" /></Link>}
                    {canCancel && s.status === "COMPLETED" && s._count.returns === 0 && <Button size="sm" variant="ghost" aria-label={`Cancel ${s.invoiceNo}`} onClick={() => setCancelling(s)}><Ban className="h-4 w-4 text-red-600" /></Button>}
                  </div></td>
                </tr>))}</tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.invoiceNo}`} footer={<><Button variant="secondary" onClick={() => setCancelling(null)}>Keep invoice</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={cancel}>Cancel invoice</Button></>}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Stock returns to the exact batches it was taken from, and any customer credit entries are reversed. The invoice stays on record as cancelled.</p>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus /></Field>
      </Modal>
    </>
  );
}
