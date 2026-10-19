"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchInput, TableSkeleton, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { qs, useApi, useDebounce } from "@/lib/client";
import { SupplierForm, type Supplier } from "@/components/supplier-form";

export default function SuppliersPage() {
  const money = useMoney(); const canManage = useCan("suppliers.manage");
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq]);
  const { data, error, loading, reload } = useApi<{ items: Supplier[]; total: number; page: number; pageSize: number }>(`/api/suppliers?${qs({ q: dq, page })}`);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Who you buy from and what you owe them." actions={canManage && <Button onClick={() => setAdding(true)} data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N"><Plus className="h-4 w-4" /> Add supplier</Button>} />
      <Card>
        <div className="border-b border-slate-200 p-4 dark:border-slate-800"><SearchInput value={q} onChange={setQ} placeholder="Search supplier, contact or phone" className="max-w-md" /></div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No suppliers yet" action={canManage && <Button onClick={() => setAdding(true)}>Add supplier</Button>} /> : (
          <><TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Supplier</th><th className="th">Contact</th><th className="th">Phone</th><th className="th">Terms</th><th className="th text-right">We owe</th><th className="th">Status</th></tr></thead>
            <tbody>{data.items.map((s) => (<tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
              <td className="td font-medium"><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/suppliers/${s.id}`}>{s.name}</Link></td><td className="td">{s.contactPerson ?? "—"}</td><td className="td">{s.phone ?? "—"}</td><td className="td">{s.paymentTerms ?? "—"}</td>
              <td className="td text-right">{Number(s.balance) > 0 ? <Badge tone="amber">{money(s.balance)}</Badge> : money(0)}</td><td className="td">{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td></tr>))}</tbody></TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
        )}
      </Card>
      {adding && <SupplierForm supplier={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}
