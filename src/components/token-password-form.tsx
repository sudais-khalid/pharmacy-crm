"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button, Card, Field, Input, Spinner } from "./ui";
import { api } from "@/lib/client";

type Info = { valid: true; purpose: "INVITE" | "RESET"; name: string; username: string; pharmacy: { name: string; slug: string } } | { valid: false; problem: string };

/** Choose a password from an invite or reset link. */
export function TokenPasswordForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ pharmacySlug: string; username: string } | null>(null);

  useEffect(() => {
    api<Info>(`/api/auth/token/${encodeURIComponent(token)}`).then(setInfo).catch((e: Error) => setInfo({ valid: false, problem: e.message }));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError("");
    try {
      setDone(await api(`/api/auth/token/${encodeURIComponent(token)}`, { body: { password } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><KeyRound className="h-6 w-6" aria-hidden /></span>
          <h1 className="text-xl font-semibold">{info?.valid && info.purpose === "RESET" ? "Reset your password" : "Set your password"}</h1>
        </div>
        {!info && <Spinner />}
        {info && !info.valid && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{info.problem}</p>}
        {info?.valid && !done && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm text-fg-muted">
              {info.name}, choose a password for <strong className="text-fg">{info.pharmacy.name}</strong>. You will sign in with the username <strong className="font-mono text-fg">{info.username}</strong>.
            </p>
            <Field label="New password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field>
            <Field label="Repeat the password"><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <Button type="submit" className="w-full" loading={busy}>Save password</Button>
          </form>
        )}
        {done && (
          <div className="space-y-4 text-center">
            <p className="flex items-center justify-center gap-2 text-sm text-success"><CheckCircle2 className="h-5 w-5" aria-hidden /> Password saved.</p>
            <Link href={`/p/${done.pharmacySlug}/login`} className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary/90">Go to sign in</Link>
          </div>
        )}
      </Card>
    </main>
  );
}
