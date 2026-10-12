"use client";
import { useEffect, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/client";

type S = { pharmacyName: string; address: string; phone: string; email: string; invoiceFooter: string; expiryWarningDays: number; currency: string };

export default function SettingsPage() {
  const toast = useToast();
  const { data, error, reload } = useApi<S>("/api/settings");
  const [f, setF] = useState<S | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!f) return <Spinner />;
  const set = (k: keyof S, v: string) => setF({ ...f, [k]: v });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErrors({});
    try { await api("/api/settings", { method: "PUT", body: f }); toast.success("Settings saved – reload the page to refresh the sidebar name."); }
    catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <>
      <PageHeader title="Settings" subtitle="Pharmacy details used on invoices, and inventory alerts." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Pharmacy</h2>
          <Field label="Pharmacy name" error={errors.pharmacyName} className="sm:col-span-2"><Input value={f.pharmacyName} onChange={(e) => set("pharmacyName", e.target.value)} required /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Invoice footer" className="sm:col-span-2"><Input value={f.invoiceFooter} onChange={(e) => set("invoiceFooter", e.target.value)} /></Field>
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Inventory & display</h2>
          <Field label="Expiry warning period (days)" error={errors.expiryWarningDays} hint="Used by the dashboard and the Expiry tab"><Input type="number" min="1" max="730" value={f.expiryWarningDays} onChange={(e) => set("expiryWarningDays", e.target.value)} /></Field>
          <Field label="Currency label" hint="Shown before amounts, e.g. PKR"><Input value={f.currency} onChange={(e) => set("currency", e.target.value)} required /></Field>
        </Card>
        <Button type="submit" loading={saving}>Save settings</Button>
      </form>
    </>
  );
}
