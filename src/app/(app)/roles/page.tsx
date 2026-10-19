"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Input, Modal, PageHeader, Select, TableSkeleton, TableWrap, Textarea, useToast } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { ApiError, api, useApi } from "@/lib/client";

type Role = { id: string; key: string; name: string; description: string | null; system: boolean; permissions: string[]; landingPath: string; users: number };
type Catalog = { roles: Role[]; groups: string[]; permissions: { key: string; group: string; label: string }[]; landingPaths: { path: string; label: string; permission: string }[] };
type Draft = { id: string | null; name: string; description: string; permissions: string[]; landingPath: string };

/** Roles of this pharmacy (task 3.1): the standard templates, read-only, and custom roles made from them. */
export default function RolesPage() {
  const { permissions: mine } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Catalog>("/api/roles");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Role | null>(null);

  async function duplicate(r: Role) {
    try {
      const copy = await api<Role>("/api/roles", { body: { copyFrom: r.id } });
      toast.success(`Created "${copy.name}"`);
      reload();
      setDraft({ id: copy.id, name: copy.name, description: copy.description ?? "", permissions: copy.permissions, landingPath: copy.landingPath });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      const body = { name: draft.name, description: draft.description, permissions: draft.permissions, landingPath: draft.landingPath };
      if (draft.id) await api(`/api/roles/${draft.id}`, { method: "PUT", body });
      else await api("/api/roles", { body });
      toast.success("Role saved. Staff with this role get the change on their next click.");
      setDraft(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Role) {
    try {
      await api(`/api/roles/${r.id}`, { method: "DELETE" });
      toast.success("Role deleted");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <PageHeader title="Roles" subtitle="What each kind of staff member can do. Standard roles are fixed; duplicate one to make your own."
        actions={<Button data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N" onClick={() => setDraft({ id: null, name: "", description: "", permissions: ["dashboard.view"], landingPath: "/dashboard" })}><Plus className="h-4 w-4" aria-hidden /> New role</Button>} />
      <Card>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : data && (
          <TableWrap>
            <thead><tr className="border-b border-border"><th className="th">Role</th><th className="th">Permissions</th><th className="th">Staff</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>
              {data.roles.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="td"><span className="font-medium">{r.name}</span> {r.system && <Badge icon={<Lock className="h-3 w-3" aria-hidden />}>Standard</Badge>}<span className="block max-w-xl text-xs text-fg-muted">{r.description}</span></td>
                  <td className="td">{r.permissions.length} of {data.permissions.length}</td>
                  <td className="td">{r.users}</td>
                  <td className="td">
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" title="Duplicate" aria-label={`Duplicate ${r.name}`} onClick={() => duplicate(r)}><Copy className="h-4 w-4" /></Button>
                      {!r.system && <>
                        <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setDraft({ id: r.id, name: r.name, description: r.description ?? "", permissions: r.permissions, landingPath: r.landingPath })}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                      </>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {draft && data && (
        <Modal open wide onClose={() => setDraft(null)} title={draft.id ? "Edit role" : "New role"}
          footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" form="role-form" loading={saving}>Save role</Button></>}>
          <RoleEditor draft={draft} setDraft={setDraft} catalog={data} mine={mine} original={data.roles.find((r) => r.id === draft.id)?.permissions ?? []} errors={errors} onSubmit={save} />
        </Modal>
      )}
      {removing && <ConfirmDialog open danger title="Delete role" message={<>Delete <b>{removing.name}</b>? Roles still given to staff cannot be deleted.</>} confirmLabel="Delete" onConfirm={() => remove(removing)} onClose={() => setRemoving(null)} />}
    </>
  );
}

function RoleEditor({ draft, setDraft, catalog, mine, original, errors, onSubmit }: {
  draft: Draft; setDraft: (d: Draft) => void; catalog: Catalog; mine: string[]; original: string[]; errors: Record<string, string>; onSubmit: (e: React.FormEvent) => void;
}) {
  const has = (p: string) => draft.permissions.includes(p);
  // you can remove anything, but only add what you hold yourself
  const canTick = (p: string) => mine.includes(p) || original.includes(p);
  const toggle = (p: string) => setDraft({ ...draft, permissions: has(p) ? draft.permissions.filter((x) => x !== p) : [...draft.permissions, p] });
  const screens = useMemo(() => catalog.landingPaths.filter((l) => draft.permissions.includes(l.permission)), [catalog.landingPaths, draft.permissions]);
  // keep the first screen one the role can open while permissions change
  useEffect(() => {
    if (screens.length && !screens.some((s) => s.path === draft.landingPath)) setDraft({ ...draft, landingPath: screens[0].path });
  }, [screens, draft, setDraft]);

  return (
    <form id="role-form" onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={60} data-autofocus /></Field>
        <Field label="First screen after sign-in" error={errors.landingPath} hint={screens.length ? undefined : "Tick at least one screen this role may open"}>
          <Select value={draft.landingPath} onChange={(e) => setDraft({ ...draft, landingPath: e.target.value })}>
            {screens.map((s) => <option key={s.path} value={s.path}>{s.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={200} /></Field>
      {errors.permissions && <p className="text-sm text-danger">{errors.permissions}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {catalog.groups.map((g) => {
          const items = catalog.permissions.filter((p) => p.group === g);
          const tickable = items.filter((p) => canTick(p.key));
          const all = tickable.length > 0 && tickable.every((p) => has(p.key));
          return (
            <fieldset key={g} className="rounded-lg border border-border p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                {g}
                <button type="button" className="text-xs font-normal text-primary hover:underline" disabled={!tickable.length}
                  onClick={() => setDraft({ ...draft, permissions: all ? draft.permissions.filter((x) => !tickable.some((t) => t.key === x)) : [...new Set([...draft.permissions, ...tickable.map((t) => t.key)])] })}>
                  {all ? "none" : "all"}
                </button>
              </legend>
              {items.map((p) => (
                <label key={p.key} className={`flex items-start gap-2 py-1 text-sm ${canTick(p.key) ? "" : "opacity-50"}`} title={canTick(p.key) ? undefined : "You cannot give a permission you do not have"}>
                  <input type="checkbox" className="mt-0.5" checked={has(p.key)} disabled={!canTick(p.key) && !has(p.key)} onChange={() => toggle(p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
    </form>
  );
}
