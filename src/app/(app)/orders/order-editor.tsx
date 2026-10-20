"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, Field, Input, Select, TableWrap, Textarea, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { MedicinePicker, type PickedMedicine } from "@/components/medicine-picker";
import { ApiError, useApi } from "@/lib/client";

export type EditorLine = { key: string; medicine: PickedMedicine | null; qty: string; price: string };
export type EditorValue = { supplierId: string; expectedDate: string; note: string; lines: EditorLine[] };
const newLine = (): EditorLine => ({ key: Math.random().toString(36).slice(2), medicine: null, qty: "", price: "" });
export const emptyEditor = (supplierId = ""): EditorValue => ({ supplierId, expectedDate: "", note: "", lines: [newLine()] });

/** The lines of an order: medicine, quantity and expected price (left blank, the supplier's last price is used). */
export function OrderEditor({ value, onChange, onSave, saving, supplierFixed }: { value: EditorValue; onChange: (v: EditorValue) => void; onSave: (body: unknown) => Promise<void>; saving: boolean; supplierFixed?: boolean }) {
  const toast = useToast();
  const money = useMoney();
  const seesCost = useCan("cost.view");
  const suppliers = useApi<{ items: { id: string; name: string; active: boolean }[] }>("/api/suppliers?pageSize=100&active=1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<EditorValue>) => onChange({ ...value, ...patch });
  const setLine = (key: string, patch: Partial<EditorLine>) => set({ lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const used = value.lines.filter((l) => l.medicine && Number(l.qty) > 0);
  const total = used.reduce((s, l) => s + (Number(l.price) || 0) * Number(l.qty), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    if (!value.supplierId) return toast.error("Choose the supplier.");
    if (!used.length) return toast.error("Add at least one medicine with a quantity.");
    try {
      await onSave({
        supplierId: value.supplierId, expectedDate: value.expectedDate || null, note: value.note || null,
        items: used.map((l) => ({ medicineId: l.medicine!.id, orderedQty: Number(l.qty), expectedPrice: l.price === "" ? null : Number(l.price) })),
      });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Card className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label="Supplier" error={errors.supplierId}>
          <Select value={value.supplierId} disabled={supplierFixed} onChange={(e) => set({ supplierId: e.target.value })}>
            <option value="">Choose a supplier</option>
            {suppliers.data?.items.filter((s) => s.active || s.id === value.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Needed by" hint="Blank: today plus the supplier's lead time"><Input type="date" value={value.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
        <Field label="Note"><Textarea rows={1} value={value.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} /></Field>
      </Card>
      <Card>
        <TableWrap>
          <thead><tr className="border-b border-border"><th className="th w-[45%]">Medicine</th><th className="th">Quantity</th>{seesCost && <th className="th">Price</th>}{seesCost && <th className="th text-right">Value</th>}<th className="th" /></tr></thead>
          <tbody>{value.lines.map((l) => (
            <tr key={l.key} className="border-b border-border/60">
              <td className="td"><MedicinePicker value={l.medicine} onPick={(m) => setLine(l.key, { medicine: m, price: l.price || "" })} /></td>
              <td className="td"><Input aria-label="Quantity" type="number" min="1" className="w-24" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
              {seesCost && <td className="td"><Input aria-label="Expected price" type="number" min="0" step="0.01" className="w-28" placeholder="last price" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} /></td>}
              {seesCost && <td className="td text-right">{l.price && l.qty ? money(Number(l.price) * Number(l.qty)) : ""}</td>}
              <td className="td text-right"><Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => set({ lines: value.lines.length > 1 ? value.lines.filter((x) => x.key !== l.key) : [newLine()] })}><Trash2 className="h-4 w-4 text-danger" /></Button></td>
            </tr>))}</tbody>
        </TableWrap>
        <div className="flex items-center justify-between border-t border-border p-3">
          <Button variant="ghost" onClick={() => set({ lines: [...value.lines, newLine()] })}><Plus className="h-4 w-4" aria-hidden /> Add a line</Button>
          {seesCost && total > 0 && <span className="text-sm">Estimate {money(total)} (lines without a price use the supplier's last price)</span>}
        </div>
      </Card>
      <div className="flex justify-end"><Button type="submit" loading={saving}>Save draft order</Button></div>
    </form>
  );
}
