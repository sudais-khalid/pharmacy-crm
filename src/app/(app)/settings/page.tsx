"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Checkbox, ErrorBox, Field, Input, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { useCan } from "@/components/app-context";
import { ApiError, api, downloadPost, useApi } from "@/lib/client";

type S = {
  expiryWarningDays: number; expiryAlertDays: number; currency: string; ocrProvider: string;
  receiptFormat: string; autoPrintReceipt: boolean; receiptBatchLines: boolean; requireCashSession: boolean; cashDiffThreshold: number;
};
type Loaded = S & { ocrProviders: string[]; ocrMonthlyLimit: number; ocrUsedThisMonth: number; cashSessionsOn: boolean };
const pickS = (d: Loaded): S => ({
  expiryWarningDays: d.expiryWarningDays, expiryAlertDays: d.expiryAlertDays, currency: d.currency, ocrProvider: d.ocrProvider, receiptFormat: d.receiptFormat, autoPrintReceipt: d.autoPrintReceipt,
  receiptBatchLines: d.receiptBatchLines, requireCashSession: d.requireCashSession, cashDiffThreshold: d.cashDiffThreshold,
});

/** Operational settings. The pharmacy's name, contacts, logo and receipt texts are on Profile & branding. */
export default function SettingsPage() {
  const toast = useToast();
  const canBrand = useCan("branding.manage");
  const canExport = useCan("data.export");
  const { data, error, reload } = useApi<Loaded>("/api/settings");
  const [f, setF] = useState<S | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF(pickS(data)); }, [data]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!f || !data) return <Spinner />;

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
      <PageHeader title="Settings" subtitle="Inventory alerts, receipts, the cash drawer, how amounts are shown and how bill photos are read." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Expiry warning period (days)" error={errors.expiryWarningDays} hint="Used by the dashboard and the Expiry tab">
            <Input type="number" min="1" max="730" value={f.expiryWarningDays} onChange={(e) => setF({ ...f, expiryWarningDays: Number(e.target.value) })} />
          </Field>
          <Field label="Expiry alert (days before)" error={errors.expiryAlertDays} hint="A notification when a batch in stock gets this close to expiry, again at 7 days and on expiry">
            <Input type="number" min="1" max="365" value={f.expiryAlertDays} onChange={(e) => setF({ ...f, expiryAlertDays: Number(e.target.value) })} />
          </Field>
          <Field label="Currency label" hint="Shown before amounts, e.g. PKR" error={errors.currency}>
            <Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} required maxLength={8} />
          </Field>
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Receipts</h2>
          <Field label="Receipt printer" hint="Reprints keep the format used at the sale">
            <Select value={f.receiptFormat} onChange={(e) => setF({ ...f, receiptFormat: e.target.value })}>
              <option value="THERMAL_80">80 mm thermal roll</option><option value="THERMAL_58">58 mm thermal roll</option><option value="A4">A4 page</option>
            </Select>
          </Field>
          <div className="space-y-2 pt-6">
            <Checkbox label="Print the receipt as soon as a sale is completed" checked={f.autoPrintReceipt} onChange={(e) => setF({ ...f, autoPrintReceipt: e.target.checked })} />
            <Checkbox label="Print batch and expiry under each line" checked={f.receiptBatchLines} onChange={(e) => setF({ ...f, receiptBatchLines: e.target.checked })} />
          </div>
        </Card>
        {data.cashSessionsOn && (
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Cash drawer</h2>
            <div className="pt-1"><Checkbox label="No cash sales without an open drawer" checked={f.requireCashSession} onChange={(e) => setF({ ...f, requireCashSession: e.target.checked })} /></div>
            <Field label="Difference that needs a note at closing" error={errors.cashDiffThreshold}>
              <Input type="number" min="0" step="1" value={f.cashDiffThreshold} onChange={(e) => setF({ ...f, cashDiffThreshold: Number(e.target.value) })} />
            </Field>
          </Card>
        )}
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="font-semibold">Reading bill photos</h2>
            <p className="text-sm text-fg-muted">{data.ocrUsedThisMonth} of {data.ocrMonthlyLimit} photo pages used this month.</p>
          </div>
          {data.ocrProviders.length > 1 ? (
            <fieldset className="space-y-2 text-sm">
              <legend className="sr-only">Photo reader</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="ocr" className="mt-1" checked={f.ocrProvider === "LOCAL"} onChange={() => setF({ ...f, ocrProvider: "LOCAL" })} />
                <span><b>On this computer.</b> Photos never leave your pharmacy. Best on clear printed bills.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="ocr" className="mt-1" checked={f.ocrProvider === "CLOUD"} onChange={() => setF({ ...f, ocrProvider: "CLOUD" })} />
                <span><b>Cloud reader.</b> Reads handwriting and poor photos better. Photos are sent to an outside service (Anthropic) to be read.</span>
              </label>
            </fieldset>
          ) : (
            <p className="text-sm">Photos are read {data.ocrProviders[0] === "CLOUD" ? "by the cloud reader" : "on this computer and never leave your pharmacy"}.</p>
          )}
        </Card>
        <div className="flex items-center gap-4">
          <Button type="submit" loading={saving}>Save settings</Button>
          {canBrand && <Link href="/branding" className="text-sm text-primary hover:underline">Name, contacts, logo and receipt texts are on Profile &amp; branding</Link>}
          <Link href="/setup" className="text-sm text-primary hover:underline">Setup checklist</Link>
        </div>
      </form>
      {canExport && <DataExport />}
    </>
  );
}

/** All of the pharmacy's records as a ZIP of CSV files with an Excel summary (roadmap 9.4). */
function DataExport() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await downloadPost("/api/settings/export", {}, "pharmacy-data.zip");
      toast.success("Your data is downloading");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mt-6 max-w-3xl space-y-3 p-5">
      <div>
        <h2 className="font-semibold">Your data</h2>
        <p className="text-sm text-fg-muted">Download every record of this pharmacy: an Excel summary of medicines, customers and suppliers, and a CSV file for each kind of record. Passwords are never included. The download is recorded in the activity history.</p>
      </div>
      <Button variant="secondary" loading={busy} onClick={run}>Download all data (ZIP)</Button>
    </Card>
  );
}
