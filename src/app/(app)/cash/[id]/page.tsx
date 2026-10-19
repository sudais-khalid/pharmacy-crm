"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calculator, Scale, Wallet } from "lucide-react";
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard, TableWrap } from "@/components/ui";
import { useMoney } from "@/components/app-context";
import { formatDateTime, useApi } from "@/lib/client";

type Session = {
  id: string; status: "OPEN" | "CLOSED"; openedAt: string; closedAt: string | null; openingFloat: string; expectedCash: string | null; countedCash: string | null; difference: string | null; note: string | null;
  user: { name: string } | null; closedBy: { name: string } | null;
  summary: { openingFloat: number; cashSales: number; cardSales: number; creditSales: number; salesCount: number; cashRefunds: number; payIns: number; payOuts: number; expectedCash: number };
  movements: { id: string; type: "PAY_IN" | "PAY_OUT"; amount: string; reason: string; createdAt: string; user: { name: string } }[];
};

/** One drawer session: how the expected cash was reached, and what was counted. */
export default function CashSessionPage() {
  const { id } = useParams<{ id: string }>();
  const money = useMoney();
  const { data, error, reload } = useApi<Session>(`/api/cash/${id}`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const s = data.summary;
  const rows: [string, number][] = [["Opening float", s.openingFloat], ["Cash taken on sales", s.cashSales], ["Cash refunds", -s.cashRefunds], ["Paid in", s.payIns], ["Paid out", -s.payOuts]];
  return (
    <>
      <Link href="/cash" className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" /> Cash drawer</Link>
      <PageHeader title={`${data.user?.name ?? "Drawer"}, ${formatDateTime(data.openedAt)}`} subtitle={data.status === "OPEN" ? "Open now" : `Closed ${formatDateTime(data.closedAt!)}${data.closedBy ? ` by ${data.closedBy.name}` : ""}`} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<Calculator className="h-5 w-5" />} label="Expected" value={money(data.expectedCash ?? s.expectedCash)} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Counted" value={data.countedCash === null ? "Not yet" : money(data.countedCash)} />
        <StatCard icon={<Scale className="h-5 w-5" />} tone={data.difference !== null && Number(data.difference) !== 0 ? "amber" : "green"} label="Difference" value={data.difference === null ? "" : money(data.difference)} hint={data.note ?? undefined} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">How the expected cash adds up</h2>
          <dl className="space-y-1 text-sm">
            {rows.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-fg-muted">{k}</dt><dd>{v < 0 ? `- ${money(-v)}` : money(v)}</dd></div>)}
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>Should be in the drawer</dt><dd>{money(s.expectedCash)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-fg-muted">{s.salesCount} sales. Card {money(s.cardSales)} and {money(s.creditSales)} on customer accounts never reach the drawer.</p>
        </Card>
        <Card>
          <h2 className="border-b border-border p-4 font-semibold">Paid in and out</h2>
          {!data.movements.length ? <EmptyState title="Nothing paid in or out" /> : (
            <TableWrap>
              <tbody>{data.movements.map((m) => (
                <tr key={m.id} className="border-b border-border/60">
                  <td className="td whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                  <td className="td">{m.type === "PAY_IN" ? <Badge tone="green">In</Badge> : <Badge tone="amber">Out</Badge>}</td>
                  <td className="td">{m.reason}<span className="block text-xs text-fg-muted">{m.user.name}</span></td>
                  <td className="td text-right">{money(m.amount)}</td>
                </tr>))}</tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
