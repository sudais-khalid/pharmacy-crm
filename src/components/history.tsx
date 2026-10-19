"use client";
import { ShieldCheck } from "lucide-react";
import { Badge, EmptyState, ErrorBox, Pagination, TableSkeleton } from "./ui";
import { formatDateTime, qs, useApi } from "@/lib/client";

/** Audit rows as people read them (task 3.10). Unknown actions fall back to their technical name. */
const ACTIONS: Record<string, string> = {
  "sale.create": "Sold", "sale.cancel": "Cancelled the invoice",
  "medicine.create": "Added the medicine", "medicine.update": "Edited the medicine", "medicine.price.update": "Changed the price",
  "medicine.archive": "Archived the medicine", "medicine.restore": "Restored the medicine", "medicine.delete": "Deleted the medicine",
  "stock.adjust": "Adjusted stock", "purchase.create": "Recorded a purchase",
  "customer.create": "Added the customer", "customer.update": "Edited the customer", "customer.payment": "Received a payment",
  "supplier.create": "Added the supplier", "supplier.update": "Edited the supplier", "supplier.payment": "Paid the supplier",
  "user.create": "Added a staff account", "user.update": "Edited a staff account", "user.role.change": "Changed a role",
  "user.deactivate": "Deactivated an account", "user.activate": "Activated an account", "user.logout.force": "Signed an account out everywhere",
  "user.password.temporary": "Set a temporary password", "user.password.change": "Changed their password", "user.reset.issue": "Issued a reset link",
  "user.invite.issue": "Issued an invite link", "user.invite.accept": "Accepted the invite", "user.reset.complete": "Reset their password", "user.unlock": "Unlocked an account",
  "role.create": "Created a role", "role.update": "Edited a role", "role.delete": "Deleted a role",
  "pharmacy.profile.update": "Edited the profile", "pharmacy.logo.update": "Changed the logo", "pharmacy.logo.remove": "Removed the logo",
  "settings.update": "Changed settings", "support.start": "Opened a support session", "support.end": "Ended the support session",
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a.replace(/\./g, " ");

export type AuditRow = { id: string; at: string; action: string; entity: string; entityId: string; actor: string; byPlatform: boolean; before: unknown; after: unknown };
type Page = { items: AuditRow[]; total: number; page: number; pageSize: number };

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** "field: old to new" for each changed field, or the values recorded. */
export function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
      {keys.slice(0, 8).map((k) => (
        <li key={k} className="break-all"><span className="font-medium text-fg">{k}</span>: {k in b ? <>{show(b[k])} <span aria-hidden>{"->"}</span> </> : null}{show(a[k])}</li>
      ))}
    </ul>
  );
}

export function ActorBadge({ row }: { row: Pick<AuditRow, "actor" | "byPlatform"> }) {
  return row.byPlatform ? <Badge tone="amber" icon={<ShieldCheck className="h-3 w-3" aria-hidden />}>Platform support</Badge> : <span className="font-medium">{row.actor}</span>;
}

/** History tab for one record (invoice, medicine, customer, supplier). */
export function HistoryList({ entity, entityId, page = 1, onPage }: { entity: string; entityId: string; page?: number; onPage?: (p: number) => void }) {
  const { data, error, loading, reload } = useApi<Page>(`/api/audit?${qs({ entity, entityId, page, pageSize: 20 })}`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={3} cols={3} />;
  if (!data?.items.length) return <EmptyState title="No recorded changes" />;
  return (
    <div>
      <ol className="divide-y divide-border">
        {data.items.map((r) => (
          <li key={r.id} className="p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><ActorBadge row={r} /><span>{actionLabel(r.action)}</span><span className="ml-auto text-xs text-fg-muted">{formatDateTime(r.at)}</span></div>
            <Changes before={r.before} after={r.after} />
          </li>
        ))}
      </ol>
      {onPage && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} />}
    </div>
  );
}
