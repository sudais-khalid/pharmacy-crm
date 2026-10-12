"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { api } from "@/lib/client";

type Step = "loading" | "password" | "enrol" | "verify" | "codes";
type Enrolment = { secret: string; qrSvg: string };

/** Developer sign-in: password, then two-factor set-up (first time) or code entry. */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(next: string) {
    setError("");
    setCode("");
    if (next === "done") {
      router.replace("/platform");
      router.refresh();
      return;
    }
    if (next === "enrol") setEnrolment(await api<Enrolment>("/api/platform/auth/enrol"));
    setStep(next as Step);
  }

  useEffect(() => {
    api<{ step: string }>("/api/platform/auth/me")
      .then((r) => go(r.step))
      .catch(() => setStep("password"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => go((await api<{ next: string }>("/api/platform/auth/login", { body: { email, password } })).next));
  };
  const submitEnrol = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ recoveryCodes: string[] }>("/api/platform/auth/enrol", { body: { code } });
      setRecoveryCodes(r.recoveryCodes);
      setStep("codes");
    });
  };
  const submitVerify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/api/platform/auth/verify", { body: useRecovery ? { recoveryCode: code } : { code } });
      await go("done");
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-white dark:bg-slate-700"><ShieldCheck className="h-6 w-6" aria-hidden /></span>
          <h1 className="text-xl font-semibold">Developer console</h1>
          <p className="text-sm text-fg-muted">Platform administration for all pharmacies</p>
        </div>

        {step === "loading" && <Spinner />}

        {step === "password" && (
          <form onSubmit={submitPassword} className="space-y-4" noValidate>
            <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <Button type="submit" className="w-full" loading={busy}>Continue</Button>
          </form>
        )}

        {step === "enrol" && enrolment && (
          <form onSubmit={submitEnrol} className="space-y-4" noValidate>
            <p className="text-sm">Two-factor sign-in is required for the Developer account. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code it shows.</p>
            {/* SVG generated on the server by the qrcode library from our own otpauth link */}
            <div className="mx-auto w-[220px] rounded-lg bg-white p-2" aria-label="QR code for the authenticator app" role="img" dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }} />
            <p className="text-center text-xs text-fg-muted">Cannot scan? Enter this key: <span className="font-mono text-fg">{enrolment.secret}</span></p>
            <Field label="Code from the app"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <Button type="submit" className="w-full" loading={busy}>Turn on two-factor sign-in</Button>
          </form>
        )}

        {step === "codes" && (
          <div className="space-y-4">
            <p className="text-sm"><strong>Save these recovery codes now.</strong> Each one signs you in once if you lose your phone. They will not be shown again.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
              {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <Button className="w-full" onClick={() => go("done")}>I have saved them, continue</Button>
          </div>
        )}

        {step === "verify" && (
          <form onSubmit={submitVerify} className="space-y-4" noValidate>
            <Field label={useRecovery ? "Recovery code" : "Code from your authenticator app"}>
              <Input
                inputMode={useRecovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={useRecovery ? 11 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
            </Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <Button type="submit" className="w-full" loading={busy}><KeyRound className="h-4 w-4" aria-hidden /> Sign in</Button>
            <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(""); }}>
              {useRecovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
