"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, MessageCircle, PackageCheck, Printer, Send } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, Textarea, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { api, formatDate, formatDateTime, useApi } from "@/lib/client";
import { ORDER_STATUS } from "../order-status";
import { OrderEditor, type EditorValue } from "../order-editor";

type Order = {
  id: string; number: string; status: string; source: string; expectedDate: string | null; note: string | null; estimatedTotal: string; createdAt: string; sentAt: string | null; closedAt: string | null; closeReason: string | null;
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null };
  createdBy: { name: string }; approvedBy: { name: string } | null;
  items: { id: string; medicineId: string; orderedQty: number; receivedQty: number; pendingQty: number; expectedPrice: string | null; medicine: { id: string; name: string; unit: string } }[];
  purchases: { id: string; number: string; purchaseDate: string; total: string; supplierInvoice: string | null }[];
  shareText: string;
};

/** One order: what was ordered, received and is pending, and what to do next (roadmap 7.4 to 7.8). */
export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const money = useMoney();
  const canEdit = useCan("purchases.create");
  const canApprove = useCan("po.approve");
  const canReceive = useCan("stockEntry.create");
  const seesCost = useCan("cost.view");
  const { data, error, reload } = useApi<Order>(`/api/orders/${id}`);
  const [editing, setEditing] = useState<EditorValue | null>(null);
  const [ending, setEnding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const o = data;
  const open = ["DRAFT", "SENT", "PARTIALLY_RECEIVED"].includes(o.status);
  const receivable = ["SENT", "PARTIALLY_RECEIVED"].includes(o.status);
  const anyReceived = o.items.some((i) => i.receivedQty > 0);
  const phone = o.supplier.phone?.replace(/\D/g, "").replace(/^0/, "92");

  async function act(action: "send" | "receive" | "end", body: unknown = {}) {
    setBusy(action);
    try {
      const r = await api<{ id?: string; number?: string; reused?: boolean }>(`/api/orders/${id}/${action}`, { body });
      if (action === "receive") {
        toast.success(r.reused ? `Continuing ${r.number}` : `${r.number} started: enter what arrived`);
        router.push(`/stock-entry/${r.id}`);
        return;
      }
      toast.success(action === "send" ? "Order sent" : anyReceived ? "Order closed short" : "Order cancelled");
      setEnding(false);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft(body: unknown) {
    setBusy("save");
    try {
      const { supplierId: _s, ...rest } = body as { supplierId: string };
      await api(`/api/orders/${id}`, { method: "PUT", body: rest });
      toast.success("Order saved");
      setEditing(null);
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <>
        <PageHeader title={`Edit ${o.number}`} subtitle={o.supplier.name} actions={<Button variant="secondary" onClick={() => setEditing(null)}>Back</Button>} />
        <OrderEditor value={editing} onChange={setEditing} onSave={saveDraft} saving={busy === "save"} supplierFixed />
      </>
    );
  }

  return (
    <>
      <Link href="/orders" className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" /> Supply orders</Link>
      <PageHeader title={o.number} subtitle={`${o.supplier.name}${o.expectedDate ? `, needed by ${formatDate(o.expectedDate)}` : ""}`}
        actions={<div className="flex flex-wrap gap-2">
          <Link href={`/invoice/orders/${o.id}?print=1`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted"><Printer className="h-4 w-4" aria-hidden /> Print</Link>
          <a href={`https://wa.me/${phone ?? ""}?text=${encodeURIComponent(o.shareText)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp</a>
          {o.status === "DRAFT" && canEdit && <Button variant="secondary" onClick={() => setEditing({ supplierId: o.supplier.id, expectedDate: o.expectedDate?.slice(0, 10) ?? "", note: o.note ?? "", lines: o.items.map((i) => ({ key: i.id, medicine: { id: i.medicineId, name: i.medicine.name, purchasePrice: "", salePrice: "" }, qty: String(i.orderedQty), price: i.expectedPrice ?? "" })) })}>Edit</Button>}
          {o.status === "DRAFT" && canApprove && <Button onClick={() => act("send")} loading={busy === "send"}><Send className="h-4 w-4" aria-hidden /> Approve and send</Button>}
          {receivable && canReceive && <Button onClick={() => act("receive")} loading={busy === "receive"}><PackageCheck className="h-4 w-4" aria-hidden /> Receive stock</Button>}
          {open && canApprove && <Button variant="ghost" onClick={() => setEnding(true)}><Ban className="h-4 w-4" aria-hidden /> {anyReceived ? "Close short" : "Cancel order"}</Button>}
        </div>} />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={ORDER_STATUS[o.status]?.tone ?? "slate"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
        <span className="text-fg-muted">Made {formatDateTime(o.createdAt)} by {o.createdBy.name}{o.source === "SUGGESTED" ? " from reorder suggestions" : ""}</span>
        {o.sentAt && <span className="text-fg-muted">Sent {formatDateTime(o.sentAt)}{o.approvedBy ? ` by ${o.approvedBy.name}` : ""}</span>}
        {o.closeReason && <span className="text-fg-muted">{o.status === "CANCELLED" ? "Cancelled" : "Closed"}: {o.closeReason}</span>}
      </div>
      {o.note && <p className="mb-4 text-sm">{o.note}</p>}

      <Card>
        <TableWrap>
          <thead><tr className="border-b border-border"><th className="th">Medicine</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Pending</th>{seesCost && <th className="th text-right">Expected price</th>}</tr></thead>
          <tbody>{o.items.map((i) => (
            <tr key={i.id} className="border-b border-border/60">
              <td className="td"><Link href={`/medicines/${i.medicineId}`} className="hover:text-primary hover:underline">{i.medicine.name}</Link></td>
              <td className="td text-right">{i.orderedQty}</td>
              <td className="td text-right">{i.receivedQty}</td>
              <td className="td text-right">{i.pendingQty > 0 && open ? <b>{i.pendingQty}</b> : i.pendingQty}</td>
              {seesCost && <td className="td text-right">{i.expectedPrice ? money(i.expectedPrice) : ""}</td>}
            </tr>))}</tbody>
        </TableWrap>
        {seesCost && <p className="border-t border-border p-3 text-right text-sm">Estimate {money(o.estimatedTotal)}</p>}
      </Card>

      <Card className="mt-4">
        <h2 className="border-b border-border p-4 font-semibold">Received on</h2>
        {!o.purchases.length ? <EmptyState title="Nothing received yet" hint={receivable ? "Use Receive stock when the delivery arrives." : undefined} /> : (
          <ul className="divide-y divide-border text-sm">{o.purchases.map((p) => (
            <li key={p.id} className="flex justify-between p-3"><span>{p.number}{p.supplierInvoice ? `, bill ${p.supplierInvoice}` : ""}, {formatDate(p.purchaseDate)}</span><span>{money(p.total)}</span></li>
          ))}</ul>
        )}
      </Card>

      <Modal open={ending} onClose={() => setEnding(false)} title={anyReceived ? "Close the order short" : "Cancel the order"}
        footer={<><Button variant="secondary" onClick={() => setEnding(false)}>Back</Button><Button variant="danger" loading={busy === "end"} disabled={reason.trim().length < 3} onClick={() => act("end", { reason })}>{anyReceived ? "Close short" : "Cancel order"}</Button></>}>
        <p className="mb-3 text-sm text-fg-muted">{anyReceived ? "What was received stays; the rest is no longer expected." : "Nothing was received on this order."}</p>
        <Field label="Reason"><Textarea data-autofocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </Modal>
    </>
  );
}
