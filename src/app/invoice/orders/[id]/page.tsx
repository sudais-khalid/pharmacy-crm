"use client";
import { Suspense, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { useApi } from "@/lib/client";
import { A4Receipt, PrintStyle, type ReceiptDoc, type Shop } from "../../receipt";

type Order = {
  number: string; createdAt: string; expectedDate: string | null; note: string | null; status: string;
  supplier: { name: string; phone: string | null }; createdBy: { name: string };
  items: { id: string; orderedQty: number; expectedPrice: string | null; medicine: { name: string } }[];
};

/** A purchase order on the pharmacy's letterhead, for the supplier (roadmap 7.7). */
function OrderPrint() {
  const { id } = useParams<{ id: string }>();
  const print = useSearchParams().get("print") === "1";
  const order = useApi<Order>(`/api/orders/${id}`);
  const shop = useApi<Shop>("/api/branding");
  const ready = !!order.data && !!shop.data;
  useEffect(() => { if (ready && print) setTimeout(() => window.print(), 400); }, [ready, print]);
  if (order.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox message={order.error} /></div>;
  if (!ready) return <Spinner />;
  const o = order.data!, st = shop.data!;
  const priced = o.items.some((i) => i.expectedPrice);
  const doc: ReceiptDoc = {
    title: "Purchase order", number: o.number, createdAt: o.createdAt, cashier: o.createdBy.name, qr: o.number,
    customer: { name: o.supplier.name, phone: o.supplier.phone }, partyLabel: "Supplier", staffLabel: "Ordered by",
    lines: o.items.map((i) => ({ id: i.id, name: i.medicine.name, quantity: i.orderedQty, unitPrice: i.expectedPrice ?? "0", lineTotal: String((Number(i.expectedPrice) || 0) * i.orderedQty), batchNumber: "", expiryDate: "" })),
    totals: priced ? [["Estimated value", `${st.currency} ${o.items.reduce((s, i) => s + (Number(i.expectedPrice) || 0) * i.orderedQty, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "strong"]] : [],
    notes: [o.expectedDate ? `Please deliver by ${o.expectedDate.slice(0, 10)}.` : "", o.note ?? "", o.status === "DRAFT" ? "Draft: not yet approved." : ""].filter(Boolean),
  };
  return (
    <div className="min-h-screen bg-muted p-4 print:bg-white print:p-0">
      <PrintStyle format="A4" />
      <div className="no-print mx-auto mb-3 flex max-w-3xl justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></div>
      <A4Receipt doc={doc} shop={{ ...st, invoiceFooter: "" }} batchLines={false} />
    </div>
  );
}

export default function OrderPrintPage() { return <Suspense><OrderPrint /></Suspense>; }
