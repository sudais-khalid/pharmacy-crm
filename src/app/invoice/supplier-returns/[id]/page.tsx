"use client";
import { Suspense, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { useApi } from "@/lib/client";
import { A4Receipt, PrintStyle, type ReceiptDoc, type Shop } from "../../receipt";

type Return = {
  number: string; createdAt: string; total: string; reason: string; supplier: { name: string; phone: string | null; address: string | null }; user: { name: string };
  items: { id: string; quantity: number; lineTotal: string; medicine: { name: string }; batch: { batchNumber: string; expiryDate: string } }[];
};

/** The note that goes with stock handed back to a supplier (roadmap 7.9). */
function ReturnNote() {
  const { id } = useParams<{ id: string }>();
  const print = useSearchParams().get("print") === "1";
  const ret = useApi<Return>(`/api/supplier-returns/${id}`);
  const shop = useApi<Shop>("/api/branding");
  const ready = !!ret.data && !!shop.data;
  useEffect(() => { if (ready && print) setTimeout(() => window.print(), 400); }, [ready, print]);
  if (ret.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox message={ret.error} /></div>;
  if (!ready) return <Spinner />;
  const r = ret.data!, st = shop.data!;
  const m = (v: unknown) => `${st.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const doc: ReceiptDoc = {
    title: "Return to supplier", number: r.number, createdAt: r.createdAt, cashier: r.user.name, qr: r.number,
    customer: { name: r.supplier.name, phone: r.supplier.phone, address: r.supplier.address }, partyLabel: "Supplier", staffLabel: "Returned by",
    lines: r.items.map((i) => ({ id: i.id, name: i.medicine.name, quantity: i.quantity, unitPrice: String(Number(i.lineTotal) / i.quantity), lineTotal: i.lineTotal, batchNumber: i.batch.batchNumber, expiryDate: i.batch.expiryDate })),
    totals: [["Credit to our account", m(r.total), "strong"]],
    notes: [`Reason: ${r.reason}`, "Received by (name, signature and date): ______________________"],
  };
  return (
    <div className="min-h-screen bg-muted p-4 print:bg-white print:p-0">
      <PrintStyle format="A4" />
      <div className="no-print mx-auto mb-3 flex max-w-3xl justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></div>
      <A4Receipt doc={doc} shop={{ ...st, invoiceFooter: "" }} batchLines />
    </div>
  );
}

export default function ReturnNotePage() { return <Suspense><ReturnNote /></Suspense>; }
