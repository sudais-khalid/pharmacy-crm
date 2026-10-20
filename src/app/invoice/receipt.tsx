"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatDate, formatDateTime } from "@/lib/client";

/**
 * Receipt templates (roadmap 5.4, 5.5): 80 mm and 58 mm thermal rolls and A4, built from the pharmacy's
 * profile and branding. The format used at the sale is stored on it, so a reprint looks the same.
 */
export type Format = "THERMAL_80" | "THERMAL_58" | "A4";
export const FORMATS: { id: Format; label: string }[] = [{ id: "THERMAL_80", label: "80 mm roll" }, { id: "THERMAL_58", label: "58 mm roll" }, { id: "A4", label: "A4 page" }];
export type Shop = {
  pharmacyName: string; legalName: string; address: string; city: string; phone: string; whatsapp: string; email: string; licenseNumber: string; taxNumber: string;
  receiptHeader: string; invoiceFooter: string; currency: string; logoFileId: string | null; receiptFormat: Format; receiptBatchLines: boolean;
};
export type ReceiptLine = { id: string; name: string; quantity: number; unitPrice: string; lineTotal: string; batchNumber: string; expiryDate: string; note?: string };
export type ReceiptDoc = {
  title: string; // "Invoice", "Return"
  number: string; createdAt: string; cashier: string; customer: { name: string; phone: string | null; address?: string | null } | null;
  lines: ReceiptLine[];
  totals: [string, string, "strong"?][];
  notes: string[];
  stamp?: string | null; // e.g. CANCELLED
  partyLabel?: string; // "Customer" unless the document is for a supplier
  staffLabel?: string; // "Cashier" unless someone else made it
  qr: string; // what the QR code holds: the number, so a scanner at the returns desk finds the invoice
};

/** Paper size and margins for the chosen format; thermal printers want no page margin. */
export function PrintStyle({ format }: { format: Format }) {
  const page = format === "A4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${format === "THERMAL_58" ? "58mm" : "80mm"} auto; margin: 0; }`;
  return <style>{`@media print { ${page} }`}</style>;
}

