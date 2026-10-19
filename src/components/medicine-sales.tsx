"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState, TableWrap } from "./ui";
import { useMoney } from "./app-context";
import { formatDateTime, useApi } from "@/lib/client";

type Row = {
  id: string; quantity: number; unitPrice: string; lineTotal: string; returnedQty: number; batch: { batchNumber: string };
  sale: { id: string; invoiceNo: string; createdAt: string; status: string; customerName: string | null; customer: { name: string } | null; user: { name: string } };
};
type Page = { total: number; page: number; pageSize: number; soldQty: number; soldValue: string; items: Row[] };

/** A medicine's sales, newest first, with what came back (roadmap 5.8). Cashiers see their own invoices only. */
export function MedicineSales({ medicineId }: { medicineId: string }) {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<Page>(`/api/medicines/${medicineId}/sales?page=${page}`);
  if (loading && !data) return <p className="p-3 text-sm text-fg-muted">Loading sales...</p>;
  if (!data || !data.items.length) return <EmptyState title="Not sold yet" />;
  const pages = Math.ceil(data.total / data.pageSize);
  return (
    <div>
      <p className="mb-2 text-sm text-fg-muted">{data.soldQty} sold for {money(data.soldValue)} on completed invoices.</p>
      <TableWrap>
        <thead><tr className="border-b border-border"><th className="th">Date</th><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Batch</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Total</th></tr></thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="td whitespace-nowrap">{formatDateTime(r.sale.createdAt)}</td>
              <td className="td"><Link className="text-primary hover:underline" href={`/invoice/${r.sale.id}`}>{r.sale.invoiceNo}</Link> {r.sale.status === "CANCELLED" && <Badge tone="red">Cancelled</Badge>}</td>
              <td className="td">{r.sale.customer?.name ?? r.sale.customerName ?? "Walk-in"}</td>
              <td className="td">{r.batch.batchNumber}</td>
              <td className="td text-right">{r.quantity}{r.returnedQty > 0 && <span className="block text-xs text-warning">{r.returnedQty} returned</span>}</td>
              <td className="td text-right">{money(r.unitPrice)}</td>
              <td className="td text-right">{money(r.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span>{page} of {pages}</span>
          <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}
