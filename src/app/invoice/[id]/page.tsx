"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer, Undo2 } from "lucide-react";
import { Button, ErrorBox, Select, Spinner } from "@/components/ui";
import { formatDateTime, useApi } from "@/lib/client";
import { HistoryList } from "@/components/history";
import { useCan } from "@/components/app-context";
import { A4Receipt, FORMATS, PrintStyle, ThermalReceipt, type Format, type ReceiptDoc, type Shop } from "../receipt";

type Sale = {
  id: string; invoiceNo: string; createdAt: string; status: "COMPLETED" | "CANCELLED"; subtotal: string; discount: string; total: string; amountPaid: string; paymentMethod: string; cancelReason: string | null;
  cashTendered: string | null; changeGiven: string; receiptFormat: Format | null; note: string | null; customerName: string | null; customerPhone: string | null;
  customer: { name: string; phone: string | null; address: string | null } | null; user: { name: string };
  items: { id: string; quantity: number; returnedQty: number; unitPrice: string; lineTotal: string; medicine: { name: string; unit: string }; batch: { batchNumber: string; expiryDate: string } }[];
  returns: { id: string; number: string; total: string; refundMethod: string; createdAt: string }[];
};

function InvoiceInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const print = sp.get("print") === "1";
  const embed = sp.get("embed") === "1";
  const canReturn = useCan("returns.create");
  const sale = useApi<Sale>(`/api/sales/${id}`);
  const shop = useApi<Shop>("/api/branding");
  const [format, setFormat] = useState<Format | null>((sp.get("format") as Format) || null);
  const ready = !!sale.data && !!shop.data;
  // the History section only for people who may see the activity history (audit.view)
  const [history, setHistory] = useState(false);
  useEffect(() => { if (!embed) fetch(`/api/audit?entity=Sale&entityId=${id}&pageSize=1`, { credentials: "same-origin" }).then((r) => setHistory(r.ok), () => {}); }, [id, embed]);
  useEffect(() => { if (ready && print) setTimeout(() => window.print(), 400); }, [ready, print]);

  if (sale.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox message={sale.error} /></div>;
  if (!ready) return <Spinner />;
  const s = sale.data!, st = shop.data!;
  const fmt: Format = format ?? s.receiptFormat ?? st.receiptFormat;
  const m = (v: unknown) => `${st.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const balance = Number(s.total) - Number(s.amountPaid);
  const returned = s.returns.reduce((n, r) => n + Number(r.total), 0);

  const doc: ReceiptDoc = {
    title: "Invoice", number: s.invoiceNo, createdAt: s.createdAt, cashier: s.user.name, qr: s.invoiceNo,
    customer: s.customer ?? (s.customerName || s.customerPhone ? { name: s.customerName ?? "Walk-in customer", phone: s.customerPhone } : null),
    lines: s.items.map((i) => ({ id: i.id, name: i.medicine.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, batchNumber: i.batch.batchNumber, expiryDate: i.batch.expiryDate, note: i.returnedQty ? `${i.returnedQty} returned` : undefined })),
    totals: [
      ["Subtotal", m(s.subtotal)],
      ...(Number(s.discount) > 0 ? [["Discount", `- ${m(s.discount)}`] as [string, string]] : []),
      ["Total", m(s.total), "strong"],
      [`Paid (${s.paymentMethod.toLowerCase()})`, m(s.amountPaid)],
      ...(s.cashTendered ? [["Cash received", m(s.cashTendered)] as [string, string], ["Change", m(s.changeGiven)] as [string, string]] : []),
      ...(balance > 0 ? [["Balance on account", m(balance), "strong"] as [string, string, "strong"]] : []),
      ...(returned > 0 ? [["Returned", `- ${m(returned)}`] as [string, string]] : []),
    ],
    notes: [
      ...(s.note ? [s.note] : []),
      ...(s.status === "CANCELLED" ? [`This invoice was cancelled${s.cancelReason ? `: ${s.cancelReason}` : "."}`] : []),
    ],
    stamp: s.status === "CANCELLED" ? "Cancelled" : null,
  };

  return (
    <div className={embed ? "bg-white" : "min-h-screen bg-muted p-4 print:bg-white print:p-0"}>
      <PrintStyle format={fmt} />
      {!embed && (
        <div className="no-print mx-auto mb-3 flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <Link href="/sales" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" /> Back to invoices</Link>
          <div className="flex items-center gap-2">
            <Select aria-label="Receipt format" value={fmt} onChange={(e) => setFormat(e.target.value as Format)} className="w-36">{FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
            {canReturn && s.status === "COMPLETED" && <Link href={`/returns/new?sale=${s.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted"><Undo2 className="h-4 w-4" aria-hidden /> Return items</Link>}
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          </div>
        </div>
      )}
      {fmt === "A4" ? <A4Receipt doc={doc} shop={st} batchLines={st.receiptBatchLines} /> : <ThermalReceipt doc={doc} shop={st} format={fmt} batchLines={st.receiptBatchLines} />}
      {!embed && s.returns.length > 0 && (
        <section className="no-print mx-auto mt-4 max-w-3xl rounded-xl bg-surface p-4 text-sm shadow">
          <h2 className="mb-2 font-semibold">Returns</h2>
          <ul className="space-y-1">{s.returns.map((r) => <li key={r.id}><Link className="text-primary hover:underline" href={`/invoice/returns/${r.id}`}>{r.number}</Link>, {formatDateTime(r.createdAt)}, {m(r.total)} ({r.refundMethod === "CREDIT" ? "credit note" : `${r.refundMethod.toLowerCase()} refund`})</li>)}</ul>
        </section>
      )}
      {history && <section className="no-print mx-auto mt-4 max-w-3xl rounded-xl bg-surface shadow"><h2 className="border-b border-border p-4 font-semibold">History</h2><HistoryList entity="Sale" entityId={s.id} /></section>}
    </div>
  );
}

export default function InvoicePage() { return <Suspense><InvoiceInner /></Suspense>; }
