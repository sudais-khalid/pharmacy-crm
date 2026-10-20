"use client";
import { useState } from "react";
import { Ban, FileImage, Plus, Tags } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useApp, useCan, useMoney } from "@/components/app-context";
import { api, ApiError, formatDate, qs, useApi } from "@/lib/client";

type Category = { id: string; name: string; active: boolean };
type Expense = {
  id: string; number: string; date: string; amount: string; method: "CASH" | "CARD"; description: string; receiptFileId: string | null; cashSessionId: string | null;
  cancelledAt: string | null; cancelReason: string | null; category: { name: string }; user: { name: string };
};
type List = { items: Expense[]; total: number; page: number; pageSize: number; sum: string; byCategory: { category: string; amount: string }[] };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Expenses (roadmap 8.1 and 8.2): rent, salaries and bills, which turn gross profit into net profit. */
export default function ExpensesPage() {
  const { settings } = useApp();
  const money = useMoney();
  const canManage = useCan("expenses.manage");
  const today = localToday();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editingCats, setEditingCats] = useState(false);
  const [cancelling, setCancelling] = useState<Expense | null>(null);
  const cats = useApi<{ items: Category[] }>("/api/expenses/categories");
  const list = useApi<List>(`/api/expenses?${qs({ from, to, categoryId, cancelled: cancelled ? "1" : undefined, page })}`);
  const reloadAll = () => { list.reload(); cats.reload(); };
  if (!settings.expensesOn) return <EmptyState title="Expenses are switched off" hint="Ask your system administrator to turn them on for this pharmacy." />;
  const top = Number(list.data?.byCategory[0]?.amount ?? 0);
  return (
    <>
      <PageHeader title="Expenses" subtitle="Rent, salaries, bills and other running costs. Supplier payments are not expenses." actions={canManage && <>
        <Button variant="secondary" onClick={() => setEditingCats(true)}><Tags className="h-4 w-4" aria-hidden /> Categories</Button>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Record expense</Button></>} />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
        <Field label="Category" className="min-w-[180px]"><Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">All categories</option>{cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (not in use)"}</option>)}</Select></Field>
        <Checkbox label="Show cancelled" checked={cancelled} onChange={(e) => { setCancelled(e.target.checked); setPage(1); }} />
      </Card>
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            {list.loading && !list.data ? <TableSkeleton /> : !list.data?.items.length ? <EmptyState title="No expenses in this range" hint={canManage ? "Record rent, salaries or a bill with Record expense." : undefined} /> : (
              <>
                <TableWrap><thead><tr className="border-b border-border"><th className="th">Date</th><th className="th">Category</th><th className="th">For</th><th className="th">Paid</th><th className="th text-right">Amount</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{list.data.items.map((e) => (
                    <tr key={e.id} className={`border-b border-border/60 ${e.cancelledAt ? "opacity-60" : ""}`}>
                      <td className="td whitespace-nowrap">{formatDate(e.date)}<div className="text-xs text-fg-muted">{e.number}</div></td>
                      <td className="td">{e.category.name}</td>
                      <td className="td">{e.description}<div className="text-xs text-fg-muted">by {e.user.name}{e.cancelledAt ? `; cancelled: ${e.cancelReason}` : ""}</div></td>
                      <td className="td">{e.method === "CASH" ? "Cash" : "Card"}{e.cashSessionId && <div className="text-xs text-fg-muted">from the drawer</div>}</td>
                      <td className={`td text-right font-medium ${e.cancelledAt ? "line-through" : ""}`}>{money(e.amount)}</td>
                      <td className="td whitespace-nowrap text-right">
                        {e.receiptFileId && <a href={`/api/files/${e.receiptFileId}`} target="_blank" rel="noreferrer" className="mr-1 inline-flex rounded p-1 text-fg-muted hover:bg-muted" aria-label={`Receipt for ${e.number}`} title="Receipt"><FileImage className="h-4 w-4" /></a>}
                        {e.cancelledAt ? <Badge tone="red">Cancelled</Badge> : canManage && <button className="inline-flex rounded p-1 text-fg-muted hover:bg-muted hover:text-danger" onClick={() => setCancelling(e)} aria-label={`Cancel ${e.number}`} title="Cancel"><Ban className="h-4 w-4" /></button>}
                      </td>
                    </tr>))}</tbody></TableWrap>
                <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
              </>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-sm text-fg-muted">Total, {formatDate(from)} to {formatDate(to)}</p>
            <p className="mb-4 text-2xl font-semibold">{money(list.data?.sum ?? 0)}</p>
            {!!list.data?.byCategory.length && <ul className="space-y-2 text-sm">{list.data.byCategory.map((b) => (
              <li key={b.category}><div className="flex justify-between"><span>{b.category}</span><span className="font-medium">{money(b.amount)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${top ? Math.round((Number(b.amount) / top) * 100) : 0}%` }} /></div></li>))}</ul>}
            <p className="mt-4 text-xs text-fg-muted">Cancelled expenses count nowhere. Net profit in Reports subtracts these from gross profit.</p>
          </Card>
        </div>
      )}
      {adding && <AddExpense categories={(cats.data?.items ?? []).filter((c) => c.active)} cashSessionsOn={settings.cashSessionsOn} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reloadAll(); }} />}
      {editingCats && <Categories items={cats.data?.items ?? []} onClose={() => setEditingCats(false)} onChanged={reloadAll} />}
      {cancelling && <CancelExpense expense={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); list.reload(); }} />}
    </>
  );
}

function AddExpense({ categories, cashSessionsOn, onClose, onSaved }: { categories: Category[]; cashSessionsOn: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ categoryId: categories[0]?.id ?? "", amount: "", date: localToday(), method: "CASH" as "CASH" | "CARD", description: "", fromDrawer: cashSessionsOn });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [key] = useState(newKey);
  const fromDrawer = f.method === "CASH" && f.fromDrawer;
  async function save() {
    setSaving(true); setErrors({});
    try {
      const body = { ...f, amount: Number(f.amount), fromDrawer };
      if (receipt) {
        const form = new FormData();
        Object.entries(body).forEach(([k, v]) => form.append(k, String(v)));
        form.append("receipt", receipt);
        const res = await fetch("/api/expenses", { method: "POST", body: form, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(data.error ?? "Could not save the expense", res.status, data.fields);
      } else {
        await api("/api/expenses", { body, idempotencyKey: key });
      }
      toast.success("Expense recorded");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Record an expense" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save} disabled={!f.categoryId}>Save</Button></>}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Category" error={errors.categoryId}><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Amount" error={errors.amount}><Input type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-autofocus /></Field>
        <Field label="Date" error={errors.date}><Input type="date" value={f.date} max={localToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as "CASH" | "CARD" })}><option value="CASH">Cash</option><option value="CARD">Card or bank</option></Select></Field>
        <Field label="What it was for" error={errors.description} className="sm:col-span-2"><Input value={f.description} maxLength={300} placeholder="October shop rent" onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {cashSessionsOn && f.method === "CASH" && <div className="sm:col-span-2"><Checkbox label="Taken from my open cash drawer" checked={f.fromDrawer} onChange={(e) => setF({ ...f, fromDrawer: e.target.checked })} />
          <p className="mt-1 text-xs text-fg-muted">The drawer then expects this much less cash when you close it.</p></div>}
        <Field label="Receipt photo (optional)" hint="JPEG, PNG or WebP, up to 8 MB" className="sm:col-span-2"><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CancelExpense({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const money = useMoney();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    try {
      await api(`/api/expenses/${expense.id}/cancel`, { body: { reason } });
      toast.success("Expense cancelled");
      onDone();
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Cancel ${expense.number}?`} footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" loading={saving} disabled={reason.trim().length < 3} onClick={confirm}>Cancel expense</Button></>}>
      <p className="mb-3 text-sm">{expense.category.name}, {money(expense.amount)} on {formatDate(expense.date)}. It stays on record, marked cancelled, and stops counting in profit{expense.cashSessionId ? " and in the drawer's expected cash" : ""}.</p>
      <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered twice" data-autofocus /></Field>
    </Modal>
  );
}

function Categories({ items, onClose, onChanged }: { items: Category[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(body: { name: string; active?: boolean }, id?: string) {
    setBusy(true);
    try {
      await api(id ? `/api/expenses/categories/${id}` : "/api/expenses/categories", { method: id ? "PUT" : "POST", body });
      if (!id) setName("");
      onChanged();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Expense categories" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <form className="mb-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save({ name }); }}>
        <Field label="New category" className="flex-1"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
        <Button type="submit" loading={busy} disabled={name.trim().length < 2}>Add</Button>
      </form>
      <ul className="divide-y divide-border text-sm">{items.map((c) => (
        <li key={c.id} className="flex items-center justify-between py-2">
          <span className={c.active ? "" : "text-fg-muted line-through"}>{c.name}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ name: c.name, active: !c.active }, c.id)}>{c.active ? "Stop using" : "Use again"}</Button>
        </li>))}</ul>
      <p className="mt-3 text-xs text-fg-muted">Categories in use cannot be deleted; stop using one to hide it from new expenses.</p>
    </Modal>
  );
}
