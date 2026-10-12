"use client";
import { useState } from "react";
import { Button, Checkbox, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";

export type Customer = { id: string; name: string; phone: string | null; email: string | null; address: string | null; creditLimit: string; notes: string | null; active: boolean; balance?: string };

export function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", address: customer?.address ?? "", creditLimit: String(customer?.creditLimit ?? "0"), notes: customer?.notes ?? "", active: customer?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErrors({});
    try { await api(customer ? `/api/customers/${customer.id}` : "/api/customers", { method: customer ? "PUT" : "POST", body: f }); toast.success(customer ? "Customer updated" : "Customer added"); onSaved(); }
    catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={customer ? "Edit customer" : "Add customer"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="cust-form" loading={saving}>Save</Button></>}>
      <form id="cust-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *" error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required data-autofocus /></Field>
        <Field label="Phone" error={errors.phone}><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Credit limit" hint="Maximum udhaar allowed. 0 = no credit." error={errors.creditLimit}><Input type="number" min="0" step="0.01" value={f.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} /></Field>
        <div className="flex items-end"><Checkbox label="Active" checked={f.active} onChange={(e) => set("active", e.target.checked)} /></div>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

