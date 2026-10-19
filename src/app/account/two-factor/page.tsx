"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/client";

type Status = {
  enabled: boolean; required: boolean; pending: "verify" | "enrol" | null; recoveryCodesLeft: number;
  enrolment?: { secret: string; uri: string; qrSvg: string };
};

/**
 * Two-factor sign-in for staff (task 3.4): enter a code after the password, set up an authenticator app
 * (when the pharmacy requires it or by choice), or turn it off.
 */
export default function TwoFactorPage() {
  const router = useRouter();
  const [start, setStart] = useState(false);
  const { data, error, reload } = useApi<Status>(`/api/auth/2fa${start ? "?start=1" : ""}`);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.pending === "enrol") setStart(true); }, [data?.pending]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setProblem("");
    try {
      await fn();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const home = () => { router.replace("/home"); router.refresh(); };

  if (error) return <Shell><p role="alert" className="text-sm text-danger">{error}</p></Shell>;
  if (!data) return <Spinner />;

  if (codes) {
    return (
      <Shell title="Save your recovery codes">
        <p className="text-sm text-fg-muted">If you lose your phone, each of these codes lets you sign in once. Write them down or print them now; they are shown only once.</p>
        <ul className="my-4 grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <li key={c} className="rounded border border-border px-2 py-1">{c}</li>)}</ul>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => window.print()}>Print</Button><Button onClick={home}>Continue</Button></div>
      </Shell>
    );
  }

  if (data.pending === "verify") {
    return (
      <Shell title="Enter your sign-in code">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/auth/2fa/verify", { body: useRecovery ? { recoveryCode: code } : { code } }); home(); }); }}>
          <Field label={useRecovery ? "Recovery code" : "Code from your authenticator app"} error={problem || undefined}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} required autoFocus />
          </Field>
          <Button type="submit" loading={busy} className="w-full">Continue</Button>
          <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Use the app code instead" : "Lost your phone? Use a recovery code"}</button>
        </form>
      </Shell>
    );
  }

  if (!data.enabled && (start || data.pending === "enrol")) {
    const e = data.enrolment;
    return (
      <Shell title="Set up two-factor sign-in">
        {data.required && <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Your pharmacy requires an authenticator code at every sign-in.</p>}
        {!e ? <Spinner /> : (
          <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); void run(async () => { const r = await api<{ recoveryCodes: string[] }>("/api/auth/2fa", { body: { code } }); setCodes(r.recoveryCodes); }); }}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
              <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or similar).</li>
              <li>Scan this code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="mx-auto w-[220px] rounded-lg bg-white p-2" role="img" aria-label="QR code for the authenticator app" dangerouslySetInnerHTML={{ __html: e.qrSvg }} />
            <p className="text-center font-mono text-sm">{e.secret}</p>
            <Field label="Code" error={problem || undefined}><Input value={code} onChange={(ev) => setCode(ev.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></Field>
            <Button type="submit" loading={busy} className="w-full">Turn on</Button>
          </form>
        )}
      </Shell>
    );
  }

  return (
    <Shell title="Two-factor sign-in">
      {data.enabled ? (
        <>
          <p className="text-sm">On. You have {data.recoveryCodesLeft} recovery code(s) left.</p>
          {!data.required && (
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/auth/2fa/disable", { body: { code } }); setCode(""); reload(); }); }}>
              <Field label="Code from your app, to turn it off" error={problem || undefined}><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required /></Field>
              <Button type="submit" variant="secondary" loading={busy}>Turn off</Button>
            </form>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-fg-muted">Off. With it on, signing in also needs a code from an app on your phone, so a stolen password is not enough.</p>
          <Button className="mt-4" onClick={() => setStart(true)}>Set it up</Button>
        </>
      )}
      <Button variant="ghost" className="mt-4" onClick={home}>Back to the app</Button>
    </Shell>
  );
}

function Shell({ title = "Two-factor sign-in", children }: { title?: string; children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" aria-hidden /><h1 className="text-lg font-semibold">{title}</h1></div>
        {children}
      </Card>
    </main>
  );
}
