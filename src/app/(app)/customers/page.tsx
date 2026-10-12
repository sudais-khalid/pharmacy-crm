"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchInput, TableSkeleton, TableWrap } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { qs, useApi, useDebounce } from "@/lib/client";
import { CustomerForm, type Customer } from "@/components/customer-form";

export default function CustomersPage() {
  const money = useMoney(); const canManage = useCan("customers.manage");
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq]);
  const { data, error, loading, reload } = useApi<{ items: Customer[]; total: number; page: number; pageSize: number }>(`/api/customers?${qs({ q: dq, page })}`);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Customers" subtitle="Customer records and credit (udhaar) accounts." actions={canManage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add customer</Button>} />
      <Card>
        <div className="border-b border-slate-200 p-4 dark:border-slate-800"><SearchInput value={q} onChange={setQ} placeholder="Search name, phone or email" className="max-w-md" /></div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No customers yet" action={canManage && <Button onClick={() => setAdding(true)}>Add customer</Button>} /> : (
          <><TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Name</th><th className="th">Phone</th><th className="th text-right">Credit limit</th><th className="th text-right">Balance owed</th><th className="th">Status</th></tr></thead>
            <tbody>{data.items.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                <td className="td font-medium"><Link className="text-brand-700 hover:underline dark:text-brand-300" href={`/customers/${c.id}`}>{c.name}</Link></td><td className="td">{c.phone ?? "—"}</td><td className="td text-right">{money(c.creditLimit)}</td>
                <td className="td text-right">{Number(c.balance) > 0 ? <Badge tone="amber">{money(c.balance)}</Badge> : money(0)}</td><td className="td">{c.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td></tr>))}</tbody></TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>
        )}
      </Card>
      {adding && <CustomerForm customer={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}
