"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchInput, TableSkeleton, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { formatDateTime, qs, useApi, useDebounce } from "@/lib/client";

type Row = { id: string; number: string; createdAt: string; total: string; refundMethod: string; reason: string; sale: { invoiceNo: string; customerName: string | null; customer: { name: string } | null }; user: { name: string }; _count: { items: number } };

/** Customer returns (roadmap 5.6). */
export default function ReturnsPage() {
  const money = useMoney();
  const canReturn = useCan("returns.create");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq]);
  const { data, error, loading, reload } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>(`/api/returns?${qs({ q: dq, page })}`);
  return (
    <>
      <PageHeader title="Sales returns" subtitle="Items customers brought back, and how they were refunded."
        actions={canReturn && <Link href="/returns/new" data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary/90"><Plus className="h-4 w-4" aria-hidden /> New return</Link>} />
      <Card>
        <div className="border-b border-border p-4"><SearchInput value={q} onChange={setQ} placeholder="Return or invoice number" className="max-w-md" /></div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No returns yet" hint={canReturn ? "Start one from New return or from an invoice." : undefined} /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">Return</th><th className="th">Date</th><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Taken by</th><th className="th">Refund</th><th className="th text-right">Amount</th></tr></thead>
              <tbody>{data.items.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="td font-medium"><Link className="text-primary hover:underline" href={`/invoice/returns/${r.id}`}>{r.number}</Link></td>
                  <td className="td whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="td">{r.sale.invoiceNo}</td>
                  <td className="td">{r.sale.customer?.name ?? r.sale.customerName ?? "Walk-in"}</td>
                  <td className="td">{r.user.name}</td>
                  <td className="td">{r.refundMethod === "CREDIT" ? <Badge tone="blue">Credit note</Badge> : <Badge>{r.refundMethod === "CASH" ? "Cash" : "Card"}</Badge>}</td>
                  <td className="td text-right">{money(r.total)}</td>
                </tr>))}</tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
