"use client";
import { useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, SearchInput, Select, TableSkeleton, TableWrap, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { MedicinePicker, type PickedMedicine } from "@/components/medicine-picker";
import { ApiError, api, qs, useApi, useDebounce } from "@/lib/client";
import { guessMapping, parseCsv, type Target } from "../../stock-entry/import-map";

type Item = {
  id: string; medicineId: string; supplierCode: string | null; packSize: string | null; lastPrice: string | null; lastBonusRule: string | null; leadTimeDays: number; preferred: boolean; updatedAt: string;
  medicine: { id: string; name: string; genericName: string | null; unit: string; active: boolean };
};
type Form = { medicine: PickedMedicine | null; isNew: boolean; newName: string; newGeneric: string; newUnit: string; newSalePrice: string; supplierCode: string; packSize: string; lastPrice: string; lastBonusRule: string; leadTimeDays: string; preferred: boolean };
const blank: Form = { medicine: null, isNew: false, newName: "", newGeneric: "", newUnit: "Pack", newSalePrice: "", supplierCode: "", packSize: "", lastPrice: "", lastBonusRule: "", leadTimeDays: "2", preferred: false };

/** A supplier's medicine list (roadmap 7.1, 7.2): add an existing or brand-new medicine, codes, prices, bonus, lead time. */
export function CatalogTab({ supplierId }: { supplierId: string }) {
  const money = useMoney();
  const toast = useToast();
  const canManage = useCan("supplierCatalog.manage");
  const seesCost = useCan("cost.view");
  const [q, setQ] = useState("");
  const dq = useDebounce(q);
  const { data, error, loading, reload } = useApi<Item[]>(`/api/suppliers/${supplierId}/catalog?${qs({ q: dq })}`);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const edit = (i: Item) => setForm({ ...blank, medicine: { id: i.medicineId, name: i.medicine.name, purchasePrice: "", salePrice: "" }, supplierCode: i.supplierCode ?? "", packSize: i.packSize ?? "", lastPrice: i.lastPrice ?? "", lastBonusRule: i.lastBonusRule ?? "", leadTimeDays: String(i.leadTimeDays), preferred: i.preferred });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api(`/api/suppliers/${supplierId}/catalog`, {
        body: {
          medicineId: form.isNew ? null : form.medicine?.id ?? null,
          newMedicine: form.isNew ? { name: form.newName, genericName: form.newGeneric || null, unit: form.newUnit || "Pack", salePrice: Number(form.newSalePrice) || 0, purchasePrice: Number(form.lastPrice) || 0 } : null,
          supplierCode: form.supplierCode, packSize: form.packSize, lastPrice: form.lastPrice === "" ? null : Number(form.lastPrice),
          lastBonusRule: form.lastBonusRule, leadTimeDays: Number(form.leadTimeDays) || 0, preferred: form.preferred,
        },
      });
      toast.success(form.isNew ? `${form.newName} added to the medicines and to this catalog` : "Catalog saved");
      setForm(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(i: Item) {
    try {
      await api(`/api/suppliers/${supplierId}/catalog/${i.id}`, { method: "DELETE" });
      toast.success(`${i.medicine.name} removed from this catalog`);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Medicine or supplier code" className="min-w-[220px] flex-1" />
        {canManage && <Button variant="secondary" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Import price list</Button>}
        {canManage && <Button onClick={() => setForm({ ...blank })}><Plus className="h-4 w-4" aria-hidden /> Add medicine</Button>}
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.length ? (
        <EmptyState title="No medicines in this catalog yet" hint="Add them here, import the supplier's price list, or they join as bills from this supplier are posted." />
      ) : (
        <TableWrap>
          <thead><tr className="border-b border-border"><th className="th">Medicine</th><th className="th">Supplier code</th><th className="th">Pack</th>{seesCost && <th className="th text-right">Last price</th>}<th className="th">Bonus</th><th className="th text-right">Lead time</th>{canManage && <th className="th text-right">Actions</th>}</tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} className="border-b border-border/60">
              <td className="td"><Link href={`/medicines/${i.medicineId}`} className="font-medium hover:text-primary hover:underline">{i.medicine.name}</Link> {i.preferred && <Badge tone="green" icon={<Star className="h-3 w-3" aria-hidden />}>Preferred</Badge>} {!i.medicine.active && <Badge>Archived</Badge>}
                {i.medicine.genericName && <span className="block text-xs text-fg-muted">{i.medicine.genericName}</span>}</td>
              <td className="td font-mono text-xs">{i.supplierCode ?? ""}</td>
              <td className="td">{i.packSize ?? ""}</td>
              {seesCost && <td className="td text-right">{i.lastPrice !== null ? money(i.lastPrice) : ""}</td>}
              <td className="td">{i.lastBonusRule ?? ""}</td>
              <td className="td text-right">{i.leadTimeDays} day{i.leadTimeDays === 1 ? "" : "s"}</td>
              {canManage && <td className="td"><div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label={`Edit ${i.medicine.name}`} onClick={() => edit(i)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${i.medicine.name}`} onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-danger" /></Button>
              </div></td>}
            </tr>))}</tbody>
        </TableWrap>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Medicine in this catalog" wide
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Back</Button><Button type="submit" form="catalog-form" loading={busy}>Save</Button></>}>
        {form && (
          <form id="catalog-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div role="radiogroup" className="mb-2 flex gap-2 text-sm">
                <button type="button" role="radio" aria-checked={!form.isNew} onClick={() => setForm({ ...form, isNew: false })} className={`rounded-lg border px-3 py-1.5 ${!form.isNew ? "border-primary bg-primary text-on-primary" : "border-border"}`}>A medicine we have</button>
                <button type="button" role="radio" aria-checked={form.isNew} onClick={() => setForm({ ...form, isNew: true })} className={`rounded-lg border px-3 py-1.5 ${form.isNew ? "border-primary bg-primary text-on-primary" : "border-border"}`}>A new medicine</button>
              </div>
              {!form.isNew ? (
                <Field label="Medicine" error={errors.medicineId}><MedicinePicker value={form.medicine} onPick={(m) => setForm({ ...form, medicine: m })} /></Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" error={errors["newMedicine.name"]}><Input data-autofocus value={form.newName} onChange={(e) => setForm({ ...form, newName: e.target.value })} maxLength={150} /></Field>
                  <Field label="Generic name"><Input value={form.newGeneric} onChange={(e) => setForm({ ...form, newGeneric: e.target.value })} /></Field>
                  <Field label="Unit"><Input value={form.newUnit} onChange={(e) => setForm({ ...form, newUnit: e.target.value })} /></Field>
                  <Field label="Sale price"><Input type="number" min="0" step="0.01" value={form.newSalePrice} onChange={(e) => setForm({ ...form, newSalePrice: e.target.value })} /></Field>
                </div>
              )}
            </div>
            <Field label="Supplier's code" hint="As printed on its bills" error={errors.supplierCode}><Input value={form.supplierCode} onChange={(e) => setForm({ ...form, supplierCode: e.target.value })} maxLength={40} /></Field>
            <Field label="Pack"><Input value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} placeholder="e.g. 10x10" maxLength={40} /></Field>
            {seesCost && <Field label="Price (trade price)"><Input type="number" min="0" step="0.01" value={form.lastPrice} onChange={(e) => setForm({ ...form, lastPrice: e.target.value })} /></Field>}
            <Field label="Bonus" hint="e.g. 10+1" error={errors.lastBonusRule}><Input value={form.lastBonusRule} onChange={(e) => setForm({ ...form, lastBonusRule: e.target.value })} maxLength={20} /></Field>
            <Field label="Lead time (days)"><Input type="number" min="0" max="365" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} /></Field>
            <div className="pt-6"><Checkbox label="Preferred supplier for this medicine" checked={form.preferred} onChange={(e) => setForm({ ...form, preferred: e.target.checked })} /></div>
          </form>
        )}
      </Modal>
      {importing && <PriceListImport supplierId={supplierId} onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
    </div>
  );
}

const PRICE_TARGETS: Target[] = ["name", "barcode", "rate"];

/** A supplier's price list from Excel or CSV: map the columns, then matched rows update the catalog. */
function PriceListImport({ supplierId, onClose, onDone }: { supplierId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<(Target | "code" | "")[]>([]);
  const [busy, setBusy] = useState(false);
  const [unmatched, setUnmatched] = useState<{ name: string }[] | null>(null);

  async function read(file: File | undefined) {
    if (!file) return;
    try {
      let data: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/universal");
        data = (await readSheet(file)).map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
      } else data = parseCsv(await file.text());
      if (data.length < 2) throw new Error("The file needs a heading row and at least one line.");
      setRows(data);
      setMapping(guessMapping(data[0]).map((m, i) => (/code/i.test(data[0][i]) ? "code" : m && PRICE_TARGETS.includes(m) ? m : "")));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submit() {
    if (!rows) return;
    const col = (t: string) => mapping.indexOf(t as Target);
    if (col("name") < 0) return toast.error("Choose the column with the medicine name.");
    setBusy(true);
    try {
      const body = rows.slice(1).filter((r) => r[col("name")]?.trim()).map((r) => ({
        name: r[col("name")].trim(), supplierCode: col("code") >= 0 ? r[col("code")] : null, barcode: col("barcode") >= 0 ? r[col("barcode")] : null,
        lastPrice: col("rate") >= 0 && r[col("rate")] ? Number(String(r[col("rate")]).replace(/[,\s]/g, "")) || null : null,
      }));
      const r = await api<{ updated: number; unmatched: { name: string }[] }>(`/api/suppliers/${supplierId}/catalog/import`, { body: { rows: body } });
      toast.success(`${r.updated} medicine${r.updated === 1 ? "" : "s"} updated in the catalog`);
      if (r.unmatched.length) setUnmatched(r.unmatched);
      else onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const labels: [string, string][] = [["name", "Medicine name"], ["code", "Supplier code"], ["barcode", "Barcode"], ["rate", "Price"]];
  return (
    <Modal open onClose={unmatched ? onDone : onClose} title="Import a price list" wide
      footer={unmatched ? <Button onClick={onDone}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Back</Button><Button loading={busy} disabled={!rows} onClick={submit}>Import</Button></>}>
      {unmatched ? (
        <div className="text-sm">
          <p className="mb-2">These rows did not match a medicine by barcode, code or exact name. Add them with Add medicine:</p>
          <ul className="max-h-64 list-disc overflow-y-auto pl-5">{unmatched.map((u, i) => <li key={i}>{u.name}</li>)}</ul>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted">
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Choose an Excel or CSV file
            <input type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
          </label>
          {rows && (
            <TableWrap>
              <thead><tr className="border-b border-border">{rows[0].map((h, i) => (
                <th key={i} className="th"><span className="block normal-case">{h || `Column ${i + 1}`}</span>
                  <Select aria-label={`Column ${h || i + 1} holds`} className="mt-1 min-w-[120px]" value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, k) => (k === i ? (e.target.value as Target) : x === e.target.value ? "" : x)))}>
                    <option value="">Not used</option>{labels.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select></th>))}</tr></thead>
              <tbody>{rows.slice(1, 8).map((r, i) => <tr key={i} className="border-b border-border/60">{rows[0].map((_, k) => <td key={k} className="td">{r[k]}</td>)}</tr>)}</tbody>
            </TableWrap>
          )}
          {rows && <p className="text-fg-muted">{rows.length - 1} rows. Matched rows update this supplier's catalog; nothing else changes.</p>}
          {!rows && <p className="text-fg-muted">Rows are matched to your medicines by barcode, by this supplier's code, or by exact name.</p>}
        </div>
      )}
    </Modal>
  );
}
