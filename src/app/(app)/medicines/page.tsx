"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, Pencil, Plus, RotateCcw, Trash2, Eye } from "lucide-react";
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { ApiError, api, formatDate, qs, useApi, useDebounce } from "@/lib/client";

type Category = { id: string; name: string };
type Med = {
  id: string; name: string; genericName: string | null; barcode: string | null; sku: string | null; unit: string; purchasePrice: string; salePrice: string;
  minStock: number; prescriptionRequired: boolean; active: boolean; description: string | null; category: Category | null; categoryId: string | null; stock: number; expiredStock: number;
};
type List = { items: Med[]; total: number; page: number; pageSize: number };
type Detail = Med & { batches: { id: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: string; salePrice: string }[] };

const emptyForm = { name: "", genericName: "", categoryId: "", barcode: "", sku: "", unit: "Pack", purchasePrice: "", salePrice: "", minStock: "10", prescriptionRequired: false, description: "", active: true, batchNumber: "", expiryDate: "", quantity: "" };

function MedicinesInner() {
  const seesCost = useCan("cost.view");
  const sp = useSearchParams();
  const toast = useToast();
  const money = useMoney();
  const canManage = useCan("medicines.manage");
  const canDelete = useCan("medicines.delete");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("active");
  const [stock, setStock] = useState(sp.get("stock") || "");
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, categoryId, status, stock]);

  const { data, error, loading, reload } = useApi<List>(`/api/medicines?${qs({ q: dq, categoryId, status, stock, page })}`);
  const cats = useApi<Category[]>("/api/categories");

  const [editing, setEditing] = useState<Med | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Med | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(m: Med) {
    setBusy(true);
    try {
      const r = await api<{ deleted: boolean; archived: boolean }>(`/api/medicines/${m.id}`, { method: "DELETE" });
      toast.success(r.deleted ? `${m.name} deleted` : `${m.name} has transaction history, so it was archived instead`);
      setConfirm(null); reload();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function restore(m: Med) {
    try {
      await api(`/api/medicines/${m.id}`, { method: "PUT", body: { ...m, categoryId: m.categoryId, active: true } });
      toast.success(`${m.name} restored`); reload();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Medicines" subtitle="Catalogue of everything you sell. Stock is tracked per batch." actions={canManage && <Button onClick={() => setEditing("new")} data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N"><Plus className="h-4 w-4" /> Add medicine</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, generic, barcode, SKU" className="min-w-[220px] flex-1" />
          <Select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44">
            <option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Stock level" value={stock} onChange={(e) => setStock(e.target.value)} className="w-40">
            <option value="">Any stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
          </Select>
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? (
          <EmptyState title="No medicines found" hint="Try different filters, or add your first medicine." action={canManage && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add medicine</Button>} />
        ) : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Medicine</th><th className="th">Category</th><th className="th">Barcode</th>{seesCost && <th className="th text-right">Cost</th>}<th className="th text-right">Price</th><th className="th text-right">Stock</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="td"><div className="font-medium">{m.name} {m.prescriptionRequired && <Badge tone="blue">Rx</Badge>} {!m.active && <Badge>Archived</Badge>}</div><div className="text-xs text-slate-500">{m.genericName}</div></td>
                    <td className="td">{m.category?.name ?? "—"}</td>
                    <td className="td font-mono text-xs">{m.barcode ?? "—"}</td>
                    {seesCost && <td className="td text-right">{money(m.purchasePrice)}</td>}
                    <td className="td text-right">{money(m.salePrice)}</td>
                    <td className="td text-right">
                      {m.stock === 0 ? <Badge tone="red">Out of stock</Badge> : m.stock <= m.minStock ? <Badge tone="amber">{m.stock} · low</Badge> : <Badge tone="green">{m.stock}</Badge>}
                      {m.expiredStock > 0 && <div className="mt-1"><Badge tone="red">{m.expiredStock} expired</Badge></div>}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-label={`View ${m.name}`} onClick={() => setViewing(m.id)}><Eye className="h-4 w-4" /></Button>
                        {canManage && <Button size="sm" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button>}
                        {canManage && !m.active && <Button size="sm" variant="ghost" aria-label={`Restore ${m.name}`} onClick={() => restore(m)}><RotateCcw className="h-4 w-4" /></Button>}
                        {canDelete && m.active && <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => setConfirm(m)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {editing && <MedicineForm med={editing === "new" ? null : editing} categories={cats.data ?? []} reloadCats={cats.reload} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <MedicineDetail id={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog open={!!confirm} danger loading={busy} title="Delete medicine?" confirmLabel="Delete" onClose={() => setConfirm(null)} onConfirm={() => confirm && remove(confirm)}
        message={<><p><b>{confirm?.name}</b> will be removed.</p><p className="mt-2 flex items-start gap-2"><Archive className="mt-0.5 h-4 w-4 shrink-0" /> If it already appears in sales, purchases or stock history it is archived instead (history is never destroyed) and can be restored later.</p></>} />
    </>
  );
}

function MedicineDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const money = useMoney();
  const seesCost = useCan("cost.view");
  const { data, loading } = useApi<Detail>(id ? `/api/medicines/${id}` : null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Modal open={!!id} onClose={onClose} title={data?.name ?? "Medicine"} wide>
      {loading || !data ? <TableSkeleton rows={4} cols={4} /> : (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {[["Generic", data.genericName], ["Category", data.category?.name], ["Barcode", data.barcode], ["SKU", data.sku], ["Unit", data.unit], ["Min. stock", data.minStock], ["Cost price", money(data.purchasePrice)], ["Sale price", money(data.salePrice)], ["Sellable stock", data.stock]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{(v as string) || "—"}</dd></div>
            ))}
          </dl>
          {data.description && <p className="text-slate-600 dark:text-slate-300">{data.description}</p>}
          <h3 className="font-semibold">Batches (earliest expiry sells first)</h3>
          {data.batches.length === 0 ? <p className="text-slate-500">No batches yet – add stock through Purchases.</p> : (
            <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Batch</th><th className="th">Expiry</th><th className="th text-right">Qty</th>{seesCost && <th className="th text-right">Cost</th>}<th className="th text-right">Price</th></tr></thead>
              <tbody>{data.batches.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td">{b.batchNumber}</td>
                  <td className="td">{formatDate(b.expiryDate)} {b.expiryDate.slice(0, 10) < today && <Badge tone="red">Expired</Badge>}</td>
                  <td className="td text-right">{b.quantity}</td>{seesCost && <td className="td text-right">{money(b.purchasePrice)}</td>}<td className="td text-right">{money(b.salePrice)}</td></tr>))}</tbody></TableWrap>
          )}
        </div>
      )}
    </Modal>
  );
}

function MedicineForm({ med, categories, reloadCats, onClose, onSaved }: { med: Med | null; categories: Category[]; reloadCats: () => void; onClose: () => void; onSaved: () => void }) {
  const seesCost = useCan("cost.view");
  const toast = useToast();
  const [f, setF] = useState(med ? { ...emptyForm, name: med.name, genericName: med.genericName ?? "", categoryId: med.categoryId ?? "", barcode: med.barcode ?? "", sku: med.sku ?? "", unit: med.unit, purchasePrice: String(med.purchasePrice), salePrice: String(med.salePrice), minStock: String(med.minStock), prescriptionRequired: med.prescriptionRequired, description: med.description ?? "", active: med.active } : emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState("");
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function addCategory() {
    if (!newCat.trim()) return;
    try {
      const c = await api<Category>("/api/categories", { body: { name: newCat } });
      reloadCats(); set("categoryId", c.id); setNewCat("");
    } catch (e) { toast.error((e as Error).message); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErrors({});
    const body: Record<string, unknown> = { ...f, categoryId: f.categoryId || null, purchasePrice: f.purchasePrice || 0, salePrice: f.salePrice || 0 };
    delete body.batchNumber; delete body.expiryDate; delete body.quantity;
    if (!med && f.quantity) body.opening = { batchNumber: f.batchNumber, expiryDate: f.expiryDate, quantity: f.quantity };
    try {
      await api(med ? `/api/medicines/${med.id}` : "/api/medicines", { method: med ? "PUT" : "POST", body });
      toast.success(med ? "Medicine updated" : "Medicine added");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={med ? `Edit ${med.name}` : "Add medicine"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="med-form" loading={saving}>{med ? "Save changes" : "Add medicine"}</Button></>}>
      <form id="med-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Medicine name *" error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required data-autofocus /></Field>
        <Field label="Generic name"><Input value={f.genericName} onChange={(e) => set("genericName", e.target.value)} /></Field>
        <div>
          <Field label="Category"><Select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}><option value="">— None —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="mt-1.5 flex gap-2"><Input aria-label="New category name" placeholder="New category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><Button size="sm" variant="secondary" onClick={addCategory}>Add</Button></div>
        </div>
        <Field label="Barcode" error={errors.barcode} hint="Scan with a USB scanner"><Input value={f.barcode} onChange={(e) => set("barcode", e.target.value)} /></Field>
        <Field label="SKU" error={errors.sku}><Input value={f.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
        {seesCost && <Field label="Purchase price" error={errors.purchasePrice}><Input type="number" min="0" step="0.01" value={f.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} /></Field>}
        <Field label="Sale price" error={errors.salePrice}><Input type="number" min="0" step="0.01" value={f.salePrice} onChange={(e) => set("salePrice", e.target.value)} /></Field>
        <Field label="Unit"><Input value={f.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
        <Field label="Minimum stock (low-stock alert)" error={errors.minStock}><Input type="number" min="0" value={f.minStock} onChange={(e) => set("minStock", e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex gap-6 sm:col-span-2">
          <Checkbox label="Prescription required" checked={f.prescriptionRequired} onChange={(e) => set("prescriptionRequired", e.target.checked)} />
          <Checkbox label="Active" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        </div>
        {!med && (
          <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
            <legend className="px-1 text-sm font-medium">Opening stock (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Batch number" error={errors["opening.batchNumber"]}><Input value={f.batchNumber} onChange={(e) => set("batchNumber", e.target.value)} /></Field>
              <Field label="Expiry date" error={errors["opening.expiryDate"]}><Input type="date" value={f.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></Field>
              <Field label="Quantity" error={errors["opening.quantity"]}><Input type="number" min="1" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">Uses the purchase and sale price above. Later stock should be added through Purchases.</p>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

export default function MedicinesPage() { return <Suspense><MedicinesInner /></Suspense>; }
