"use client";
import { Suspense, useEffect, useState } from "react";
import { Pill } from "lucide-react";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { StaffLoginForm, REMEMBERED_PHARMACY } from "@/components/staff-login-form";

type Info = { slug: string; name: string; suspended: boolean };

/** Generic sign-in: asks for the pharmacy code once and remembers it on this device. */
function LoginInner() {
  const [pharmacy, setPharmacy] = useState<Info | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function lookup(slug: string) {
    const r = await fetch(`/api/auth/pharmacy/${encodeURIComponent(slug.trim().toLowerCase())}`);
    return r.ok ? ((await r.json()) as Info) : null;
  }

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
