"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, TableWrap, Textarea, useToast, cn } from "@/components/ui";
import { useMoney } from "@/components/app-context";
import { api, formatDateTime, qs } from "@/lib/client";

type Sale = {
  id: string; invoiceNo: string; createdAt: string; status: string; subtotal: string; total: string; amountPaid: string; paymentMethod: string;
  customer: { name: string } | null; customerName: string | null; user: { name: string };
  items: { id: string; quantity: number; returnedQty: number; unitPrice: string; medicine: { name: string }; batch: { batchNumber: string } }[];
  returns: { refundMethod: string; total: string }[];
};
type Pick = { qty: number; restock: boolean };
type Method = "CASH" | "CARD" | "CREDIT";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** A return: find the invoice (type or scan its number, or its QR code), choose quantities, refund (roadmap 5.6). */
function NewReturn() {
  const money = useMoney();
  const toast = useToast();
  const router = useRouter();
  const preset = useSearchParams().get("sale");
  const findRef = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [method, setMethod] = useState<Method>("CASH");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);

  async function load(id: string) {
    try {
      const s = await api<Sale>(`/api/sales/${id}`);
      if (s.status !== "COMPLETED") throw new Error(`${s.invoiceNo} was cancelled; nothing can be returned.`);
      setSale(s);
      setPicks({});
      setMethod(Number(s.amountPaid) > 0 ? (s.paymentMethod === "CARD" ? "CARD" : "CASH") : "CREDIT");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  useEffect(() => { if (preset) void load(preset); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find(e: React.FormEvent) {
    e.preventDefault();
    const n = number.trim();
    if (!n) return;
    const r = await api<{ items: { id: string }[] }>(`/api/sales?${qs({ invoice: n, pageSize: 1 })}`).catch((err) => { toast.error((err as Error).message); return null; });
    if (r && !r.items[0]) toast.error(`No invoice ${n} found.`);
    if (r?.items[0]) await load(r.items[0].id);
  }

  const factor = sale && Number(sale.subtotal) > 0 ? Number(sale.total) / Number(sale.subtotal) : 1;
  const lines = useMemo(() => sale?.items.map((i) => ({ ...i, left: i.quantity - i.returnedQty, pick: picks[i.id] ?? { qty: 0, restock: true } })) ?? [], [sale, picks]);
  const refund = Math.round(lines.reduce((s, l) => s + Number(l.unitPrice) * l.pick.qty * factor, 0) * 100) / 100;
  const refundedAlready = sale?.returns.filter((r) => r.refundMethod !== "CREDIT").reduce((s, r) => s + Number(r.total), 0) ?? 0;
  const refundable = sale ? Number(sale.amountPaid) - refundedAlready : 0;
  const walkIn = !!sale && !sale.customer;
  const problem = !lines.some((l) => l.pick.qty > 0) ? "Choose how many of each item came back"
    : reason.trim().length < 3 ? "Give a reason"
    : method === "CREDIT" && walkIn ? "A credit note needs a customer account"
    : method !== "CREDIT" && refund > refundable + 0.001 ? `Only ${money(refundable)} can be refunded in ${method.toLowerCase()}; use a credit note for the rest`
    : "";

  async function submit() {
    if (!sale || problem) return;
    setBusy(true);
    try {
      const r = await api<{ id: string; number: string }>("/api/returns", {
        idempotencyKey: key,
        body: { saleId: sale.id, refundMethod: method, reason, items: lines.filter((l) => l.pick.qty > 0).map((l) => ({ saleItemId: l.id, quantity: l.pick.qty, restock: l.pick.restock })) },
      });
      toast.success(`${r.number} recorded`);
      router.push(`/invoice/returns/${r.id}?print=1`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...(p[id] ?? { qty: 0, restock: true }), ...patch } }));

  return (
    <>
      <PageHeader title="New return" subtitle="Type or scan the invoice number (the QR code on the receipt works too)." />
      <Card className="max-w-xl p-4">
        <form onSubmit={find} className="flex gap-2">
          <Input ref={findRef} autoFocus aria-label="Invoice number" placeholder="INV-20261019-00012" value={number} onChange={(e) => setNumber(e.target.value)} />
          <Button type="submit" variant="secondary"><ScanLine className="h-4 w-4" aria-hidden /> Find</Button>
        </form>
      </Card>

      {sale && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border p-4 text-sm">
            <b className="text-base">{sale.invoiceNo}</b>
            <span>{formatDateTime(sale.createdAt)}</span>
            <span>{sale.customer?.name ?? sale.customerName ?? "Walk-in customer"}</span>
            <span>Total {money(sale.total)}, paid {money(sale.amountPaid)} ({sale.paymentMethod.toLowerCase()})</span>
          </div>
          {!lines.length ? <EmptyState title="No lines" /> : (
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">Medicine</th><th className="th">Batch</th><th className="th text-right">Sold</th><th className="th text-right">Can return</th><th className="th">Returning</th><th className="th">Back to stock</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={cn("border-b border-border/60", l.left === 0 && "opacity-50")}>
                    <td className="td">{l.medicine.name}</td>
                    <td className="td">{l.batch.batchNumber}</td>
                    <td className="td text-right">{l.quantity}</td>
                    <td className="td text-right">{l.left}{l.returnedQty > 0 && <span className="ml-1"><Badge tone="amber">{l.returnedQty} back already</Badge></span>}</td>
                    <td className="td"><Input aria-label={`Returning ${l.medicine.name}`} type="number" min={0} max={l.left} disabled={l.left === 0} className="w-20" value={l.pick.qty || ""} placeholder="0"
                      onChange={(e) => set(l.id, { qty: Math.max(0, Math.min(l.left, parseInt(e.target.value || "0", 10) || 0)) })} /></td>
                    <td className="td"><Checkbox label={l.pick.restock ? "Sellable" : "Damaged"} checked={l.pick.restock} disabled={l.left === 0} onChange={(e) => set(l.id, { restock: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Refund</legend>
                <div role="radiogroup" className="flex flex-wrap gap-2">
                  {(["CASH", "CARD", "CREDIT"] as Method[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={method === m} disabled={m === "CREDIT" && walkIn} onClick={() => setMethod(m)}
                      className={cn("rounded-lg border px-3 py-2 text-sm disabled:opacity-40", method === m ? "border-primary bg-primary text-on-primary" : "border-border hover:bg-muted")}>
                      {m === "CREDIT" ? "Credit note" : m === "CASH" ? "Cash" : "Card"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor changed the prescription" maxLength={300} /></Field>
            </div>
            <div className="flex flex-col justify-end gap-2 md:items-end">
              <p className="text-sm text-fg-muted">The refund is the price paid, after the invoice discount.</p>
              <p className="text-2xl font-semibold">{money(refund)}</p>
              {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
              <Button onClick={submit} loading={busy} disabled={!!problem}>Record return and print</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

export default function NewReturnPage() { return <Suspense><NewReturn /></Suspense>; }
