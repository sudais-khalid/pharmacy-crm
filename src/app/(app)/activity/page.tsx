"use client";
import { useEffect, useState } from "react";
import { Card, EmptyState, ErrorBox, Field, Input, PageHeader, Pagination, Select, TableSkeleton, TableWrap } from "@/components/ui";
import { ActorBadge, Changes, actionLabel, type AuditRow } from "@/components/history";
import { formatDateTime, qs, useApi } from "@/lib/client";

type Page = { items: AuditRow[]; total: number; page: number; pageSize: number };
const ENTITIES: [string, string][] = [["", "Everything"], ["Sale", "Invoices"], ["Medicine", "Medicines"], ["Batch", "Stock"], ["Purchase", "Purchases"], ["Customer", "Customers"], ["Supplier", "Suppliers"], ["User", "Staff accounts"], ["Role", "Roles"], ["Pharmacy", "Profile and settings"]];

/** Everything recorded in this pharmacy (task 3.10), newest first. */
export default function ActivityPage() {
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [entity, from, to]);
  const { data, error, loading, reload } = useApi<Page>(`/api/audit?${qs({ entity, from, to, page })}`);

  return (
    <>
      <PageHeader title="Activity" subtitle="Who did what, and when. Work done by your software provider shows as Platform support." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Field label="Show" className="min-w-[180px]"><Select value={entity} onChange={(e) => setEntity(e.target.value)}>{ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="Nothing recorded for this choice" /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Details</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top">
                    <td className="td whitespace-nowrap">{formatDateTime(r.at)}</td>
                    <td className="td"><ActorBadge row={r} /></td>
                    <td className="td">{actionLabel(r.action)}<span className="block text-xs text-fg-muted">{r.entity}</span></td>
                    <td className="td max-w-md"><Changes before={r.before} after={r.after} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
