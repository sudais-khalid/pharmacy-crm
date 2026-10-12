"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Button, Card, Checkbox, Field, Input, PageHeader, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";

const FEATURES = [
  { key: "ocr", label: "OCR stock entry from photos", on: true },
  { key: "purchaseOrders", label: "Purchase orders to suppliers", on: true },
  { key: "returns", label: "Customer and supplier returns", on: true },
  { key: "expenses", label: "Expenses and net profit", on: true },
  { key: "cashSessions", label: "Cash drawer sessions", on: false },
];

type Result = {
  pharmacy: { id: string; slug: string; name: string };
  admin: { username: string; name: string };
  credentials: { kind: "invite"; path: string; expiresAt: string } | { kind: "password"; password: string };
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function NewPharmacyPage() {
  const toast = useToast();
  const [f, setF] = useState({ name: "", slug: "", city: "", phone: "", email: "", address: "", licenseNumber: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState({ plan: "STANDARD", maxUsers: "10", ocrMonthlyLimit: "300", subscriptionEndsAt: "" });
  const [features, setFeatures] = useState(new Set(FEATURES.filter((x) => x.on).map((x) => x.key)));
  const [admin, setAdmin] = useState({ name: "", username: "admin", email: "" });
  const [credentials, setCredentials] = useState<"invite" | "password">("invite");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const setName = (name: string) => setF((s) => ({ ...s, name, slug: slugTouched ? s.slug : slugify(name) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      setResult(await api<Result>("/api/platform/pharmacies", { body: { pharmacy: f, plan, features: [...features], admin, credentials } }));
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (result) return <CreatedPanel result={result} />;

  return (
    <>
      <PageHeader title="New pharmacy" subtitle="Creates the pharmacy and its first Pharmacy Admin" />
      <form onSubmit={submit} className="space-y-6" noValidate>
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Pharmacy</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *" error={errors["pharmacy.name"]}><Input value={f.name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
            <Field label="URL name *" hint={`Sign-in page: /p/${f.slug || "name"}/login`} error={errors["pharmacy.slug"]}>
              <Input value={f.slug} onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: slugify(e.target.value) })); }} required className="font-mono" />
            </Field>
            <Field label="City"><Input value={f.city} onChange={(e) => setF((s) => ({ ...s, city: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} /></Field>
            <Field label="Email" error={errors["pharmacy.email"]}><Input type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} /></Field>
            <Field label="Drug sale licence number"><Input value={f.licenseNumber} onChange={(e) => setF((s) => ({ ...s, licenseNumber: e.target.value }))} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF((s) => ({ ...s, address: e.target.value }))} /></Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Plan and features</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Plan"><Input value={plan.plan} onChange={(e) => setPlan((s) => ({ ...s, plan: e.target.value }))} /></Field>
            <Field label="Max staff" error={errors["plan.maxUsers"]}><Input type="number" min={1} value={plan.maxUsers} onChange={(e) => setPlan((s) => ({ ...s, maxUsers: e.target.value }))} /></Field>
            <Field label="OCR pages per month"><Input type="number" min={0} value={plan.ocrMonthlyLimit} onChange={(e) => setPlan((s) => ({ ...s, ocrMonthlyLimit: e.target.value }))} /></Field>
            <Field label="Subscription ends"><Input type="date" value={plan.subscriptionEndsAt} onChange={(e) => setPlan((s) => ({ ...s, subscriptionEndsAt: e.target.value }))} /></Field>
          </div>
          <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Features</legend>
            {FEATURES.map((x) => (
              <Checkbox key={x.key} label={x.label} checked={features.has(x.key)}
                onChange={(e) => setFeatures((s) => { const n = new Set(s); if (e.target.checked) n.add(x.key); else n.delete(x.key); return n; })} />
            ))}
          </fieldset>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold">First Pharmacy Admin</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name *" error={errors["admin.name"]}><Input value={admin.name} onChange={(e) => setAdmin((s) => ({ ...s, name: e.target.value }))} required /></Field>
            <Field label="Username *" error={errors["admin.username"]}><Input value={admin.username} onChange={(e) => setAdmin((s) => ({ ...s, username: e.target.value.toLowerCase() }))} required className="font-mono" /></Field>
            <Field label="Email *" error={errors["admin.email"]}><Input type="email" value={admin.email} onChange={(e) => setAdmin((s) => ({ ...s, email: e.target.value }))} required /></Field>
          </div>
          <fieldset className="mt-4 space-y-2">
            <legend className="mb-2 text-sm font-medium">How the admin gets in</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="cred" className="mt-1" checked={credentials === "invite"} onChange={() => setCredentials("invite")} />
              <span><strong>Invite link</strong> (recommended): the admin chooses their own password. Valid 72 hours, single use.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="cred" className="mt-1" checked={credentials === "password"} onChange={() => setCredentials("password")} />
              <span><strong>Temporary password</strong>: shown once now; the admin must change it at first sign-in.</span>
            </label>
          </fieldset>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/platform/pharmacies" className="inline-flex items-center rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium hover:bg-muted dark:border-slate-700">Cancel</Link>
          <Button type="submit" loading={saving}>Create pharmacy</Button>
        </div>
      </form>
    </>
  );
}

/** Shown once after creation. The secret part cannot be retrieved again. */
function CreatedPanel({ result }: { result: Result }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const loginUrl = `${origin}/login`;
  const secret = result.credentials.kind === "invite" ? `${origin}${result.credentials.path}` : result.credentials.password;
  const message =
    result.credentials.kind === "invite"
      ? `Hello ${result.admin.name}. Your Pharmacy CRM account for ${result.pharmacy.name} is ready. Open this link to choose your password (valid 72 hours): ${secret}`
      : `Hello ${result.admin.name}. Your Pharmacy CRM account for ${result.pharmacy.name} is ready. Sign in at ${loginUrl} with username ${result.admin.username} and temporary password ${secret}. You will be asked to choose a new password.`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
  };
  return (
    <>
      <PageHeader title={`${result.pharmacy.name} created`} subtitle="Share the sign-in details with the Pharmacy Admin now" />
      <Card className="space-y-4 p-5">
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This {result.credentials.kind === "invite" ? "invite link" : "temporary password"} is shown only once. Copy or share it before leaving this page.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-fg-muted">Sign-in page</dt><dd className="break-all font-mono">{loginUrl}</dd>
          <dt className="text-fg-muted">Username</dt><dd className="font-mono">{result.admin.username}</dd>
          <dt className="text-fg-muted">{result.credentials.kind === "invite" ? "Invite link" : "Temporary password"}</dt>
          <dd className="break-all font-mono text-base font-semibold">{secret}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy message"}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium hover:bg-muted dark:border-slate-700">
            <MessageCircle className="h-4 w-4" aria-hidden /> Share on WhatsApp
          </a>
          <Link href={`/platform/pharmacies/${result.pharmacy.id}`} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-primary hover:underline">Open the pharmacy</Link>
        </div>
      </Card>
    </>
  );
}
