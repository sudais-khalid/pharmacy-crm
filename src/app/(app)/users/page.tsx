"use client";
import { useState } from "react";
import { Check, Copy, KeyRound, Link2, LogOut, Pencil, Plus, Power } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, TableSkeleton, TableWrap, useToast } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { ApiError, api, formatDateTime, useApi } from "@/lib/client";

type Role = { id: string; name: string; key: string; system: boolean; description: string | null; assignable: boolean };
type Staff = {
  id: string; name: string; username: string; email: string; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null;
  role: { id: string; key: string; name: string; system: boolean }; manageable: boolean;
};
type List = { seats: { used: number; max: number }; items: Staff[] };
type Secret = { title: string; label: string; value: string; note: string };
type Pending = { kind: "deactivate" | "activate" | "logout" | "temporary-password"; user: Staff } | null;

const blank = { name: "", email: "", username: "", roleId: "", credentials: "invite" as "invite" | "password" };

/** Staff accounts of this pharmacy (task 3.3): add by invite or temporary password, change role, deactivate, resets. */
export default function UsersPage() {
  const { user: me } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<List>("/api/users");
  const roles = useApi<{ roles: Role[] }>("/api/roles");
  const assignable = roles.data?.roles.filter((r) => r.assignable) ?? [];
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const set = (k: keyof typeof blank, v: string) => setF((s) => ({ ...s, [k]: v }));
  const full = data ? data.seats.used >= data.seats.max : false;

  function open(u: Staff | "new") {
    setErrors({});
    setF(u === "new" ? { ...blank, roleId: assignable.find((r) => r.key === "CASHIER")?.id ?? assignable[0]?.id ?? "" } : { ...blank, name: u.name, email: u.email, username: u.username, roleId: u.role.id });
    setEditing(u);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      if (editing === "new") {
        const r = await api<{ user: Staff; credentials: { kind: "invite"; path: string } | { kind: "password"; password: string } }>("/api/users", { body: f });
        setSecret(r.credentials.kind === "invite"
          ? { title: "Invite link", label: `Send this link to ${r.user.name}`, value: `${window.location.origin}${r.credentials.path}`, note: "It works once and expires in 72 hours. They choose their own password." }
          : { title: "Temporary password", label: `Sign-in for ${r.user.name}: username ${r.user.username}`, value: r.credentials.password, note: "They must choose a new password when they first sign in. It is shown only now." });
      } else if (editing) {
        await api(`/api/users/${editing.id}`, { method: "PUT", body: { name: f.name, ...(editing.id === me.id ? {} : { roleId: f.roleId }) } });
        toast.success("Saved");
      }
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function act(p: NonNullable<Pending>) {
    const { kind, user: u } = p;
    try {
      if (kind === "activate" || kind === "deactivate") {
        await api(`/api/users/${u.id}`, { method: "PUT", body: { active: kind === "activate" } });
        toast.success(kind === "activate" ? "Account activated" : "Account deactivated");
      } else if (kind === "logout") {
        await api(`/api/users/${u.id}/logout`, { body: {} });
        toast.success(`${u.name} is signed out everywhere`);
      } else {
        const r = await api<{ password: string }>(`/api/users/${u.id}/temporary-password`, { body: {} });
        setSecret({ title: "Temporary password", label: `Sign-in for ${u.name}: username ${u.username}`, value: r.password, note: "They must choose a new password when they sign in. Their open sessions have ended." });
      }
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function resetLink(u: Staff) {
    try {
      const r = await api<{ path: string }>(`/api/users/${u.id}/reset-link`, { body: {} });
      setSecret({ title: "Password reset link", label: `Send this link to ${u.name}`, value: `${window.location.origin}${r.path}`, note: "It works once and expires in 1 hour." });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const confirmText: Record<NonNullable<Pending>["kind"], [string, string, string]> = {
    deactivate: ["Deactivate account", "They are signed out at once and cannot sign in until the account is activated again.", "Deactivate"],
    activate: ["Activate account", "They can sign in again with their current password.", "Activate"],
    logout: ["Sign out everywhere", "Every open session of this account ends on its next request.", "Sign out"],
    "temporary-password": ["Set a temporary password", "Their current password stops working and their sessions end. You will see the new password once.", "Set password"],
  };

  return (
    <>
      <PageHeader title="Users" subtitle={data ? `Staff accounts and their roles. ${data.seats.used} of ${data.seats.max} active accounts used.` : "Staff accounts and their roles."}
        actions={<Button onClick={() => open("new")} disabled={full || !assignable.length} title={full ? "The plan's account limit is reached" : "Alt+N"} data-shortcut="new" aria-keyshortcuts="Alt+N"><Plus className="h-4 w-4" aria-hidden /> Add user</Button>} />
      <Card>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No staff accounts" /> : (
          <TableWrap>
            <thead><tr className="border-b border-border"><th className="th">Person</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="td"><span className="font-medium">{u.name}</span>{u.id === me.id && <span className="ml-2 text-xs text-fg-muted">(you)</span>}<span className="block text-xs text-fg-muted"><span className="font-mono">{u.username}</span> · {u.email}</span></td>
                  <td className="td"><Badge tone={u.role.key === "PHARMACY_ADMIN" ? "blue" : "slate"}>{u.role.name}</Badge></td>
                  <td className="td"><span className="flex flex-wrap gap-1">{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}{u.mustChangePassword && <Badge tone="amber">Must change password</Badge>}</span></td>
                  <td className="td whitespace-nowrap">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                  <td className="td">
                    {(u.manageable || u.id === me.id) && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${u.name}`} onClick={() => open(u)}><Pencil className="h-4 w-4" /></Button>
                        {u.manageable && <>
                          <Button size="sm" variant="ghost" title="Send a password reset link" aria-label={`Reset link for ${u.name}`} onClick={() => resetLink(u)}><Link2 className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" title="Set a temporary password" aria-label={`Temporary password for ${u.name}`} onClick={() => setPending({ kind: "temporary-password", user: u })}><KeyRound className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" title="Sign out everywhere" aria-label={`Sign ${u.name} out everywhere`} onClick={() => setPending({ kind: "logout", user: u })}><LogOut className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" title={u.active ? "Deactivate" : "Activate"} aria-label={`${u.active ? "Deactivate" : "Activate"} ${u.name}`} onClick={() => setPending({ kind: u.active ? "deactivate" : "activate", user: u })}>
                            <Power className={u.active ? "h-4 w-4 text-danger" : "h-4 w-4 text-success"} />
                          </Button>
                        </>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add user" : "Edit user"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="user-form" loading={saving}>{editing === "new" ? "Add user" : "Save"}</Button></>}>
        <form id="user-form" onSubmit={submit} className="grid gap-4">
          <Field label="Name" error={errors.name}><Input value={f.name} onChange={(e) => set("name", e.target.value)} required data-autofocus /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={f.email} disabled={editing !== "new"} onChange={(e) => set("email", e.target.value)} required /></Field>
          {editing === "new" && <Field label="Username" hint="For signing in. Leave empty to use the first part of the email." error={errors.username}><Input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" /></Field>}
          <Field label="Role" hint={assignable.find((r) => r.id === f.roleId)?.description ?? undefined} error={errors.roleId}>
            <Select value={f.roleId} onChange={(e) => set("roleId", e.target.value)} disabled={editing !== "new" && editing?.id === me.id}>
              {editing !== "new" && editing && !assignable.some((r) => r.id === editing.role.id) && <option value={editing.role.id}>{editing.role.name}</option>}
              {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          {editing === "new" && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">First sign-in</legend>
              <label className="flex items-start gap-2 text-sm"><input type="radio" name="cred" className="mt-1" checked={f.credentials === "invite"} onChange={() => set("credentials", "invite")} /><span><b>Invite link</b><span className="block text-fg-muted">They open the link and choose their own password.</span></span></label>
              <label className="flex items-start gap-2 text-sm"><input type="radio" name="cred" className="mt-1" checked={f.credentials === "password"} onChange={() => set("credentials", "password")} /><span><b>Temporary password</b><span className="block text-fg-muted">You tell them a password; they change it at first sign-in.</span></span></label>
            </fieldset>
          )}
        </form>
      </Modal>

      {pending && (
        <ConfirmDialog open title={confirmText[pending.kind][0]} message={<><b>{pending.user.name}</b>: {confirmText[pending.kind][1]}</>} confirmLabel={confirmText[pending.kind][2]}
          danger={pending.kind === "deactivate"} onConfirm={() => act(pending)} onClose={() => setPending(null)} />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

/** Shows a link or password once, with a copy button. */
function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} title={secret.title} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-2 text-sm">{secret.label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
        <code className="flex-1 break-all font-mono text-sm">{secret.value}</code>
        <Button size="sm" variant="secondary" aria-label="Copy" onClick={() => navigator.clipboard.writeText(secret.value).then(() => setCopied(true))}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
      </div>
      <p className="mt-2 text-xs text-fg-muted">{secret.note}</p>
    </Modal>
  );
}
