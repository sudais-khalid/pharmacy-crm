"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pill } from "lucide-react";
import { Button, Card, Field, Input } from "./ui";
import { api } from "@/lib/client";

export const REMEMBERED_PHARMACY = "pcrm.pharmacy";

/** Staff sign-in. With `pharmacy` fixed (per-pharmacy page) only username and password are asked. */
export function StaffLoginForm({ pharmacy, onChangePharmacy }: { pharmacy: { slug: string; name: string; suspended?: boolean }; onChangePharmacy?: () => void }) {
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
      const r = await api<{ mustChangePassword: boolean }>("/api/auth/login", { body: { pharmacy: pharmacy.slug, username, password } });
      try {
        localStorage.setItem(REMEMBERED_PHARMACY, pharmacy.slug);
      } catch {
        // storage can be unavailable (private mode); remembering is only a convenience
      }
      const next = params.get("next");
      router.replace(r.mustChangePassword ? "/account/password" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/home");
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
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary"><Pill className="h-6 w-6" aria-hidden /></span>
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
        {onChangePharmacy && (
          <button type="button" onClick={onChangePharmacy} className="mt-4 w-full text-center text-sm text-primary hover:underline">Not {pharmacy.name}? Change pharmacy</button>
        )}
      </Card>
    </main>
  );
}
