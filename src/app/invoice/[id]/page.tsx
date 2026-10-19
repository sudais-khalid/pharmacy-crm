"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { formatDate, formatDateTime, useApi } from "@/lib/client";
import { HistoryList } from "@/components/history";

type Sale = {
  id: string; invoiceNo: string; createdAt: string; status: "COMPLETED" | "CANCELLED"; subtotal: string; discount: string; total: string; amountPaid: string; paymentMethod: string; cancelReason: string | null;
  customer: { name: string; phone: string | null; address: string | null } | null; user: { name: string };
  items: { id: string; quantity: number; unitPrice: string; lineTotal: string; medicine: { name: string; unit: string }; batch: { batchNumber: string; expiryDate: string } }[];
};
type Settings = { pharmacyName: string; legalName: string; address: string; city: string; phone: string; whatsapp: string; email: string; licenseNumber: string; taxNumber: string; receiptHeader: string; invoiceFooter: string; currency: string; logoFileId: string | null };

function InvoiceInner() {
  const { id } = useParams<{ id: string }>();
  const print = useSearchParams().get("print") === "1";
  const sale = useApi<Sale>(`/api/sales/${id}`);
  const settings = useApi<Settings>("/api/branding");
  const ready = !!sale.data && !!settings.data;
  // the History section only for people who may see the activity history (audit.view)
  const [history, setHistory] = useState(false);
  useEffect(() => { fetch(`/api/audit?entity=Sale&entityId=${id}&pageSize=1`, { credentials: "same-origin" }).then((r) => setHistory(r.ok), () => {}); }, [id]);
  useEffect(() => { if (ready && print) setTimeout(() => window.print(), 400); }, [ready, print]);

  if (sale.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox message={sale.error} /></div>;
  if (!ready) return <Spinner />;
  const s = sale.data!, st = settings.data!;
  const m = (v: unknown) => `${st.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const balance = Number(s.total) - Number(s.amountPaid);

  return (
    <div className="min-h-screen bg-slate-100 p-4 dark:bg-slate-950 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-3 flex max-w-3xl items-center justify-between">
        <Link href="/sales" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:underline dark:text-slate-300"><ArrowLeft className="h-4 w-4" /> Back to invoices</Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button>
      </div>
      <article className="print-area relative mx-auto max-w-3xl rounded-xl bg-white p-8 text-slate-900 shadow">
        {s.status === "CANCELLED" && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-red-500/20 [transform:rotate(-20deg)]">Cancelled</div>}
        <header className="flex items-start justify-between gap-4 border-b border-slate-300 pb-4">
          <div className="flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- the pharmacy's logo from our file route */}
            {st.logoFileId && <img src={`/api/files/${st.logoFileId}`} alt="" className="h-16 w-16 object-contain" />}
            <div>
              <h1 className="text-2xl font-bold">{st.pharmacyName}</h1>
              {st.legalName && st.legalName !== st.pharmacyName && <p className="text-sm text-slate-600">{st.legalName}</p>}
              {(st.address || st.city) && <p className="text-sm text-slate-600">{[st.address, st.city].filter(Boolean).join(", ")}</p>}
              <p className="text-sm text-slate-600">{[st.phone, st.whatsapp && `WhatsApp ${st.whatsapp}`, st.email].filter(Boolean).join(" · ")}</p>
              {(st.licenseNumber || st.taxNumber) && <p className="text-xs text-slate-500">{[st.licenseNumber && `Drug licence ${st.licenseNumber}`, st.taxNumber && `Tax no. ${st.taxNumber}`].filter(Boolean).join(" · ")}</p>}
              {st.receiptHeader && <p className="mt-1 text-sm font-medium" style={{ color: "rgb(var(--brand-700))" }}>{st.receiptHeader}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500">Invoice</p>
            <p className="text-lg font-semibold">{s.invoiceNo}</p>
            <p className="text-sm text-slate-600">{formatDateTime(s.createdAt)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 py-4 text-sm">
          <div><p className="text-xs uppercase text-slate-500">Billed to</p><p className="font-medium">{s.customer?.name ?? "Walk-in customer"}</p>{s.customer?.phone && <p>{s.customer.phone}</p>}{s.customer?.address && <p>{s.customer.address}</p>}</div>
          <div className="text-right"><p className="text-xs uppercase text-slate-500">Cashier</p><p className="font-medium">{s.user.name}</p><p className="text-xs uppercase text-slate-500 mt-2">Payment</p><p className="font-medium capitalize">{s.paymentMethod.toLowerCase()}</p></div>
        </section>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-2">Medicine</th><th>Batch</th><th>Expiry</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.id} className="border-b border-slate-100"><td className="py-2">{i.medicine.name}</td><td>{i.batch.batchNumber}</td><td>{formatDate(i.batch.expiryDate)}</td><td className="text-right">{i.quantity}</td><td className="text-right">{m(i.unitPrice)}</td><td className="text-right">{m(i.lineTotal)}</td></tr>))}</tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{m(s.subtotal)}</dd></div>
          {Number(s.discount) > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {m(s.discount)}</dd></div>}
          <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold"><dt>Total</dt><dd>{m(s.total)}</dd></div>
          <div className="flex justify-between"><dt>Amount paid</dt><dd>{m(s.amountPaid)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Balance (credit)</dt><dd>{m(balance)}</dd></div>
        </dl>
        {s.status === "CANCELLED" && <p className="mt-4 text-sm font-medium text-red-600">This invoice was cancelled{s.cancelReason ? `: ${s.cancelReason}` : "."}</p>}
        {st.invoiceFooter && <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">{st.invoiceFooter}</footer>}
      </article>
      {history && <section className="no-print mx-auto mt-4 max-w-3xl rounded-xl bg-white text-slate-900 shadow"><h2 className="border-b border-slate-200 p-4 font-semibold">History</h2><HistoryList entity="Sale" entityId={s.id} /></section>}
    </div>
  );
}

export default function InvoicePage() { return <Suspense><InvoiceInner /></Suspense>; }
