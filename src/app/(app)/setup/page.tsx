"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Circle, FileSpreadsheet, Keyboard, Plus, Trash2 } from "lucide-react";
import { Button, Card, ErrorBox, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { api, ApiError, useApi } from "@/lib/client";

type Status = {
  done: boolean;
  steps: {
    profile: { done: boolean; logo: boolean }; receipt: { done: boolean; format: string }; staff: { done: boolean; count: number };
    stock: { done: boolean; batches: number }; customers: { done: boolean; count: number; owed: number }; suppliers: { done: boolean; count: number; owing: number };
  };
};
const FORMAT: Record<string, string> = { THERMAL_80: "80 mm receipt printer", THERMAL_58: "58 mm receipt printer", A4: "A4 page" };

/** First-run setup (roadmap 9.9): the steps a new pharmacy goes through before its first day on the app. */
export default function SetupPage() {
  const { data, error, loading, reload } = useApi<Status>("/api/setup");
  const money = useMoney();
  const toast = useToast();
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const s = data.steps;
  async function finish() {
    setFinishing(true);
    try {
      await api("/api/setup/done", { body: {} });
      toast.success("Setup finished. You can come back to these steps from Settings.");
      router.push("/dashboard");
    } catch (err) { toast.error((err as Error).message); } finally { setFinishing(false); }
  }
  return (
    <>
      <PageHeader title="Set up your pharmacy" subtitle="Six steps before the first day at the counter. Each one can be done later too." />
      <ol className="max-w-4xl space-y-4">
        <Step n={1} done={s.profile.done} title="Profile and logo" text={s.profile.done ? `Address and phone are set${s.profile.logo ? ", with your logo" : "; a logo is optional"}. They print on every receipt.` : "Add the address and phone that print on receipts, and your logo."}>
          <Link href="/branding" className="btn-link">Open Profile and branding</Link>
        </Step>
        <Step n={2} done={s.receipt.done} title="Receipt format" text={`Receipts print on: ${FORMAT[s.receipt.format] ?? s.receipt.format}. Change it if your printer is different.`}>
          <Link href="/settings" className="btn-link">Open Settings</Link>
        </Step>
        <Step n={3} done={s.staff.done} title="Staff" text={s.staff.done ? `${s.staff.count} staff accounts.` : "Add your pharmacists and cashiers, each with their own sign-in."}>
          <Link href="/users" className="btn-link">Open Users</Link>
        </Step>
        <Step n={4} done={s.stock.done} title="Opening stock" text={s.stock.done ? `${s.stock.batches} batches in stock.` : "What is on your shelves today. A photo of your stock register is often quickest; you check every line before it counts."}>
          <div className="flex flex-wrap gap-2">
            <Link href="/stock-entry/upload?kind=STOCK_LIST" className="btn-link"><Camera className="h-4 w-4" aria-hidden /> Photo of a stock list</Link>
            <Link href="/stock-entry/import" className="btn-link"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel or CSV file</Link>
            <Link href="/stock-entry" className="btn-link"><Keyboard className="h-4 w-4" aria-hidden /> Type it in</Link>
          </div>
        </Step>
        <Step n={5} done={s.customers.done} title="Customers who owe you" text={s.customers.done ? `${s.customers.count} customers, owing ${money(s.customers.owed)} in all.` : "Customers on credit (udhaar) and what each owes today, so their accounts start right."}>
          <BalanceGrid kind="customers" onSaved={reload} />
        </Step>
        <Step n={6} done={s.suppliers.done} title="What you owe suppliers" text={s.suppliers.done ? `${s.suppliers.count} suppliers, owed ${money(s.suppliers.owing)} in all.` : "Your distributors and what you owe each one today."}>
          <BalanceGrid kind="suppliers" onSaved={reload} />
        </Step>
      </ol>
      <div className="mt-6 flex max-w-4xl flex-wrap items-center gap-3">
        <Button onClick={finish} loading={finishing}>{Object.values(s).every((x) => x.done) ? "Finish setup" : "Finish for now"}</Button>
        <span className="text-sm text-fg-muted">The dashboard stops offering setup once you finish. Every step stays available from its own screen.</span>
      </div>
    </>
  );
}

function Step({ n, done, title, text, children }: { n: number; done: boolean; title: string; text: string; children: React.ReactNode }) {
  return (
    <li>
      <Card className="flex gap-4 p-5">
        <span className={done ? "text-success" : "text-fg-muted"} aria-hidden>{done ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6" />}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div><h2 className="font-semibold">{n}. {title} <span className="sr-only">{done ? "(done)" : "(to do)"}</span></h2><p className="text-sm text-fg-muted">{text}</p></div>
          {children}
        </div>
      </Card>
    </li>
  );
}

type Row = { name: string; phone: string; amount: string };
const blank = (): Row => ({ name: "", phone: "", amount: "" });

/** A few rows typed at once: name, phone and the balance today. */
function BalanceGrid({ kind, onSaved }: { kind: "customers" | "suppliers"; onSaved: () => void }) {
  const toast = useToast();
  const allowed = useCan("settings.manage");
  const [rows, setRows] = useState<Row[]>([blank(), blank(), blank()]);
  const [saving, setSaving] = useState(false);
  if (!allowed) return null;
  const filled = rows.filter((r) => r.name.trim());
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    setSaving(true);
    try {
      const r = await api<{ created: number; skipped: string[] }>(`/api/${kind}/import`, { body: { rows: filled.map((x) => ({ name: x.name, phone: x.phone || null, openingBalance: Number(x.amount) || 0 })) } });
      toast.success(`${r.created} ${kind} added${r.skipped.length ? `; already there: ${r.skipped.join(", ")}` : ""}`);
      setRows([blank(), blank(), blank()]);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError && err.fields ? Object.values(err.fields)[0] : (err as Error).message);
    } finally { setSaving(false); }
  }
  const label = kind === "customers" ? "Owes you" : "You owe";
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr><th className="th">Name</th><th className="th">Phone</th><th className="th text-right">{label}</th><th className="th"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><Input aria-label={`Name, row ${i + 1}`} value={r.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td className="py-1 pr-2"><Input aria-label={`Phone, row ${i + 1}`} inputMode="tel" value={r.phone} maxLength={30} onChange={(e) => set(i, { phone: e.target.value })} /></td>
              <td className="py-1 pr-2"><Input aria-label={`${label}, row ${i + 1}`} type="number" inputMode="decimal" min="0" step="0.01" className="text-right" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></td>
              <td className="py-1"><button type="button" className="rounded p-1.5 text-fg-muted hover:bg-muted" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blank()])}><Trash2 className="h-4 w-4" /></button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setRows([...rows, blank(), blank()])}><Plus className="h-4 w-4" aria-hidden /> More rows</Button>
        <Button size="sm" onClick={save} loading={saving} disabled={!filled.length}>Save {filled.length || ""} {kind}</Button>
        <Link href={`/${kind}`} className="btn-link">Open {kind === "customers" ? "Customers" : "Suppliers"}</Link>
      </div>
    </div>
  );
}
