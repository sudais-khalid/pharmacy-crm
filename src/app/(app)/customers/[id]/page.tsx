"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, HandCoins, Pencil, Printer } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, StatCard, Tabs, TableWrap, Spinner, useToast } from "@/components/ui";
import { useApp, useCan, useMoney } from "@/components/app-context";
import { api, formatDateTime, useApi } from "@/lib/client";
import { CustomerForm, type Customer } from "@/components/customer-form";

type Detail = {
  customer: Customer; balance: string; totalPurchases: string; totalPayments: string;
  ledger: { id: string; kind: string; debit: string; credit: string; balance: string; description: string; createdAt: string; method: string | null }[];
  sales: { id: string; invoiceNo: string; createdAt: string; total: string; amountPaid: string; status: string; paymentMethod: string }[];
};

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const money = useMoney(); const toast = useToast(); const { settings } = useApp();
  const canPay = useCan("customers.payments"); const canManage = useCan("customers.manage");
  const { data, error, loading, reload } = useApi<Detail>(`/api/customers/${id}`);
  const [tab, setTab] = useState<"ledger" | "sales" | "payments">("ledger");
  const [paying, setPaying] = useState(false); const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState("CASH"); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const { customer: c } = data;

  async function pay(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api(`/api/customers/${id}/payments`, { body: { amount, method, note } }); toast.success("Payment recorded"); setPaying(false); setAmount(""); setNote(""); reload(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  const payments = data.ledger.filter((l) => l.kind === "PAYMENT");

  return (
    <>
      <Link href="/customers" className="no-print mb-2 inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-300"><ArrowLeft className="h-4 w-4" /> Customers</Link>
      <PageHeader title={c.name} subtitle={[c.phone, c.email, c.address].filter(Boolean).join(" · ") || "No contact details"}
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print statement</Button>
          {canManage && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
          {canPay && Number(data.balance) > 0 && <Button onClick={() => { setAmount(String(data.balance)); setPaying(true); }}><HandCoins className="h-4 w-4" /> Receive payment</Button>}
        </>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Outstanding balance" value={money(data.balance)} tone={Number(data.balance) > 0 ? "amber" : "green"} icon={<span className="font-bold">₨</span>} />
        <StatCard label="Credit limit" value={money(c.creditLimit)} icon={<span className="font-bold">≤</span>} tone="blue" />
        <StatCard label="Total purchases" value={money(data.totalPurchases)} icon={<span className="font-bold">+</span>} />
        <StatCard label="Total payments" value={money(data.totalPayments)} icon={<span className="font-bold">−</span>} tone="green" />
      </div>
      {c.notes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Notes: {c.notes}</p>}
      <div className="mt-6 no-print"><Tabs tabs={[{ id: "ledger", label: "Ledger" }, { id: "sales", label: "Purchase history" }, { id: "payments", label: "Payment history" }]} value={tab} onChange={setTab} /></div>
      <Card className="print-area">
        <div className="hidden p-4 print:block"><h2 className="text-lg font-bold">{settings.pharmacyName} – statement for {c.name}</h2></div>
        {tab === "ledger" && (data.ledger.length === 0 ? <EmptyState title="No ledger entries yet" /> : (
          <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Date</th><th className="th">Description</th><th className="th text-right">Debit (owed)</th><th className="th text-right">Credit (paid)</th><th className="th text-right">Balance</th></tr></thead>
            <tbody>{data.ledger.map((l) => (<tr key={l.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td whitespace-nowrap">{formatDateTime(l.createdAt)}</td><td className="td">{l.description}</td><td className="td text-right">{Number(l.debit) ? money(l.debit) : ""}</td><td className="td text-right text-emerald-700 dark:text-emerald-400">{Number(l.credit) ? money(l.credit) : ""}</td><td className="td text-right font-medium">{money(l.balance)}</td></tr>))}</tbody></TableWrap>))}
        {tab === "sales" && (data.sales.length === 0 ? <EmptyState title="No purchases yet" /> : (
          <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Invoice</th><th className="th">Date</th><th className="th">Payment</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th">Status</th></tr></thead>
            <tbody>{data.sales.map((s) => (<tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td"><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/invoice/${s.id}`}>{s.invoiceNo}</Link></td><td className="td">{formatDateTime(s.createdAt)}</td><td className="td capitalize">{s.paymentMethod.toLowerCase()}</td><td className="td text-right">{money(s.total)}</td><td className="td text-right">{money(s.amountPaid)}</td><td className="td">{s.status === "COMPLETED" ? <Badge tone="green">Completed</Badge> : <Badge tone="red">Cancelled</Badge>}</td></tr>))}</tbody></TableWrap>))}
        {tab === "payments" && (payments.length === 0 ? <EmptyState title="No payments yet" /> : (
          <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Date</th><th className="th">Description</th><th className="th">Method</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{payments.map((l) => (<tr key={l.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td">{formatDateTime(l.createdAt)}</td><td className="td">{l.description}</td><td className="td capitalize">{l.method?.toLowerCase() ?? "—"}</td><td className="td text-right">{money(l.credit)}</td></tr>))}</tbody></TableWrap>))}
      </Card>

      <Modal open={paying} onClose={() => setPaying(false)} title="Receive payment" footer={<><Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button><Button type="submit" form="pay-form" loading={busy}>Record payment</Button></>}>
        <p className="mb-3 text-sm">Outstanding: <b>{money(data.balance)}</b></p>
        <form id="pay-form" onSubmit={pay} className="space-y-4">
          <Field label="Amount"><Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required data-autofocus /></Field>
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option></Select></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </form>
      </Modal>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
