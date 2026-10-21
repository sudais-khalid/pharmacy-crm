"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Pill, ShieldCheck } from "lucide-react";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { StaffLoginForm, REMEMBERED_PHARMACY } from "@/components/staff-login-form";

type Info = { slug: string; name: string; suspended: boolean };

/** Generic sign-in: asks for the pharmacy code once and remembers it on this device. */
function LoginInner() {
  const [pharmacy, setPharmacy] = useState<Info | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  // a new installation has no pharmacy yet: the Developer creates the first one in the console
  const [empty, setEmpty] = useState(false);

  async function lookup(slug: string) {
    const r = await fetch(`/api/auth/pharmacy/${encodeURIComponent(slug.trim().toLowerCase())}`);
    return r.ok ? ((await r.json()) as Info) : null;
  }

  useEffect(() => {
    fetch("/api/auth/setup-state").then((r) => r.json()).then((s: { hasPharmacies?: boolean }) => setEmpty(s.hasPharmacies === false)).catch(() => {});
  }, []);

  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(REMEMBERED_PHARMACY);
    } catch {
      // storage unavailable: ask every time
    }
    if (!remembered) return setChecking(false);
    lookup(remembered).then((info) => {
      setPharmacy(info);
      setChecking(false);
    });
  }, []);

  async function choose(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const info = await lookup(code);
    if (info) setPharmacy(info);
    else setError("No pharmacy with this code. Check the code you were given.");
  }

  function forget() {
    try {
      localStorage.removeItem(REMEMBERED_PHARMACY);
    } catch {
      // nothing remembered
    }
    setPharmacy(null);
  }

  if (checking) return <Spinner />;
  if (pharmacy) return <StaffLoginForm pharmacy={pharmacy} onChangePharmacy={forget} />;
  if (empty) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
        <Card className="w-full max-w-md p-6">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><Pill className="h-6 w-6" aria-hidden /></span>
            <h1 className="text-xl font-semibold">Pharmacy CRM is installed</h1>
            <p className="text-sm text-fg-muted">No pharmacy has been set up here yet, so there is no pharmacy code to sign in with.</p>
          </div>
          <ol className="mb-5 list-decimal space-y-1.5 pl-5 text-sm">
            <li>Sign in to the Developer console with the Developer account of this installation.</li>
            <li>Create the pharmacy. Its short name (for example <span className="font-mono">city-care</span>) is its pharmacy code.</li>
            <li>Staff then sign in here with that code and the account you give them.</li>
          </ol>
          <Link href="/platform/login" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary/90">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Open the Developer console
          </Link>
        </Card>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><Pill className="h-6 w-6" aria-hidden /></span>
          <h1 className="text-xl font-semibold">Pharmacy CRM</h1>
          <p className="text-sm text-fg-muted">Enter your pharmacy code to sign in</p>
        </div>
        <form onSubmit={choose} className="space-y-4" noValidate>
          <Field label="Pharmacy code" hint="The short name your administrator gave you, e.g. city-care">
            <Input autoCapitalize="none" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus className="font-mono" />
          </Field>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          <Button type="submit" className="w-full">Continue</Button>
        </form>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
