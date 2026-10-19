"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { useCan } from "@/components/app-context";
import { ApiError, api, useApi } from "@/lib/client";

type S = { expiryWarningDays: number; currency: string };

/** Operational settings. The pharmacy's name, contacts, logo and receipt texts are on Profile & branding. */
export default function SettingsPage() {
  const toast = useToast();
  const canBrand = useCan("branding.manage");
  const { data, error, reload } = useApi<S>("/api/settings");
  const [f, setF] = useState<S | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF({ expiryWarningDays: data.expiryWarningDays, currency: data.currency }); }, [data]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!f) return <Spinner />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api("/api/settings", { method: "PUT", body: f });
      toast.success("Settings saved");
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Inventory alerts and how amounts are shown." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Expiry warning period (days)" error={errors.expiryWarningDays} hint="Used by the dashboard and the Expiry tab">
            <Input type="number" min="1" max="730" value={f.expiryWarningDays} onChange={(e) => setF({ ...f, expiryWarningDays: Number(e.target.value) })} />
          </Field>
          <Field label="Currency label" hint="Shown before amounts, e.g. PKR" error={errors.currency}>
            <Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} required maxLength={8} />
          </Field>
        </Card>
        <div className="flex items-center gap-4">
          <Button type="submit" loading={saving}>Save settings</Button>
          {canBrand && <Link href="/branding" className="text-sm text-primary hover:underline">Name, contacts, logo and receipt texts are on Profile &amp; branding</Link>}
        </div>
      </form>
    </>
  );
}
