"use client";
import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { useApi } from "@/lib/client";
import { A4Receipt, PrintStyle, ThermalReceipt, type ReceiptDoc, type Shop } from "../../receipt";

type Return = {
  id: string; number: string; createdAt: string; total: string; refundMethod: string; reason: string;
  user: { name: string };
  sale: { id: string; invoiceNo: string; customerName: string | null; customerPhone: string | null; customer: { name: string; phone: string | null } | null };
  items: { id: string; quantity: number; unitPrice: string; lineTotal: string; restock: boolean; saleItem: { medicine: { name: string } }; batch: { batchNumber: string; expiryDate: string } }[];
};

/** The slip for a customer return: what came back and how it was refunded (roadmap 5.6). */
function ReturnInner() {
  const { id } = useParams<{ id: string }>();
  const print = useSearchParams().get("print") === "1";
  const ret = useApi<Return>(`/api/returns/${id}`);
  const shop = useApi<Shop>("/api/branding");
  const ready = !!ret.data && !!shop.data;
  useEffect(() => { if (ready && print) setTimeout(() => window.print(), 400); }, [ready, print]);
  if (ret.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox message={ret.error} /></div>;
  if (!ready) return <Spinner />;
  const r = ret.data!, st = shop.data!;
  const m = (v: unknown) => `${st.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const doc: ReceiptDoc = {
    title: "Return", number: r.number, createdAt: r.createdAt, cashier: r.user.name, qr: r.sale.invoiceNo,
    customer: r.sale.customer ?? (r.sale.customerName ? { name: r.sale.customerName, phone: r.sale.customerPhone } : null),
    lines: r.items.map((i) => ({ id: i.id, name: i.saleItem.medicine.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, batchNumber: i.batch.batchNumber, expiryDate: i.batch.expiryDate, note: i.restock ? undefined : "Damaged, not restocked" })),
    totals: [["Refund", m(r.total), "strong"], ["Refunded by", r.refundMethod === "CREDIT" ? "Credit note to account" : r.refundMethod.toLowerCase()]],
    notes: [`For invoice ${r.sale.invoiceNo}. Reason: ${r.reason}`],
  };
  return (
    <div className="min-h-screen bg-muted p-4 print:bg-white print:p-0">
      <PrintStyle format={st.receiptFormat} />
      <div className="no-print mx-auto mb-3 flex max-w-3xl items-center justify-between">
        <Link href="/returns" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" /> Back to returns</Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
      </div>
      {st.receiptFormat === "A4" ? <A4Receipt doc={doc} shop={st} batchLines={st.receiptBatchLines} /> : <ThermalReceipt doc={doc} shop={st} format={st.receiptFormat} batchLines={st.receiptBatchLines} />}
    </div>
  );
}

export default function ReturnSlipPage() { return <Suspense><ReturnInner /></Suspense>; }
