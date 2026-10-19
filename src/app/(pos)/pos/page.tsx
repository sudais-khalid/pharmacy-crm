"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Minus, Plus, Printer, ShoppingCart, Trash2, UserPlus, UserRound, Wallet, X } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, Input, Select, useToast, cn } from "@/components/ui";
import { useApp, useCan, useMoney } from "@/components/app-context";
import { useShortcutHelp } from "@/components/shortcuts";
import { useDrawer } from "@/components/pos-shell";
import { api, formatDate, qs, useApi, useDebounce } from "@/lib/client";

type Result = { id: string; name: string; genericName: string | null; barcode: string | null; unit: string; prescriptionRequired: boolean; stock: number; price: string; nextExpiry: string | null; nextBatch: string | null; exactBarcode: boolean };
type Line = { medicineId: string; name: string; price: number; stock: number; qty: number; rx: boolean };
type Cust = { id: string; name: string; phone: string | null; creditLimit: string; balance: string };
type Method = "CASH" | "CARD" | "CREDIT";
type Done = { id: string; invoiceNo: string; total: string; amountPaid: string; changeGiven: string };

const cents = (n: number) => Math.round(n * 100);
const METHODS: { m: Method; label: string; key: string }[] = [{ m: "CASH", label: "Cash", key: "F5" }, { m: "CARD", label: "Card", key: "F6" }, { m: "CREDIT", label: "Credit (udhaar)", key: "F7" }];
const soon = (iso: string | null) => !!iso && new Date(iso).getTime() - Date.now() < 30 * 86_400_000;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Prints a receipt without leaving the counter: the receipt page prints itself inside a hidden frame. */
function printReceipt(saleId: string) {
  document.getElementById("receipt-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "receipt-frame";
  frame.title = "Receipt";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = `/invoice/${saleId}?print=1&embed=1`;
  document.body.appendChild(frame);
}

/** The counter (roadmap 5.1, 5.2, 5.9; UI plan, section 4.1). */
export default function PosPage() {
  const money = useMoney();
  const toast = useToast();
  const { settings } = useApp();
  const canAddCustomer = useCan("customers.manage");
  const { drawer, reload: reloadDrawer } = useDrawer();
  const searchRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const dq = useDebounce(q, 200);
  const { data: results, loading } = useApi<Result[]>(`/api/pos/search?${qs({ q: dq })}`);
  const [hi, setHi] = useState(0); // highlighted search result

  const [cart, setCart] = useState<Line[]>([]);
  const [sel, setSel] = useState(0); // selected cart line for + / - / Delete
  const [customer, setCustomer] = useState<Cust | null>(null);
  const [custQ, setCustQ] = useState("");
  const dCustQ = useDebounce(custQ);
  const custs = useApi<{ items: Cust[] }>(custQ ? `/api/customers?${qs({ q: dCustQ, active: 1, pageSize: 6 })}` : null);
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const dPhone = useDebounce(walkPhone.replace(/\D/g, ""), 300);
  const phoneMatch = useApi<{ items: Cust[] }>(!customer && dPhone.length >= 7 ? `/api/customers?${qs({ q: dPhone, active: 1, pageSize: 1 })}` : null);

  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountValue, setDiscountValue] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [tendered, setTendered] = useState("");
  const [rxOk, setRxOk] = useState(false);
  const [doctor, setDoctor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(newKey);
  const [last, setLast] = useState<Done | null>(null);

  useEffect(() => setHi(0), [results]);
  useEffect(() => { if (method !== "CASH") setTendered(""); }, [method]);

  const addToCart = useCallback((r: Result) => {
    if (r.stock <= 0) { toast.error(`${r.name} is out of stock (expired batches are not sold).`); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.medicineId === r.id);
      if (i >= 0) {
        if (c[i].qty >= c[i].stock) { toast.error(`Only ${c[i].stock} of ${r.name} available.`); return c; }
        setSel(i);
        return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      }
      setSel(c.length);
      return [...c, { medicineId: r.id, name: r.name, price: Number(r.price), stock: r.stock, qty: 1, rx: r.prescriptionRequired }];
    });
    if (soon(r.nextExpiry)) toast.info(`${r.name}: the batch sold first (${r.nextBatch}) expires ${formatDate(r.nextExpiry!)}. Mention it to the customer.`);
  }, [toast]);

  async function onSearchEnter() {
    const term = q.trim();
    if (!term) { if (results?.[hi]) addToCart(results[hi]); return; }
    // a scan arrives faster than the debounce: ask for exactly what was typed
    const rows = term === dq && results ? results : await api<Result[]>(`/api/pos/search?${qs({ q: term })}`).catch((e) => { toast.error((e as Error).message); return [] as Result[]; });
    const hit = rows.find((r) => r.exactBarcode) ?? rows[term === dq ? hi : 0] ?? null;
    if (hit) { addToCart(hit); setQ(""); } else toast.error("No medicine found for that search or barcode.");
  }

  const changeQty = (i: number, d: number) => setCart((c) => c.flatMap((x, k) => (k !== i ? [x] : x.qty + d < 1 ? [] : [{ ...x, qty: Math.min(x.stock, x.qty + d) }])));
  const removeLine = (i: number) => { setCart((c) => c.filter((_, k) => k !== i)); setSel((s) => Math.max(0, Math.min(s, cart.length - 2))); };

  const subtotalC = cart.reduce((s, l) => s + cents(l.price) * l.qty, 0);
  const dv = Number(discountValue) || 0;
  const discountC = Math.min(subtotalC, discountType === "PERCENT" ? Math.round((subtotalC * Math.min(dv, 100)) / 100) : cents(dv));
  const totalC = subtotalC - discountC;
  const tenderedC = tendered === "" ? null : cents(Number(tendered));
  const paidC = method === "CARD" ? totalC : tenderedC === null ? (method === "CREDIT" ? 0 : totalC) : Math.min(tenderedC, totalC);
  const balanceC = totalC - paidC;
  const changeC = method === "CASH" && tenderedC !== null ? Math.max(0, tenderedC - totalC) : 0;
  const hasRx = cart.some((l) => l.rx);
  const drawerBlocked = !!drawer?.required && !drawer.session && method !== "CARD" && paidC > 0;

  const problem = useMemo(() => {
    if (!cart.length) return "Add at least one medicine";
    if (discountType === "PERCENT" && dv > 100) return "Discount cannot exceed 100%";
    if (discountType === "AMOUNT" && cents(dv) > subtotalC) return "Discount is more than the subtotal";
    if (balanceC > 0 && !customer) return "Choose a customer account to leave a balance on credit";
    if (hasRx && !rxOk) return "Confirm the prescription check";
    if (drawerBlocked) return "Open your cash drawer to take cash";
    return "";
  }, [cart.length, discountType, dv, subtotalC, balanceC, customer, hasRx, rxOk, drawerBlocked]);

  async function complete() {
    if (problem || submitting) { if (problem && cart.length) toast.error(problem); return; }
    setSubmitting(true);
    try {
      const note = hasRx ? `Prescription checked${doctor.trim() ? `; Dr. ${doctor.trim()}` : ""}` : null;
      const r = await api<Done>("/api/sales", {
        idempotencyKey: idemKey,
        body: {
          customerId: customer?.id ?? null, items: cart.map((l) => ({ medicineId: l.medicineId, quantity: l.qty })), discountType, discountValue: dv, paymentMethod: method,
          amountPaid: paidC / 100, cashTendered: method === "CASH" && tenderedC !== null ? tenderedC / 100 : null, note,
          customerName: customer ? null : walkName.trim() || null, customerPhone: customer ? null : walkPhone.trim() || null,
        },
      });
      setLast(r);
      if (settings.autoPrintReceipt) printReceipt(r.id);
      toast.success(`${r.invoiceNo} completed${Number(r.changeGiven) > 0 ? `. Change ${money(r.changeGiven)}` : ""}`);
      reset();
      void reloadDrawer();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCart([]); setSel(0); setCustomer(null); setCustQ(""); setWalkName(""); setWalkPhone(""); setDiscountValue(""); setTendered(""); setMethod("CASH");
    setRxOk(false); setDoctor(""); setQ(""); setIdemKey(newKey());
    setTimeout(() => searchRef.current?.focus(), 30);
  }

  async function saveAsCustomer() {
    if (!walkName.trim()) { toast.error("Type the customer's name first."); return; }
    try {
      const c = await api<Cust>("/api/customers", { body: { name: walkName.trim(), phone: walkPhone.trim() || null, creditLimit: 0 } });
      setCustomer({ ...c, balance: "0" });
      toast.success(`${c.name} saved as a customer`);
    } catch (e) { toast.error((e as Error).message); }
  }

  useShortcutHelp([
    { keys: "F2", label: "Search or scan a barcode" },
    { keys: "Up / Down, Enter", label: "Choose a search result and add it" },
    { keys: "+ / -", label: "Change the quantity of the selected line" },
    { keys: "Delete", label: "Remove the selected line" },
    { keys: "F5 / F6 / F7", label: "Pay by cash, card or credit" },
    { keys: "F8", label: "Cash received" },
    { keys: "F9", label: "Complete the sale" },
    { keys: "Esc", label: "Clear the search" },
    { keys: "Ctrl+P", label: "Reprint the last receipt" },
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key;
      if (k === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (k === "F5" || k === "F6" || k === "F7") { e.preventDefault(); setMethod(k === "F5" ? "CASH" : k === "F6" ? "CARD" : "CREDIT"); return; }
      if (k === "F8") { e.preventDefault(); setMethod((m) => (m === "CARD" ? "CASH" : m)); setTimeout(() => tenderRef.current?.focus(), 0); return; }
      if (k === "F9") { e.preventDefault(); void complete(); return; }
      if (k.toLowerCase() === "p" && (e.ctrlKey || e.metaKey)) { if (last) { e.preventDefault(); printReceipt(last.id); } return; }
      const inSearch = e.target === searchRef.current;
      // + / - / Delete act on the cart from anywhere except a text field (the search box counts when it is empty)
      if (typing(e.target) && !(inSearch && !q)) return;
      if ((k === "+" || k === "=") && cart[sel]) { e.preventDefault(); changeQty(sel, 1); }
      else if (k === "-" && cart[sel]) { e.preventDefault(); changeQty(sel, -1); }
      else if (k === "Delete" && cart[sel]) { e.preventDefault(); removeLine(sel); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // a required drawer must be opened before the counter can take cash
  if (drawer?.required && !drawer.session) return <OpenDrawer onOpened={reloadDrawer} />;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_440px]">
      <section aria-label="Find medicines" className="min-w-0">
        <Card className="p-3">
          <Input ref={searchRef} autoFocus data-shortcut="search" aria-keyshortcuts="F2 /" aria-label="Search medicine or scan barcode" placeholder="Search by name, generic or SKU, or scan a barcode (F2)" value={q}
            onChange={(e) => setQ(e.target.value)} className="py-3 text-base"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void onSearchEnter(); }
              else if (e.key === "Escape") { e.preventDefault(); setQ(""); }
              else if (e.key === "ArrowDown" && results?.length) { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
              else if (e.key === "ArrowUp" && results?.length) { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            }}
            aria-activedescendant={results?.[hi] ? `pos-result-${results[hi].id}` : undefined} aria-controls="pos-results" />
          <p className="mt-1.5 text-xs text-fg-muted">Scanners work like a keyboard: scan and the item is added. Stock sells earliest expiry first; expired batches are never sold.</p>
        </Card>
        <ul id="pos-results" role="listbox" aria-label="Search results" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy={loading}>
          {results?.map((r, i) => (
            <li key={r.id} id={`pos-result-${r.id}`} role="option" aria-selected={i === hi}>
              <button type="button" tabIndex={-1} onClick={() => { addToCart(r); searchRef.current?.focus(); }} disabled={r.stock <= 0} onMouseEnter={() => setHi(i)}
                className={cn("card flex w-full flex-col gap-1 p-3 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50", (i === hi || r.exactBarcode) && "border-primary ring-1 ring-primary")}>
                <span className="flex items-start justify-between gap-2"><span className="font-medium leading-tight">{r.name}</span>{r.prescriptionRequired && <Badge tone="blue">Rx</Badge>}</span>
                <span className="text-xs text-fg-muted">{r.genericName ?? r.unit}</span>
                <span className="mt-1 flex items-center justify-between text-sm"><b>{money(r.price)}</b>{r.stock <= 0 ? <Badge tone="red">Out of stock</Badge> : <Badge tone={r.stock <= 10 ? "amber" : "green"}>{r.stock} in stock</Badge>}</span>
                {r.nextExpiry && <span className={cn("text-[11px]", soon(r.nextExpiry) ? "font-medium text-warning" : "text-fg-muted")}>Batch {r.nextBatch}, expires {formatDate(r.nextExpiry)}</span>}
              </button>
            </li>
          ))}
          {results && results.length === 0 && <li className="sm:col-span-2 xl:col-span-3"><EmptyState title="No medicines match" hint="Check the spelling or scan the barcode again." /></li>}
        </ul>
      </section>

      <aside aria-label="Current sale" className="lg:sticky lg:top-[4.5rem] lg:self-start">
        <Card className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5"><ShoppingCart className="h-4 w-4" aria-hidden /><h2 className="font-semibold">Current sale</h2>
            {cart.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>Clear</Button>}</div>

          <div className="space-y-2 border-b border-border p-3">
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/10 p-2.5 text-sm">
                <div><div className="flex items-center gap-1.5 font-medium"><UserRound className="h-4 w-4" aria-hidden /> {customer.name} {customer.phone && <span className="font-normal text-fg-muted">{customer.phone}</span>}</div>
                  <div className="text-xs text-fg-muted">Owes {money(customer.balance)}, limit {money(customer.creditLimit)}</div></div>
                <Button size="sm" variant="ghost" aria-label="Remove customer" onClick={() => setCustomer(null)}><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label="Customer name" placeholder="Customer name" value={walkName} onChange={(e) => setWalkName(e.target.value)} maxLength={100} />
                  <Input aria-label="Customer phone" placeholder="Phone" inputMode="tel" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} maxLength={30} />
                </div>
                {phoneMatch.data?.items[0] && (
                  <p className="text-xs">This phone belongs to <b>{phoneMatch.data.items[0].name}</b>. <button type="button" className="text-primary hover:underline" onClick={() => { setCustomer(phoneMatch.data!.items[0]); setWalkName(""); setWalkPhone(""); }}>Use their account</button></p>
                )}
                {canAddCustomer && walkName.trim() && !phoneMatch.data?.items[0] && (
                  <button type="button" onClick={saveAsCustomer} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><UserPlus className="h-3.5 w-3.5" aria-hidden /> Save as customer</button>
                )}
                <div className="relative">
                  <Input aria-label="Customer account (optional)" placeholder="Or find a customer account" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                  {custQ && custs.data && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
                      {custs.data.items.length === 0 && <li className="p-3 text-sm text-fg-muted">No customers found</li>}
                      {custs.data.items.map((c) => (
                        <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setCustomer(c); setCustQ(""); }}>
                          <span className="font-medium">{c.name}</span> <span className="text-xs text-fg-muted">{c.phone} owes {money(c.balance)}</span></button></li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="max-h-[34vh] min-h-[120px] overflow-y-auto">
            {cart.length === 0 ? <p className="p-8 text-center text-sm text-fg-muted">Search or scan a medicine to start.</p> : (
              <ul className="divide-y divide-border" aria-label="Lines">
                {cart.map((l, i) => (
                  <li key={l.medicineId} aria-current={i === sel ? "true" : undefined} onClick={() => setSel(i)} className={cn("flex items-center gap-2 px-3 py-2", i === sel && "bg-primary/5")}>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name} {l.rx && <Badge tone="blue">Rx</Badge>}</div><div className="text-xs text-fg-muted">{money(l.price)} each</div></div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="secondary" aria-label={`Decrease ${l.name}`} onClick={() => changeQty(i, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                      <input aria-label={`Quantity of ${l.name}`} type="number" min={1} max={l.stock} value={l.qty} className="input w-14 px-1 py-1 text-center" onFocus={() => setSel(i)}
                        onChange={(e) => { const n = Math.max(1, Math.min(l.stock, parseInt(e.target.value || "1", 10) || 1)); setCart((c) => c.map((x, k) => (k === i ? { ...x, qty: n } : x))); }} />
                      <Button size="sm" variant="secondary" aria-label={`Increase ${l.name}`} disabled={l.qty >= l.stock} onClick={() => changeQty(i, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="w-20 text-right text-sm font-medium">{money((cents(l.price) * l.qty) / 100)}</div>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 border-t border-border p-3">
            {hasRx && (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Prescription medicines in this sale</p>
                <Checkbox label="I have checked a valid prescription" checked={rxOk} onChange={(e) => setRxOk(e.target.checked)} />
                <Input aria-label="Doctor (optional)" placeholder="Doctor (optional)" value={doctor} onChange={(e) => setDoctor(e.target.value)} maxLength={80} className="py-1.5 text-xs" />
              </div>
            )}
            <div className="flex gap-2">
              <Select aria-label="Discount type" value={discountType} onChange={(e) => setDiscountType(e.target.value as "AMOUNT" | "PERCENT")} className="w-32"><option value="AMOUNT">Discount</option><option value="PERCENT">Discount %</option></Select>
              <Input aria-label="Discount value" type="number" min="0" step="0.01" placeholder="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-fg-muted">Subtotal</dt><dd>{money(subtotalC / 100)}</dd></div>
              {discountC > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Discount</dt><dd>- {money(discountC / 100)}</dd></div>}
              <div className="flex justify-between border-t border-border pt-2 text-xl font-semibold"><dt>Total</dt><dd>{money(totalC / 100)}</dd></div>
            </dl>
            <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
              {METHODS.map(({ m, label, key }) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} aria-keyshortcuts={key} onClick={() => setMethod(m)}
                  className={cn("rounded-lg border px-2 py-2 text-sm font-medium", method === m ? "border-primary bg-primary text-on-primary" : "border-border hover:bg-muted")}>
                  {label} <span className="block text-[10px] font-normal opacity-70">{key}</span>
                </button>
              ))}
            </div>
            {method !== "CARD" && (
              <div>
                <Input ref={tenderRef} aria-label={method === "CASH" ? "Cash received" : "Paid now"} aria-keyshortcuts="F8" type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)}
                  placeholder={method === "CASH" ? `Cash received, F8 (exact: ${(totalC / 100).toFixed(2)})` : "Paid now (optional)"}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void complete(); } }} />
                {changeC > 0 && <p className="mt-1.5 text-lg font-semibold text-success">Change {money(changeC / 100)}</p>}
              </div>
            )}
            {balanceC > 0 && <p className="rounded-lg bg-warning/10 p-2 text-sm">{money(balanceC / 100)} goes on {customer ? `${customer.name}'s` : "the customer's"} account.</p>}
            {problem && cart.length > 0 && <p role="alert" className="text-xs text-danger">{problem}</p>}
            <Button size="lg" className="w-full" disabled={!!problem} loading={submitting} onClick={complete} aria-keyshortcuts="F9">Complete and print (F9)</Button>
            {last && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                <span>Last: <b>{last.invoiceNo}</b>, {money(last.total)}{Number(last.changeGiven) > 0 && `, change ${money(last.changeGiven)}`}</span>
                <Button size="sm" variant="ghost" onClick={() => printReceipt(last.id)} aria-keyshortcuts="Control+P"><Printer className="h-3.5 w-3.5" aria-hidden /> Reprint</Button>
              </div>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

/** Shown instead of the counter when a drawer must be open first (UI plan, section 4.1). */
function OpenDrawer({ onOpened }: { onOpened: () => Promise<void> }) {
  const toast = useToast();
  const [float, setFloat] = useState("");
  const [busy, setBusy] = useState(false);
  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/cash", { body: { openingFloat: Number(float) || 0 } });
      toast.success("Drawer opened");
      await onOpened();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto mt-12 max-w-sm">
      <Card className="p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Wallet className="h-5 w-5 text-primary" aria-hidden /> Open your cash drawer</h1>
        <p className="mt-1 text-sm text-fg-muted">Count the cash in the drawer before the first sale. At the end of your shift you count it again and close the drawer.</p>
        <form onSubmit={open} className="mt-4 space-y-3">
          <Input autoFocus aria-label="Opening cash" type="number" min="0" step="0.01" placeholder="Cash in the drawer now" value={float} onChange={(e) => setFloat(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy}>Open drawer</Button>
        </form>
      </Card>
    </div>
  );
}
