"use client";
import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, TableSkeleton, TableWrap, useToast } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { ApiError, api, formatDate, useApi } from "@/lib/client";

type U = { id: string; name: string; email: string; role: "ADMIN" | "PHARMACIST" | "CASHIER"; active: boolean; createdAt: string };
const ROLE_HELP: Record<string, string> = { ADMIN: "Full access including users, settings and deleting medicines.", PHARMACIST: "Medicines, inventory, purchases, sales, customers, reports. Can exceed credit limits.", CASHIER: "POS, customers and payments. Cannot delete medicines, manage users or change settings." };

export default function UsersPage() {
  const { user: me } = useApp(); const toast = useToast();
  const { data, error, loading, reload } = useApi<U[]>("/api/users");
  const [editing, setEditing] = useState<U | "new" | null>(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "CASHIER" });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  function open(u: U | "new") { setErrors({}); setF(u === "new" ? { name: "", email: "", password: "", role: "CASHIER" } : { name: u.name, email: u.email, password: "", role: u.role }); setEditing(u); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErrors({});
    try {
      if (editing === "new") await api("/api/users", { body: f });
      else if (editing) await api(`/api/users/${editing.id}`, { method: "PUT", body: { name: f.name, role: f.role, password: f.password || undefined } });
      toast.success("Saved"); setEditing(null); reload();
    } catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); } finally { setSaving(false); }
  }
  async function toggle(u: U) {
    try { await api(`/api/users/${u.id}`, { method: "PUT", body: { active: !u.active } }); toast.success(u.active ? "User deactivated" : "User activated"); reload(); }
    catch (err) { toast.error((err as Error).message); }
  }

  return (
    <>
      <PageHeader title="Users" subtitle="Staff accounts and their roles." actions={<Button onClick={() => open("new")} data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N"><Plus className="h-4 w-4" /> Add user</Button>} />
      <Card>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.length ? <EmptyState title="No users" /> : (
          <TableWrap><thead><tr className="border-b border-slate-200 dark:border-slate-800"><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Status</th><th className="th">Created</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{data.map((u) => (<tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/60"><td className="td font-medium">{u.name}{u.id === me.id && <span className="ml-2 text-xs text-slate-500">(you)</span>}</td><td className="td">{u.email}</td>
              <td className="td"><Badge tone={u.role === "ADMIN" ? "blue" : "slate"}>{u.role.toLowerCase()}</Badge></td><td className="td">{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td><td className="td">{formatDate(u.createdAt)}</td>
              <td className="td"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => open(u)}><KeyRound className="h-3.5 w-3.5" /> Edit</Button>{u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? "Deactivate" : "Activate"}</Button>}</div></td></tr>))}</tbody></TableWrap>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add user" : "Edit user"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="user-form" loading={saving}>Save</Button></>}>
        <form id="user-form" onSubmit={submit} className="space-y-4">
          <Field label="Name" error={errors.name}><Input value={f.name} onChange={(e) => set("name", e.target.value)} required data-autofocus /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={f.email} disabled={editing !== "new"} onChange={(e) => set("email", e.target.value)} required /></Field>
          <Field label="Role" hint={ROLE_HELP[f.role]}><Select value={f.role} onChange={(e) => set("role", e.target.value)} disabled={editing !== "new" && editing?.id === me.id}><option value="ADMIN">Admin</option><option value="PHARMACIST">Pharmacist</option><option value="CASHIER">Cashier</option></Select></Field>
          <Field label={editing === "new" ? "Password" : "New password (leave blank to keep)"} hint="At least 8 characters" error={errors.password}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} required={editing === "new"} minLength={editing === "new" ? 8 : undefined} /></Field>
        </form>
      </Modal>
    </>
  );
}
