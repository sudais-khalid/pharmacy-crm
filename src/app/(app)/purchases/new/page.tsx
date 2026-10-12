"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button, Card, Field, Input, PageHeader, Select, useToast } from "@/components/ui";
import { MedicinePicker, type PickedMedicine } from "@/components/medicine-picker";
import { useMoney } from "@/components/app-context";
import { api, useApi } from "@/lib/client";

type Line = { med: PickedMedicine | null; batchNumber: string; expiryDate: string; quantity: string; purchasePrice: string; salePrice: string };
const blank = (): Line => ({ med: null, batchNumber: "", expiryDate: "", quantity: "", purchasePrice: "", salePrice: "" });
const c = (v: string) => Math.round((Number(v) || 0) * 100);

export default function NewPurchase() {
  const router = useRouter(); const toast = useToast(); const money = useMoney();
  const suppliers = useApi<{ items: { id: string; name: string }[] }>("/api/suppliers?active=1&pageSize=100");
  const [supplierId, setSupplierId] = useState(""); const [supplierInvoice, setSupplierInvoice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [discount, setDiscount] = useState(""); const [paid, setPaid] = useState(""); const [method, setMethod] = useState("CASH"); const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + Math.round(c(l.purchasePrice) * (Number(l.quantity) || 0)), 0);
  const total = subtotal - c(discount);
  const remaining = total - c(paid);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.some((l) => !l.med)) { toast.error("Choose a medicine on every line."); return; }
    setSaving(true);
    try {
      await api("/api/purchases", { body: { supplierId, supplierInvoice, purchaseDate, discount: discount || 0, paid: paid || 0, paymentMethod: method, note,
        items: lines.map((l) => ({ medicineId: l.med!.id, batchNumber: l.batchNumber, expiryDate: l.expiryDate, quantity: l.quantity, purchasePrice: l.purchasePrice || 0, salePrice: l.salePrice || 0 })) } });
      toast.success("Purchase recorded – stock updated");
      router.push("/purchases");
    } catch (err) { toast.error((err as Error).message); setSaving(false); }
  }

  return (
    <>
      <Link href="/purchases" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-300"><ArrowLeft className="h-4 w-4" /> Purchases</Link>
      <PageHeader title="New purchase" subtitle="Each line becomes (or tops up) a batch with its own expiry date." />
      <form onSubmit={submit} className="space-y-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Supplier *"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required><option value="">Select supplier…</option>{suppliers.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Supplier invoice no."><Input value={supplierInvoice} onChange={(e) => setSupplierInvoice(e.target.value)} /></Field>
          <Field label="Purchase date *"><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required /></Field>
        </Card>
        <Card className="p-4">
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-[2fr_1fr_1fr_80px_1fr_1fr_auto]">
                <Field label="Medicine"><MedicinePicker value={l.med} onPick={(m) => setLine(i, { med: m, purchasePrice: String(m.purchasePrice), salePrice: String(m.salePrice) })} /></Field>
                <Field label="Batch no."><Input value={l.batchNumber} onChange={(e) => setLine(i, { batchNumber: e.target.value })} required /></Field>
                <Field label="Expiry"><Input type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} required /></Field>
                <Field label="Qty"><Input type="number" min="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required /></Field>
                <Field label="Cost price"><Input type="number" min="0" step="0.01" value={l.purchasePrice} onChange={(e) => setLine(i, { purchasePrice: e.target.value })} required /></Field>
                <Field label="Sale price"><Input type="number" min="0" step="0.01" value={l.salePrice} onChange={(e) => setLine(i, { salePrice: e.target.value })} required /></Field>
                <div className="flex items-center gap-2 pb-1"><span className="w-24 text-right text-sm font-medium">{money((c(l.purchasePrice) * (Number(l.quantity) || 0)) / 100)}</span>
                  <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> Add line</Button>
        </Card>
        <Card className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-3"><Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Discount"><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
              <Field label="Paid now"><Input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
              <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card / bank</option></Select></Field>
            </div>
            <dl className="space-y-1 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(subtotal / 100)}</dd></div><div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{money(total / 100)}</dd></div><div className="flex justify-between"><dt>Remaining payable</dt><dd className={remaining < 0 ? "text-red-600" : ""}>{money(remaining / 100)}</dd></div></dl>
            <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!supplierId || remaining < 0 || total < 0}>Complete purchase</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
