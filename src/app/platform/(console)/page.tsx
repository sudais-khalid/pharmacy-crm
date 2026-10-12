"use client";
import Link from "next/link";
import { AlertTriangle, Ban, Building2, Clock } from "lucide-react";
import { Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard } from "@/components/ui";
import { formatDate, formatDateTime, useApi } from "@/lib/client";
import { StatusBadge, type PharmacyStatus } from "./status-badge";

type Overview = {
  counts: Record<PharmacyStatus, number>;
  endingSoon: { id: string; name: string; slug: string; subscriptionEndsAt: string; status: PharmacyStatus }[];
  newest: { id: string; name: string; slug: string; createdAt: string; status: PharmacyStatus }[];
  recent: { id: string; at: string; action: string; entity: string; pharmacyId: string | null }[];
};

export default function ConsoleOverviewPage() {
  const { data, error, loading, reload } = useApi<Overview>("/api/platform/overview");
  return (
    <>
      <PageHeader title="Overview" subtitle="All pharmacies on this installation" />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active" value={data.counts.ACTIVE} icon={<Building2 className="h-5 w-5" />} tone="green" />
            <StatCard label="Grace period" value={data.counts.GRACE} icon={<Clock className="h-5 w-5" />} tone="amber" />
            <StatCard label="Suspended" value={data.counts.SUSPENDED} icon={<AlertTriangle className="h-5 w-5" />} tone="red" />
            <StatCard label="Deactivated" value={data.counts.DEACTIVATED} icon={<Ban className="h-5 w-5" />} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="border-b border-border px-4 py-3 font-semibold">Subscriptions ending within 14 days</h2>
              {data.endingSoon.length === 0 ? <EmptyState title="Nothing ending soon" /> : (
                <ul className="divide-y divide-border">
                  {data.endingSoon.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <Link href={`/platform/pharmacies/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                      <span className="tabular-nums text-fg-muted">{formatDate(p.subscriptionEndsAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 className="border-b border-border px-4 py-3 font-semibold">Newest pharmacies</h2>
              {data.newest.length === 0 ? (
                <EmptyState title="No pharmacies yet" action={<Link href="/platform/pharmacies/new" className="text-sm font-medium text-primary hover:underline">Create the first pharmacy</Link>} />
              ) : (
                <ul className="divide-y divide-border">
                  {data.newest.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <Link href={`/platform/pharmacies/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                      <span className="flex items-center gap-2"><StatusBadge status={p.status} /><span className="tabular-nums text-fg-muted">{formatDate(p.createdAt)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card>
            <h2 className="border-b border-border px-4 py-3 font-semibold">Recent Developer actions</h2>
            {data.recent.length === 0 ? <EmptyState title="No actions yet" /> : (
              <ul className="divide-y divide-border">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="font-mono text-xs">{r.action}</span>
                    <span className="tabular-nums text-fg-muted">{formatDateTime(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
