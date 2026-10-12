"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Copy, KeyRound, LogOut, MessageCircle, Power, Unlock } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Pagination, SearchInput, TableSkeleton, TableWrap, useToast } from "@/components/ui";
import { api, formatDateTime, qs, useApi, useDebounce } from "@/lib/client";
import { StatusBadge, type PharmacyStatus } from "../status-badge";

type Account = {
  id: string; name: string; username: string; email: string; role: "ADMIN" | "PHARMACIST" | "CASHIER"; active: boolean; locked: boolean;
  lastLoginAt: string | null; mustChangePassword: boolean; pharmacy: { id: string; name: string; slug: string; status: PharmacyStatus };
};
type Page = { items: Account[]; total: number; page: number; pageSize: number };

const ROLE = { ADMIN: "Pharmacy Admin", PHARMACIST: "Pharmacist", CASHIER: "Cashier" } as const;
type Pending = { kind: "deactivate" | "activate" | "logout"; account: Account } | null;

function AccountsInner() {
  const toast = useToast();
  const params = useSearchParams();
  const pharmacyId = params.get("pharmacyId") ?? "";
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq]);
  const { data, error, loading, reload } = useApi<Page>(`/api/platform/accounts?${qs({ q: dq, pharmacyId, page })}`);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ account: Account; url: string } | null>(null);

  async function act(account: Account, action: string, body: unknown = {}) {
    setBusy(true);
    try {
      const r = await api<{ path?: string }>(`/api/platform/accounts/${account.id}/${action}`, { body });
      if (action === "reset" && r.path) setReset({ account, url: `${window.location.origin}${r.path}` });
      else toast.success({ active: "Account updated", logout: "All sessions ended", unlock: "Account unlocked" }[action] ?? "Done");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <PageHeader title="Accounts" subtitle={pharmacyId ? "Staff of one pharmacy" : "Staff accounts of every pharmacy"} actions={pharmacyId && <Link href="/platform/accounts" className="text-sm text-primary hover:underline">Show all pharmacies</Link>} />
      <Card>
        <div className="border-b border-border p-4"><SearchInput value={q} onChange={setQ} placeholder="Search name, username or email" className="max-w-md" /></div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title="No accounts found" /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">Person</th><th className="th">Pharmacy</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="td"><span className="font-medium">{a.name}</span><span className="block text-xs text-fg-muted"><span className="font-mono">{a.username}</span> · {a.email}</span></td>
                    <td className="td"><Link href={`/platform/pharmacies/${a.pharmacy.id}`} className="text-primary hover:underline">{a.pharmacy.name}</Link>{a.pharmacy.status !== "ACTIVE" && <span className="ml-2"><StatusBadge status={a.pharmacy.status} /></span>}</td>
                    <td className="td">{ROLE[a.role]}</td>
                    <td className="td">
                      <span className="flex flex-wrap gap-1">
                        {a.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                        {a.locked && <Badge tone="red">Locked</Badge>}
                        {a.mustChangePassword && <Badge tone="amber">Temporary password</Badge>}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : "Never"}</td>
                    <td className="td">
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Send a password reset link" aria-label={`Reset password for ${a.name}`} disabled={busy} onClick={() => act(a, "reset")}><KeyRound className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Sign out everywhere" aria-label={`Sign ${a.name} out everywhere`} disabled={busy} onClick={() => setPending({ kind: "logout", account: a })}><LogOut className="h-4 w-4" /></Button>
                        {a.locked && <Button size="sm" variant="ghost" title="Unlock" aria-label={`Unlock ${a.name}`} disabled={busy} onClick={() => act(a, "unlock")}><Unlock className="h-4 w-4" /></Button>}
                        <Button size="sm" variant="ghost" title={a.active ? "Deactivate" : "Activate"} aria-label={`${a.active ? "Deactivate" : "Activate"} ${a.name}`} disabled={busy}
                          onClick={() => setPending({ kind: a.active ? "deactivate" : "activate", account: a })}>
                          <Power className={a.active ? "h-4 w-4 text-danger" : "h-4 w-4 text-success"} />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "logout" ? "Sign out everywhere?" : pending?.kind === "deactivate" ? "Deactivate account?" : "Activate account?"}
        message={pending && (
          pending.kind === "logout" ? <>Every open session of <strong>{pending.account.name}</strong> ({pending.account.pharmacy.name}) ends on its next request.</>
            : pending.kind === "deactivate" ? <><strong>{pending.account.name}</strong> ({pending.account.pharmacy.name}) is signed out and can no longer sign in.</>
              : <><strong>{pending.account.name}</strong> ({pending.account.pharmacy.name}) can sign in again.</>
        )}
        confirmLabel={pending?.kind === "logout" ? "Sign out everywhere" : pending?.kind === "deactivate" ? "Deactivate" : "Activate"}
        danger={pending?.kind !== "activate"}
        loading={busy}
        onClose={() => setPending(null)}
        onConfirm={() => pending && (pending.kind === "logout" ? act(pending.account, "logout") : act(pending.account, "active", { active: pending.kind === "activate" }))}
      />
      {reset && <ResetLinkModal {...reset} onClose={() => setReset(null)} />}
    </>
  );
}

function ResetLinkModal({ account, url, onClose }: { account: Account; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `Hello ${account.name}. Open this link within one hour to set a new password for ${account.pharmacy.name}: ${url}`;
  return (
    <Modal open onClose={onClose} title="Password reset link" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3 text-sm">
        <p>Send this link to <strong>{account.name}</strong>. It works once, for one hour, and is shown only now.</p>
        <p className="break-all rounded-lg bg-muted p-3 font-mono">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(message); setCopied(true); }}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy message"}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium hover:bg-muted dark:border-slate-700"><MessageCircle className="h-4 w-4" aria-hidden /> Share on WhatsApp</a>
        </div>
      </div>
    </Modal>
  );
}

export default function AccountsPage() {
  return <Suspense><AccountsInner /></Suspense>;
}