function Qr({ text, size }: { text: string; size: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg, () => setSvg("")); }, [text]);
  return <div role="img" aria-label={`QR code ${text}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const contact = (s: Shop) => [s.phone, s.whatsapp && `WhatsApp ${s.whatsapp}`].filter(Boolean).join(", ");
const licence = (s: Shop) => [s.licenseNumber && `Drug licence ${s.licenseNumber}`, s.taxNumber && `Tax no. ${s.taxNumber}`].filter(Boolean).join(", ");

/** A narrow roll receipt: centred header, one block per line, totals, QR code. */
export function ThermalReceipt({ doc, shop, format, batchLines }: { doc: ReceiptDoc; shop: Shop; format: Format; batchLines: boolean }) {
  const narrow = format === "THERMAL_58";
  return (
    <article className="print-area relative mx-auto bg-white p-3 font-mono text-black shadow print:p-1 print:shadow-none" style={{ width: narrow ? "58mm" : "80mm", fontSize: narrow ? 10 : 11, lineHeight: 1.35 }}>
      {doc.stamp && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-black uppercase text-black/15 [transform:rotate(-25deg)]">{doc.stamp}</div>}
      <header className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- the pharmacy's logo from our file route */}
        {shop.logoFileId && <img src={`/api/files/${shop.logoFileId}`} alt="" className="mx-auto mb-1 max-h-12 object-contain grayscale" />}
        <p className="font-sans text-sm font-bold">{shop.pharmacyName}</p>
        {(shop.address || shop.city) && <p>{[shop.address, shop.city].filter(Boolean).join(", ")}</p>}
        {contact(shop) && <p>{contact(shop)}</p>}
        {licence(shop) && <p>{licence(shop)}</p>}
        {shop.receiptHeader && <p className="mt-1 font-bold">{shop.receiptHeader}</p>}
      </header>
      <hr className="my-1.5 border-dashed border-black" />
      <p className="flex justify-between"><span>{doc.title} {doc.number}</span></p>
      <p>{formatDateTime(doc.createdAt)}</p>
      <p>Cashier: {doc.cashier}</p>
      {doc.customer && <p>Customer: {doc.customer.name}{doc.customer.phone ? `, ${doc.customer.phone}` : ""}</p>}
      <hr className="my-1.5 border-dashed border-black" />
      <ul>
        {doc.lines.map((l) => (
          <li key={l.id} className="mb-1">
            <p className="font-sans font-semibold">{l.name}</p>
            <p className="flex justify-between"><span>{l.quantity} x {Number(l.unitPrice).toFixed(2)}</span><span>{Number(l.lineTotal).toFixed(2)}</span></p>
            {batchLines && <p className="text-[0.9em]">Batch {l.batchNumber}, exp {formatDate(l.expiryDate)}</p>}
            {l.note && <p className="text-[0.9em]">{l.note}</p>}
          </li>
        ))}
      </ul>
      <hr className="my-1.5 border-dashed border-black" />
      <dl>
        {doc.totals.map(([k, v, strong]) => (
          <div key={k} className={strong ? "flex justify-between font-sans text-sm font-bold" : "flex justify-between"}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {doc.notes.map((n) => <p key={n} className="mt-1">{n}</p>)}
      <div className="mt-2 flex flex-col items-center gap-1">
        <Qr text={doc.qr} size={narrow ? 72 : 88} />
        <p className="text-[0.9em]">{doc.number}</p>
      </div>
      {shop.invoiceFooter && <p className="mt-2 text-center">{shop.invoiceFooter}</p>}
    </article>
  );
}

/** A full page with the pharmacy's letterhead, a table of lines and a QR code. */
export function A4Receipt({ doc, shop, batchLines }: { doc: ReceiptDoc; shop: Shop; batchLines: boolean }) {
  return (
    <article className="print-area relative mx-auto max-w-3xl rounded-xl bg-white p-8 text-slate-900 shadow">
      {doc.stamp && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-red-500/20 [transform:rotate(-20deg)]">{doc.stamp}</div>}
      <header className="flex items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the pharmacy's logo from our file route */}
          {shop.logoFileId && <img src={`/api/files/${shop.logoFileId}`} alt="" className="h-16 w-16 object-contain" />}
          <div>
            <h1 className="text-2xl font-bold">{shop.pharmacyName}</h1>
            {shop.legalName && shop.legalName !== shop.pharmacyName && <p className="text-sm text-slate-600">{shop.legalName}</p>}
            {(shop.address || shop.city) && <p className="text-sm text-slate-600">{[shop.address, shop.city].filter(Boolean).join(", ")}</p>}
            <p className="text-sm text-slate-600">{[contact(shop), shop.email].filter(Boolean).join(", ")}</p>
            {licence(shop) && <p className="text-xs text-slate-500">{licence(shop)}</p>}
            {shop.receiptHeader && <p className="mt-1 text-sm font-medium" style={{ color: "rgb(var(--brand-700))" }}>{shop.receiptHeader}</p>}
          </div>
        </div>
        <div className="flex items-start gap-3 text-right">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">{doc.title}</p>
            <p className="text-lg font-semibold">{doc.number}</p>
            <p className="text-sm text-slate-600">{formatDateTime(doc.createdAt)}</p>
          </div>
          <Qr text={doc.qr} size={72} />
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4 py-4 text-sm">
        <div><p className="text-xs uppercase text-slate-500">{doc.partyLabel ?? "Customer"}</p><p className="font-medium">{doc.customer?.name ?? "Walk-in customer"}</p>{doc.customer?.phone && <p>{doc.customer.phone}</p>}{doc.customer?.address && <p>{doc.customer.address}</p>}</div>
        <div className="text-right"><p className="text-xs uppercase text-slate-500">{doc.staffLabel ?? "Cashier"}</p><p className="font-medium">{doc.cashier}</p></div>
      </section>
      <table className="w-full text-sm">
        <thead><tr className="border-y border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-2">Medicine</th>{batchLines && <><th>Batch</th><th>Expiry</th></>}<th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
        <tbody>{doc.lines.map((l) => (
          <tr key={l.id} className="border-b border-slate-100"><td className="py-2">{l.name}{l.note && <span className="block text-xs text-slate-500">{l.note}</span>}</td>{batchLines && <><td>{l.batchNumber}</td><td>{formatDate(l.expiryDate)}</td></>}<td className="text-right">{l.quantity}</td><td className="text-right">{Number(l.unitPrice).toFixed(2)}</td><td className="text-right">{Number(l.lineTotal).toFixed(2)}</td></tr>))}</tbody>
      </table>
      <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
        {doc.totals.map(([k, v, strong]) => <div key={k} className={strong ? "flex justify-between border-t border-slate-300 pt-1 text-base font-bold" : "flex justify-between"}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {doc.notes.map((n) => <p key={n} className="mt-3 text-sm">{n}</p>)}
      {shop.invoiceFooter && <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">{shop.invoiceFooter}</footer>}
    </article>
  );
}
