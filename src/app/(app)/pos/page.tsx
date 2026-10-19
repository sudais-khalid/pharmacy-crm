"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Minus, Plus, Printer, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, Input, Modal, Select, useToast, cn } from "@/components/ui";
import { useMoney } from "@/components/app-context";
import { useShortcutHelp } from "@/components/shortcuts";
import { api, formatDate, qs, useApi, useDebounce } from "@/lib/client";

type Result = { id: string; name: string; genericName: string | null; barcode: string | null; unit: string; prescriptionRequired: boolean; stock: number; price: string; nextExpiry: string | null; exactBarcode: boolean };
type Line = { medicineId: string; name: string; price: number; stock: number; qty: number; rx: boolean };
type Cust = { id: string; name: string; phone: string | null; creditLimit: string; balance: string };

const cents = (n: number) => Math.round(n * 100);

export default function PosPage() {
  const money = useMoney();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const dq = useDebounce(q, 200);
  const { data: results, loading } = useApi<Result[]>(`/api/pos/search?${qs({ q: dq })}`);

  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Cust | null>(null);
  const [custQ, setCustQ] = useState("");
  const dCustQ = useDebounce(custQ);
  const custs = useApi<{ items: Cust[] }>(custQ ? `/api/customers?${qs({ q: dCustQ, active: 1, pageSize: 6 })}` : null);

  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountValue, setDiscountValue] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD" | "CREDIT">("CASH");
  const [tendered, setTendered] = useState("");
  const [rxOk, setRxOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string; invoiceNo: string; total: string; paid: string } | null>(null);

  const addToCart = useCallback((r: Result) => {
    if (r.stock <= 0) { toast.error(`${r.name} is out of stock (expired batches are not sellable).`); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.medicineId === r.id);
      if (i >= 0) {
        if (c[i].qty >= c[i].stock) { toast.error(`Only ${c[i].stock} of ${r.name} available.`); return c; }
        return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...c, { medicineId: r.id, name: r.name, price: Number(r.price), stock: r.stock, qty: 1, rx: r.prescriptionRequired }];
    });
  }, [toast]);

  async function onSearchEnter() {
    const term = q.trim();
    if (!term) return;
    try {
      const rows = await api<Result[]>(`/api/pos/search?${qs({ q: term })}`);
      const hit = rows.find((r) => r.exactBarcode) ?? (rows.length === 1 ? rows[0] : null);
      if (hit) { addToCart(hit); setQ(""); } else if (!rows.length) toast.error("No medicine found for that search or barcode.");
    } catch (e) { toast.error((e as Error).message); }
  }

  const subtotalC = cart.reduce((s, l) => s + cents(l.price) * l.qty, 0);
  const dv = Number(discountValue) || 0;
  const discountC = Math.min(subtotalC, discountType === "PERCENT" ? Math.round((subtotalC * Math.min(dv, 100)) / 100) : cents(dv));
  const totalC = subtotalC - discountC;
  const total = totalC / 100;
  const tenderedN = tendered === "" ? (method === "CREDIT" ? 0 : total) : Number(tendered);
  const paidC = Math.min(cents(tenderedN), totalC);
  const balanceC = totalC - paidC;
  const changeC = method === "CASH" ? Math.max(0, cents(tenderedN) - totalC) : 0;
  const hasRx = cart.some((l) => l.rx);

  useEffect(() => { if (method !== "CASH") setTendered(""); }, [method]);

  const problem = useMemo(() => {
    if (!cart.length) return "Add at least one medicine";
    if (discountType === "PERCENT" && dv > 100) return "Discount cannot exceed 100%";
    if (cents(dv) > subtotalC && discountType === "AMOUNT") return "Discount is more than the subtotal";
    if (balanceC > 0 && !customer) return "Select a customer to leave a balance on credit";
    if (hasRx && !rxOk) return "Confirm the prescription check";
    return "";
  }, [cart.length, discountType, dv, subtotalC, balanceC, customer, hasRx, rxOk]);

  async function complete() {
    if (problem || submitting) return;
    setSubmitting(true);
    try {
      const r = await api<{ id: string; invoiceNo: string; total: string; amountPaid: string }>("/api/sales", {
        body: { customerId: customer?.id ?? null, items: cart.map((l) => ({ medicineId: l.medicineId, quantity: l.qty })), discountType, discountValue: dv, paymentMethod: method, amountPaid: paidC / 100 },
      });
      setDone({ id: r.id, invoiceNo: r.invoiceNo, total: r.total, paid: r.amountPaid });
    } catch (e) { toast.error((e as Error).message); } finally { setSubmitting(false); }
  }

  function reset() {
    setCart([]); setCustomer(null); setCustQ(""); setDiscountValue(""); setTendered(""); setMethod("CASH"); setRxOk(false); setDone(null); setQ("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  useShortcutHelp([
    { keys: "F2", label: "Search or scan a barcode" },
    { keys: "Enter", label: "Add the scanned medicine (or the only match)" },
    { keys: "F9", label: "Complete the sale" },
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); } // "/" comes from the shortcut provider
      if (e.key === "F9") { e.preventDefault(); complete(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* left: search */}
      <div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">Point of sale</h1>
        <Card className="p-3">
          <Input ref={searchRef} autoFocus data-shortcut="search" aria-keyshortcuts="F2 /" aria-label="Search medicine or scan barcode" placeholder="Search by name, generic, SKU – or scan a barcode  (F2)" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter(); } }} className="py-3 text-base" />
          <p className="mt-1.5 text-xs text-slate-500">USB scanners work like a keyboard – scan and the item is added. Stock is sold earliest-expiry first (FEFO); expired batches are never sold.</p>
        </Card>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy={loading}>
          {results?.map((r) => (
            <button key={r.id} onClick={() => { addToCart(r); searchRef.current?.focus(); }} disabled={r.stock <= 0}
              className={cn("card flex flex-col gap-1 p-3 text-left transition hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50", r.exactBarcode && "border-brand-500 ring-1 ring-brand-500")}>
              <span className="flex items-start justify-between gap-2"><span className="font-medium leading-tight">{r.name}</span>{r.prescriptionRequired && <Badge tone="blue">Rx</Badge>}</span>
              <span className="text-xs text-slate-500">{r.genericName ?? "—"}</span>
              <span className="mt-1 flex items-center justify-between text-sm"><b>{money(r.price)}</b>{r.stock <= 0 ? <Badge tone="red">Out of stock</Badge> : <Badge tone={r.stock <= 10 ? "amber" : "green"}>{r.stock} in stock</Badge>}</span>
              {r.nextExpiry && <span className="text-[11px] text-slate-400">Next expiry {formatDate(r.nextExpiry)}</span>}
            </button>
          ))}
          {results && results.length === 0 && <div className="sm:col-span-2 xl:col-span-3"><EmptyState title="No medicines match" hint="Check the spelling or scan the barcode again." /></div>}
        </div>
      </div>

      {/* right: cart */}
      <aside aria-label="Current sale" className="lg:sticky lg:top-20 lg:self-start">
        <Card className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><ShoppingCart className="h-4 w-4" aria-hidden /><h2 className="font-semibold">Current sale</h2>
            {cart.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>Clear</Button>}</div>

          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 p-2.5 text-sm dark:bg-brand-900/30">
                <div><div className="flex items-center gap-1.5 font-medium"><UserRound className="h-4 w-4" aria-hidden /> {customer.name}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">Owes {money(customer.balance)} · limit {money(customer.creditLimit)}</div></div>
                <Button size="sm" variant="ghost" aria-label="Remove customer" onClick={() => setCustomer(null)}><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <div className="relative">
                <Input aria-label="Customer (optional)" placeholder="Customer (optional) – search name or phone" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                {custQ && custs.data && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {custs.data.items.length === 0 && <li className="p-3 text-sm text-slate-500">No customers found</li>}
                    {custs.data.items.map((c) => (
                      <li key={c.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setCustomer(c); setCustQ(""); }}>
                        <span className="font-medium">{c.name}</span> <span className="text-xs text-slate-500">{c.phone} · owes {money(c.balance)}</span></button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="max-h-[38vh] min-h-[120px] overflow-y-auto">
            {cart.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Cart is empty. Search or scan a medicine.</p> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {cart.map((l) => (
                  <li key={l.medicineId} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name} {l.rx && <Badge tone="blue">Rx</Badge>}</div><div className="text-xs text-slate-500">{money(l.price)} each</div></div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="secondary" aria-label={`Decrease ${l.name}`} onClick={() => setCart((c) => c.flatMap((x) => (x.medicineId === l.medicineId ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}><Minus className="h-3.5 w-3.5" /></Button>
                      <input aria-label={`Quantity of ${l.name}`} type="number" min={1} max={l.stock} value={l.qty} className="input w-14 px-1 py-1 text-center"
                        onChange={(e) => { const n = Math.max(1, Math.min(l.stock, parseInt(e.target.value || "1", 10) || 1)); setCart((c) => c.map((x) => (x.medicineId === l.medicineId ? { ...x, qty: n } : x))); }} />
                      <Button size="sm" variant="secondary" aria-label={`Increase ${l.name}`} disabled={l.qty >= l.stock} onClick={() => setCart((c) => c.map((x) => (x.medicineId === l.medicineId ? { ...x, qty: x.qty + 1 } : x)))}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="w-20 text-right text-sm font-medium">{money((cents(l.price) * l.qty) / 100)}</div>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => setCart((c) => c.filter((x) => x.medicineId !== l.medicineId))}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
            {hasRx && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" aria-hidden /> Prescription medicines in cart</p>
                <Checkbox label="I have checked a valid prescription" checked={rxOk} onChange={(e) => setRxOk(e.target.checked)} />
              </div>
            )}
            <div className="flex gap-2">
              <Select aria-label="Discount type" value={discountType} onChange={(e) => setDiscountType(e.target.value as "AMOUNT" | "PERCENT")} className="w-28"><option value="AMOUNT">Discount</option><option value="PERCENT">Discount %</option></Select>
              <Input aria-label="Discount value" type="number" min="0" step="0.01" placeholder="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{money(subtotalC / 100)}</dd></div>
              {discountC > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {money(discountC / 100)}</dd></div>}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold dark:border-slate-700"><dt>Total</dt><dd>{money(total)}</dd></div>
            </dl>
            <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
              {(["CASH", "CARD", "CREDIT"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={cn("rounded-lg border px-2 py-2 text-sm font-medium", method === m ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800")}>{m === "CREDIT" ? "Credit (udhaar)" : m[0] + m.slice(1).toLowerCase()}</button>
              ))}
            </div>
            {method !== "CARD" && (
              <div>
                <Input aria-label={method === "CASH" ? "Cash received" : "Amount paid now"} type="number" min="0" step="0.01" placeholder={method === "CASH" ? `Cash received (default ${total.toFixed(2)})` : "Amount paid now (optional)"} value={tendered} onChange={(e) => setTendered(e.target.value)} />
                {method === "CASH" && changeC > 0 && <p className="mt-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">Change to return: {money(changeC / 100)}</p>}
              </div>
            )}
            {balanceC > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{money(balanceC / 100)} will be added to {customer ? `${customer.name}'s` : "the customer's"} credit account.</p>}
            {problem && cart.length > 0 && <p role="alert" className="text-xs text-red-600">{problem}</p>}
            <Button size="lg" className="w-full" disabled={!!problem} loading={submitting} onClick={complete}>Complete sale (F9)</Button>
          </div>
        </Card>
      </aside>

      <Modal open={!!done} onClose={reset} title="Sale completed">
        {done && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
            <div><p className="text-lg font-semibold">{done.invoiceNo}</p><p className="text-sm text-slate-500">Total {money(done.total)} · paid {money(done.paid)}</p></div>
            <div className="flex justify-center gap-2">
              <Button data-autofocus onClick={() => window.open(`/invoice/${done.id}?print=1`, "_blank")}><Printer className="h-4 w-4" /> Print invoice</Button>
              <Button variant="secondary" onClick={reset}>New sale</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
