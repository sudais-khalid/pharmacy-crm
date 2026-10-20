"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, EmptyState, ErrorBox, TableSkeleton, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { formatDate, formatDateTime, useApi } from "@/lib/client";
import { ORDER_STATUS, type OrderRow } from "../../orders/order-status";

/** A supplier's orders with ordered, received and pending quantities (roadmap 7.6). */
export function OrdersTab({ supplierId }: { supplierId: string }) {
  const money = useMoney();
  const canOrder = useCan("purchases.create");
  const { data, error, reload } = useApi<{ items: OrderRow[] }>(`/api/orders?supplierId=${supplierId}&status=all`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <TableSkeleton />;
  return (
    <div>
      {canOrder && <div className="border-b border-border p-3"><Link href={`/orders/new?supplier=${supplierId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Plus className="h-4 w-4" aria-hidden /> New order to this supplier</Link></div>}
      {!data.items.length ? <EmptyState title="No orders to this supplier yet" /> : (
        <TableWrap>
          <thead><tr className="border-b border-border"><th className="th">Order</th><th className="th">Made</th><th className="th">Expected</th><th className="th">Status</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Pending</th><th className="th text-right">Estimate</th></tr></thead>
          <tbody>{data.items.map((o) => (
            <tr key={o.id} className="border-b border-border/60">
              <td className="td font-medium"><Link className="text-primary hover:underline" href={`/orders/${o.id}`}>{o.number}</Link></td>
              <td className="td whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
              <td className="td">{o.expectedDate ? formatDate(o.expectedDate) : ""}</td>
              <td className="td"><Badge tone={ORDER_STATUS[o.status]?.tone ?? "slate"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge></td>
              <td className="td text-right">{o.ordered}</td><td className="td text-right">{o.received}</td>
              <td className="td text-right">{o.pending > 0 && !["CLOSED", "CANCELLED"].includes(o.status) ? <b>{o.pending}</b> : o.pending}</td>
              <td className="td text-right">{money(o.estimatedTotal)}</td>
            </tr>))}</tbody>
        </TableWrap>
      )}
    </div>
  );
}

type ReturnRow = { id: string; number: string; createdAt: string; total: string; reason: string; user: { name: string }; _count: { items: number } };

/** Stock handed back to this supplier (roadmap 7.9). */
export function ReturnsTab({ supplierId }: { supplierId: string }) {
  const money = useMoney();
  const { data, error, reload } = useApi<{ items: ReturnRow[] }>(`/api/supplier-returns?supplierId=${supplierId}`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <TableSkeleton />;
  if (!data.items.length) return <EmptyState title="Nothing returned to this supplier" hint="Set batches aside on Inventory, Expiry, then return them from the Supplier returns tab." />;
  return (
    <TableWrap>
      <thead><tr className="border-b border-border"><th className="th">Return</th><th className="th">Date</th><th className="th">Reason</th><th className="th">By</th><th className="th text-right">Lines</th><th className="th text-right">Credit</th></tr></thead>
      <tbody>{data.items.map((r) => (
        <tr key={r.id} className="border-b border-border/60">
          <td className="td font-medium"><Link className="text-primary hover:underline" href={`/invoice/supplier-returns/${r.id}`}>{r.number}</Link></td>
          <td className="td whitespace-nowrap">{formatDateTime(r.createdAt)}</td><td className="td">{r.reason}</td><td className="td">{r.user.name}</td>
          <td className="td text-right">{r._count.items}</td><td className="td text-right">{money(r.total)}</td>
        </tr>))}</tbody>
    </TableWrap>
  );
}
