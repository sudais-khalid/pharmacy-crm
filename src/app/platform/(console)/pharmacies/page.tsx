"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, ErrorBox, PageHeader, SearchInput, Select, TableSkeleton, TableWrap } from "@/components/ui";
import { formatDate, formatDateTime, qs, useApi, useDebounce } from "@/lib/client";
import { StatusBadge, STATUS_LABEL, type PharmacyStatus } from "../status-badge";

type Row = {
  id: string; slug: string; name: string; city: string | null; status: PharmacyStatus; plan: string; subscriptionEndsAt: string | null;
  maxUsers: number; staffCount: number; invoicesThisMonth: number; lastActivityAt: string | null;
};

export default function PharmaciesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const dq = useDebounce(q);
  const { data, error, loading, reload } = useApi<{ items: Row[] }>(`/api/platform/pharmacies?${qs({ q: dq, status })}`);
  return (
    <>
      <PageHeader
        title="Pharmacies"
        subtitle="Every pharmacy on this installation"
        actions={<Link href="/platform/pharmacies/new" data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary/90"><Plus className="h-4 w-4" aria-hidden /> New pharmacy</Link>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, URL name or city" className="min-w-[16rem] flex-1" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-48">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? (
          <EmptyState title={q || status ? "No pharmacies match" : "No pharmacies yet"} hint="Create a pharmacy and its first admin to get started." />
        ) : (
          <TableWrap>
            <thead><tr className="border-b border-border"><th className="th">Pharmacy</th><th className="th">Status</th><th className="th">Plan</th><th className="th text-right">Staff</th><th className="th text-right">Invoices this month</th><th className="th">Subscription ends</th><th className="th">Last activity</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-border/60 hover:bg-muted/60">
                  <td className="td">
                    <Link className="font-medium text-primary hover:underline" href={`/platform/pharmacies/${p.id}`}>{p.name}</Link>
                    <span className="block text-xs text-fg-muted"><span className="font-mono">{p.slug}</span>{p.city ? ` · ${p.city}` : ""}</span>
                  </td>
                  <td className="td"><StatusBadge status={p.status} /></td>
                  <td className="td">{p.plan}</td>
                  <td className="td text-right">{p.staffCount} / {p.maxUsers}</td>
                  <td className="td text-right">{p.invoicesThisMonth}</td>
                  <td className="td">{p.subscriptionEndsAt ? formatDate(p.subscriptionEndsAt) : "-"}</td>
                  <td className="td">{p.lastActivityAt ? formatDateTime(p.lastActivityAt) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
