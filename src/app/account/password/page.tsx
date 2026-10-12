"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

/** Shown after signing in with a temporary password, and available to change it any time. */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("The two new passwords do not match.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password", { body: { currentPassword: current, newPassword: next } });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><KeyRound className="h-6 w-6" aria-hidden /></span>
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm text-fg-muted">Replace the temporary password you were given.</p>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus /></Field>
          <Field label="New password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <Field label="Repeat the new password"><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>Save password</Button>
        </form>
      </Card>
    </main>
  );
}
