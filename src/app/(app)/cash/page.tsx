"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, CreditCard, Lock, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, StatCard, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useApp, useCan, useMoney } from "@/components/app-context";
import { api, formatDateTime, qs, useApi } from "@/lib/client";

type Summary = { openingFloat: number; cashSales: number; cardSales: number; creditSales: number; salesCount: number; cashRefunds: number; payIns: number; payOuts: number; expectedCash: number };
type Mine = { enabled: boolean; required: boolean; session: { id: string; openedAt: string; openingFloat: string; summary: Summary } | null };
type Row = { id: string; openedAt: string; closedAt: string | null; status: "OPEN" | "CLOSED"; openingFloat: string; expectedCash: string | number; countedCash: string | null; difference: string | null; note: string | null; user: { name: string } };

/** The cash drawer (roadmap 5.3): open with a float, pay in and out, count and close. Managers see every drawer. */
export default function CashPage() {
  const money = useMoney();
  const toast = useToast();
  const { settings } = useApp();
  const seesAll = useCan("cash.manage");
  const mine = useApi<Mine>("/api/cash");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const list = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(`/api/cash/sessions?${qs({ status, page })}`);
  const [dialog, setDialog] = useState<"open" | "PAY_IN" | "PAY_OUT" | "close" | null>(null);
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (mine.error) return <ErrorBox message={mine.error} onRetry={mine.reload} />;
  if (!mine.data) return <Spinner />;
  const m = mine.data;
  const s = m.session;
  const reloadAll = () => { mine.reload(); list.reload(); };
  const counted = Number(amount || 0);
  const diff = s ? Math.round((counted - s.summary.expectedCash) * 100) / 100 : 0;

  async function act() {
    setBusy(true);
    try {
      if (dialog === "open") await api("/api/cash", { body: { openingFloat: Number(amount) || 0 } });
      else if (dialog === "PAY_IN" || dialog === "PAY_OUT") await api(`/api/cash/${s!.id}/movement`, { body: { type: dialog, amount: Number(amount), reason: text } });
      else if (dialog === "close") await api(`/api/cash/${s!.id}/close`, { body: { countedCash: counted, note: text || null } });
      toast.success(dialog === "open" ? "Drawer opened" : dialog === "close" ? "Drawer closed" : dialog === "PAY_IN" ? "Pay-in recorded" : "Pay-out recorded");
      setDialog(null); setAmount(""); setText("");
      reloadAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!m.enabled) {
    return (
      <>
        <PageHeader title="Cash drawer" />
        <Card><EmptyState title="Cash drawer sessions are off" hint="Your software provider can switch them on for this pharmacy. Sales work as usual without them." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Cash drawer" subtitle="Count the float in, record cash taken out or put in, and count it again at the end of your shift."
        actions={s ? <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog("PAY_IN")}><ArrowDownToLine className="h-4 w-4" aria-hidden /> Pay in</Button>
          <Button variant="secondary" onClick={() => setDialog("PAY_OUT")}><ArrowUpFromLine className="h-4 w-4" aria-hidden /> Pay out</Button>
          <Button onClick={() => setDialog("close")}><Lock className="h-4 w-4" aria-hidden /> Count and close</Button>
        </div> : <Button onClick={() => setDialog("open")}><Wallet className="h-4 w-4" aria-hidden /> Open my drawer</Button>} />

      {s ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Wallet className="h-5 w-5" />} tone="green" label="Should be in the drawer" value={money(s.summary.expectedCash)} hint={`Opened ${formatDateTime(s.openedAt)}`} />
          <StatCard icon={<Banknote className="h-5 w-5" />} label="Cash taken on sales" value={money(s.summary.cashSales)} hint={`${s.summary.salesCount} sale${s.summary.salesCount === 1 ? "" : "s"}, float ${money(s.summary.openingFloat)}`} />
          <StatCard icon={<CreditCard className="h-5 w-5" />} label="Card and credit" value={money(s.summary.cardSales + s.summary.creditSales)} hint={`Card ${money(s.summary.cardSales)}, on account ${money(s.summary.creditSales)}`} />
          <StatCard icon={<ArrowLeftRight className="h-5 w-5" />} label="Paid in and out" value={money(s.summary.payIns - s.summary.payOuts - s.summary.cashRefunds)} hint={`In ${money(s.summary.payIns)}, out ${money(s.summary.payOuts)}, refunds ${money(s.summary.cashRefunds)}`} />
        </div>
      ) : <Card className="p-4 text-sm text-fg-muted">Your drawer is closed.{m.required ? " Open it before taking cash at the counter." : ""}</Card>}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="font-semibold">{seesAll ? "All drawers" : "Your drawers"}</h2>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">Open and closed</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></Select>
        </div>
        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data ? <TableSkeleton /> : !list.data.items.length ? <EmptyState title="No drawer sessions yet" /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">Opened</th><th className="th">Cashier</th><th className="th">Closed</th><th className="th text-right">Float</th><th className="th text-right">Expected</th><th className="th text-right">Counted</th><th className="th text-right">Difference</th></tr></thead>
              <tbody>{list.data.items.map((r) => {
                const d = r.difference === null ? null : Number(r.difference);
                return (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="td whitespace-nowrap"><Link className="text-primary hover:underline" href={`/cash/${r.id}`}>{formatDateTime(r.openedAt)}</Link></td>
                    <td className="td">{r.user.name}</td>
                    <td className="td whitespace-nowrap">{r.status === "OPEN" ? <Badge tone="green">Open</Badge> : formatDateTime(r.closedAt!)}</td>
                    <td className="td text-right">{money(r.openingFloat)}</td>
                    <td className="td text-right">{money(r.expectedCash)}</td>
                    <td className="td text-right">{r.countedCash === null ? "" : money(r.countedCash)}</td>
                    <td className="td text-right">{d === null ? "" : d === 0 ? "0" : <Badge tone={Math.abs(d) > settings.cashDiffThreshold ? "red" : "amber"}>{d > 0 ? "+" : ""}{money(d)}</Badge>}</td>
                  </tr>
                );
              })}</tbody>
            </TableWrap>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!dialog} onClose={() => setDialog(null)}
        title={dialog === "open" ? "Open my drawer" : dialog === "close" ? "Count and close" : dialog === "PAY_IN" ? "Pay cash in" : "Pay cash out"}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Back</Button><Button loading={busy} onClick={act}>{dialog === "close" ? "Close drawer" : "Save"}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void act(); }} className="space-y-3">
          <Field label={dialog === "open" ? "Cash in the drawer now" : dialog === "close" ? "Cash counted in the drawer" : "Amount"}>
            <Input data-autofocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {dialog === "close" && s && amount !== "" && (
            <p className={diff === 0 ? "text-sm text-success" : Math.abs(diff) > settings.cashDiffThreshold ? "text-sm font-medium text-danger" : "text-sm text-warning"}>
              Expected {money(s.summary.expectedCash)}. {diff === 0 ? "The drawer balances." : `${diff < 0 ? "Short" : "Over"} by ${money(Math.abs(diff))}${Math.abs(diff) > settings.cashDiffThreshold ? ": add a note." : "."}`}
            </p>
          )}
          {dialog !== "open" && (
            <Field label={dialog === "close" ? "Note (needed for a large difference)" : "Reason"}>
              <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={dialog === "close" ? 500 : 200} placeholder={dialog === "PAY_OUT" ? "e.g. Paid the delivery boy" : dialog === "PAY_IN" ? "e.g. Change from the bank" : ""} />
            </Field>
          )}
        </form>
      </Modal>
    </>
  );
}
