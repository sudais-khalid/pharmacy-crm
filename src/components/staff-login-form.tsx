"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pill } from "lucide-react";
import { Button, Card, Field, Input } from "./ui";
import { api } from "@/lib/client";

export const REMEMBERED_PHARMACY = "pcrm.pharmacy";

/** Staff sign-in. With `pharmacy` fixed (per-pharmacy page) only username and password are asked. */
export function StaffLoginForm({ pharmacy, onChangePharmacy }: { pharmacy: { slug: string; name: string; suspended?: boolean; hasLogo?: boolean }; onChangePharmacy?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await api<{ mustChangePassword: boolean; secondFactor: "verify" | "enrol" | null }>("/api/auth/login", { body: { pharmacy: pharmacy.slug, username, password } });
      try {
        localStorage.setItem(REMEMBERED_PHARMACY, pharmacy.slug);
      } catch {
        // storage can be unavailable (private mode); remembering is only a convenience
      }
      const next = params.get("next");
      // the code first; a temporary password is replaced next; then (if required) the authenticator is set up
      router.replace(r.secondFactor === "verify" ? "/account/two-factor" : r.mustChangePassword ? "/account/password" : r.secondFactor === "enrol" ? "/account/two-factor" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/home");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          {pharmacy.hasLogo
            ? /* eslint-disable-next-line @next/next/no-img-element -- a small logo from our own API */
              <img src={`/api/auth/pharmacy/${encodeURIComponent(pharmacy.slug)}/logo?size=icon`} alt="" className="h-12 w-12 rounded-xl object-contain" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><Pill className="h-6 w-6" aria-hidden /></span>}
          <h1 className="text-xl font-semibold">{pharmacy.name}</h1>
          <p className="text-sm text-fg-muted">Sign in to continue</p>
        </div>
        {pharmacy.suspended && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">This pharmacy&apos;s account is suspended. Contact your software provider.</p>}
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Username"><Input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        </form>
        <ForgotPassword slug={pharmacy.slug} username={username} />
        {onChangePharmacy && (
          <button type="button" onClick={onChangePharmacy} className="mt-4 w-full text-center text-sm text-primary hover:underline">Not {pharmacy.name}? Change pharmacy</button>
        )}
      </Card>
    </main>
  );
}

/** "Forgot password?": tells the pharmacy's admins, who send a reset link or a temporary password (task 3.5). */
function ForgotPassword({ slug, username }: { slug: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(username);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" onClick={() => { setName(username); setOpen(true); }} className="mt-3 w-full text-center text-sm text-primary hover:underline">Forgot password?</button>;
  return (
    <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        setAnswer((await api<{ message: string }>("/api/auth/forgot", { body: { pharmacy: slug, username: name } })).message);
      } catch (err) {
        setAnswer((err as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      {answer ? <p role="status" className="text-sm">{answer}</p> : <>
        <p className="text-sm text-fg-muted">Your pharmacy&apos;s admin will be told and can give you a new way to sign in.</p>
        <Field label="Your username"><Input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" required /></Field>
        <Button type="submit" variant="secondary" className="w-full" loading={busy}>Tell my admin</Button>
      </>}
    </form>
  );
}
