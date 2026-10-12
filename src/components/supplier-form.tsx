"use client";
import { useState } from "react";
import { Button, Checkbox, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";

export type Supplier = { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; paymentTerms: string | null; notes: string | null; active: boolean; balance?: string };

export function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: supplier?.name ?? "", contactPerson: supplier?.contactPerson ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", paymentTerms: supplier?.paymentTerms ?? "", notes: supplier?.notes ?? "", active: supplier?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErrors({});
    try { await api(supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers", { method: supplier ? "PUT" : "POST", body: f }); toast.success(supplier ? "Supplier updated" : "Supplier added"); onSaved(); }
    catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={supplier ? "Edit supplier" : "Add supplier"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="sup-form" loading={saving}>Save</Button></>}>
      <form id="sup-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name *" error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required data-autofocus /></Field>
        <Field label="Contact person"><Input value={f.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="e.g. Net 30" /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Checkbox label="Active" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
      </form>
    </Modal>
  );
}

