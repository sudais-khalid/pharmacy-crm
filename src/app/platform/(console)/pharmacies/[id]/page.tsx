"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, TableWrap, Tabs, useToast } from "@/components/ui";
import { ApiError, api, downloadPost, formatDate, formatDateTime, useApi } from "@/lib/client";
import { StatusBadge, STATUS_LABEL, type PharmacyStatus } from "../../status-badge";

type Detail = {
  pharmacy: {
    id: string; slug: string; name: string; legalName: string | null; address: string; city: string | null; phone: string; whatsapp: string | null;
    email: string | null; licenseNumber: string | null; taxNumber: string | null; status: PharmacyStatus; statusReason: string | null; plan: string;
    subscriptionEndsAt: string | null; maxUsers: number; ocrMonthlyLimit: number; ocrProviders: string[]; createdAt: string;
  };
  staff: { id: string; name: string; username: string; email: string; role: { key: string; name: string }; active: boolean; lastLoginAt: string | null; mustChangePassword: boolean }[];
  flags: { key: string; label: string; enabled: boolean }[];
  audits: { id: string; at: string; realm: "STAFF" | "PLATFORM"; actorId: string | null; action: string; entity: string; supportSessionId: string | null }[];
  supportSessions: { id: string; reason: string; startedAt: string; endedAt: string | null }[];
};

type Tab = "profile" | "status" | "staff" | "features" | "activity";

export default function PharmacyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(`/api/platform/pharmacies/${id}`);
  const [tab, setTab] = useState<Tab>("profile");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const p = data.pharmacy;
  return (
    <>
      <Link href="/platform/pharmacies" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden /> Pharmacies</Link>
      <PageHeader
        title={p.name}
        subtitle={`/p/${p.slug} · created ${formatDate(p.createdAt)}`}
        actions={<><StatusBadge status={p.status} /><SupportButton pharmacyId={p.id} pharmacyName={p.name} /></>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "profile", label: "Profile" }, { id: "status", label: "Status and plan" }, { id: "staff", label: `Staff (${data.staff.length})` }, { id: "features", label: "Features" }, { id: "activity", label: "Activity" }]} />
      {tab === "profile" && <ProfileTab detail={data} onSaved={reload} />}
      {tab === "status" && <StatusTab detail={data} onSaved={reload} />}
      {tab === "staff" && <StaffTab detail={data} />}
      {tab === "features" && <FeaturesTab detail={data} onSaved={reload} />}
      {tab === "activity" && <ActivityTab detail={data} />}
    </>
  );
}

function ProfileTab({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const toast = useToast();
  const p = detail.pharmacy;
  const initial = { name: p.name, legalName: p.legalName ?? "", address: p.address, city: p.city ?? "", phone: p.phone, whatsapp: p.whatsapp ?? "", email: p.email ?? "", licenseNumber: p.licenseNumber ?? "", taxNumber: p.taxNumber ?? "" };
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(initial), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api(`/api/platform/pharmacies/${p.id}`, { method: "PUT", body: f });
      toast.success("Profile saved");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name *" error={errors.name}><Input value={f.name} onChange={set("name")} required /></Field>
        <Field label="Legal name"><Input value={f.legalName} onChange={set("legalName")} /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="WhatsApp"><Input value={f.whatsapp} onChange={set("whatsapp")} /></Field>
        <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Drug sale licence number"><Input value={f.licenseNumber} onChange={set("licenseNumber")} /></Field>
        <Field label="Tax number"><Input value={f.taxNumber} onChange={set("taxNumber")} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={saving}>Save profile</Button></div>
      </form>
    </Card>
  );
}

function StaffTab({ detail }: { detail: Detail }) {
  if (!detail.staff.length) return <Card><EmptyState title="No staff accounts" /></Card>;
  return (
    <Card>
      <div className="flex justify-end border-b border-border px-4 py-2.5">
        <Link href={`/platform/accounts?pharmacyId=${detail.pharmacy.id}`} className="text-sm font-medium text-primary hover:underline">Manage these accounts</Link>
      </div>
      <TableWrap>
        <thead><tr className="border-b border-border"><th className="th">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th></tr></thead>
        <tbody>
          {detail.staff.map((u) => (
            <tr key={u.id} className="border-b border-border/60">
              <td className="td font-medium">{u.name}<span className="block text-xs text-fg-muted">{u.email}</span></td>
              <td className="td font-mono">{u.username}</td>
              <td className="td">{u.role.name}</td>
              <td className="td">{u.active ? (u.mustChangePassword ? <Badge tone="amber">Must change password</Badge> : <Badge tone="green">Active</Badge>) : <Badge>Inactive</Badge>}</td>
              <td className="td">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function FeaturesTab({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    try {
      await api(`/api/platform/pharmacies/${detail.pharmacy.id}/features`, { body: { key, enabled } });
      toast.success(enabled ? "Feature switched on" : "Feature switched off");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <ul className="divide-y divide-border">
        {detail.flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>{f.label}</span>
            <label className="inline-flex cursor-pointer items-center gap-2">
              {f.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
              <input type="checkbox" role="switch" aria-label={f.label} className="h-4 w-4" checked={f.enabled} disabled={busy === f.key} onChange={(e) => toggle(f.key, e.target.checked)} />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityTab({ detail }: { detail: Detail }) {
  if (!detail.audits.length) return <Card><EmptyState title="No activity yet" /></Card>;
  return (
    <Card>
      <TableWrap>
        <thead><tr className="border-b border-border"><th className="th">When</th><th className="th">By</th><th className="th">Action</th><th className="th">Record</th></tr></thead>
        <tbody>
          {detail.audits.map((a) => (
            <tr key={a.id} className="border-b border-border/60">
              <td className="td whitespace-nowrap">{formatDateTime(a.at)}</td>
              <td className="td">{a.realm === "PLATFORM" ? <Badge tone="blue">{a.supportSessionId ? "Platform support" : "Developer"}</Badge> : <Badge>Staff</Badge>}</td>
              <td className="td font-mono text-xs">{a.action}</td>
              <td className="td">{a.entity}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

const STATUS_HELP: Record<PharmacyStatus, string> = {
  ACTIVE: "Staff can sign in and work normally.",
  GRACE: "Staff can work, with a banner asking to renew the subscription.",
  SUSPENDED: "Staff are signed out and cannot sign in. Data is kept. You can still open the pharmacy.",
  DEACTIVATED: "The pharmacy has left the platform. Staff cannot sign in. Data is kept and can be reactivated.",
};

function StatusTab({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const toast = useToast();
  const p = detail.pharmacy;
  const [status, setStatus] = useState<PharmacyStatus>(p.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api(`/api/platform/pharmacies/${p.id}/status`, { body: { status, reason, code } });
      toast.success(`Status changed to ${STATUS_LABEL[status]}`);
      setReason("");
      setCode("");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Current status</h2>
        <div className="flex items-center gap-3"><StatusBadge status={p.status} /><span className="text-sm text-fg-muted">{STATUS_HELP[p.status]}</span></div>
        {p.statusReason && <p className="text-sm"><span className="text-fg-muted">Reason: </span>{p.statusReason}</p>}
        <PlanForm detail={detail} onSaved={onSaved} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Change status</h2>
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="New status" hint={STATUS_HELP[status]}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as PharmacyStatus)}>
              {(Object.keys(STATUS_LABEL) as PharmacyStatus[]).filter((k) => k !== p.status).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Reason *" error={errors.reason}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Subscription unpaid since 1 October" required /></Field>
          <Field label="Authenticator code *" hint="Confirms it is you" error={errors.code}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required className="w-40" /></Field>
          <Button type="submit" variant={status === "ACTIVE" || status === "GRACE" ? "primary" : "danger"} loading={saving}>Change to {STATUS_LABEL[status]}</Button>
        </form>
      </Card>
      <ExportCard pharmacyId={p.id} />
    </div>
  );
}

/** The pharmacy's data as a ZIP (roadmap 9.4): for a pharmacy that leaves, or on the owner's request. */
function ExportCard({ pharmacyId }: { pharmacyId: string }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await downloadPost(`/api/platform/pharmacies/${pharmacyId}/export`, { code }, "pharmacy-data.zip");
      setCode("");
      toast.success("The export is downloading");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="mb-1 font-semibold">Export data</h2>
      <p className="mb-4 text-sm text-fg-muted">Every record of this pharmacy as CSV files with an Excel summary, without passwords or sign-in secrets. Recorded in the activity history.</p>
      <form onSubmit={run} className="flex flex-wrap items-end gap-3" noValidate>
        <Field label="Authenticator code *" hint="Confirms it is you"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required className="w-40" /></Field>
        <Button type="submit" variant="secondary" loading={busy}>Download ZIP</Button>
      </form>
    </Card>
  );
}

/** Opens the pharmacy app as platform support (Pharmacy Admin rights, every action logged). */
function SupportButton({ pharmacyId, pharmacyName }: { pharmacyId: string; pharmacyName: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ redirect: string }>(`/api/platform/pharmacies/${pharmacyId}/support`, { body: { reason } });
      window.location.href = r.redirect;
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><LifeBuoy className="h-4 w-4" aria-hidden /> Open as support</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Open ${pharmacyName} as support`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="support-form" loading={busy}>Open pharmacy</Button></>}>
        <form id="support-form" onSubmit={start} className="space-y-3 text-sm">
          <p>You will use the pharmacy app with Pharmacy Admin rights for up to two hours. Every action is recorded as platform support and is visible to the pharmacy.</p>
          <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner asked for help importing stock" required data-autofocus /></Field>
        </form>
      </Modal>
    </>
  );
}

const OCR_READERS = [
  ["LOCAL", "On this computer (free, works offline, best on printed bills)"],
  ["CLOUD", "Cloud reader (better on handwriting; photos are sent to an outside service and need an API key on the server or desktop)"],
] as const;

function PlanForm({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const toast = useToast();
  const p = detail.pharmacy;
  const [f, setF] = useState({ plan: p.plan, maxUsers: String(p.maxUsers), ocrMonthlyLimit: String(p.ocrMonthlyLimit), ocrProviders: p.ocrProviders, subscriptionEndsAt: p.subscriptionEndsAt ? p.subscriptionEndsAt.slice(0, 10) : "" });
  const [saving, setSaving] = useState(false);
  const activeStaff = detail.staff.filter((s) => s.active).length;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/platform/pharmacies/${p.id}/plan`, { method: "PUT", body: f });
      toast.success("Plan saved");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 border-t border-border pt-4" noValidate>
      <h3 className="text-sm font-semibold">Plan and limits</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plan"><Input value={f.plan} onChange={(e) => setF((s) => ({ ...s, plan: e.target.value }))} /></Field>
        <Field label="Subscription ends" hint="Checked every night: after this day the pharmacy goes to grace, then is suspended. Extending it brings back a pharmacy the check moved."><Input type="date" value={f.subscriptionEndsAt} onChange={(e) => setF((s) => ({ ...s, subscriptionEndsAt: e.target.value }))} /></Field>
        <Field label="Max active staff" hint={`${activeStaff} active now`}><Input type="number" min={1} value={f.maxUsers} onChange={(e) => setF((s) => ({ ...s, maxUsers: e.target.value }))} /></Field>
        <Field label="OCR pages per month"><Input type="number" min={0} value={f.ocrMonthlyLimit} onChange={(e) => setF((s) => ({ ...s, ocrMonthlyLimit: e.target.value }))} /></Field>
      </div>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-medium">Photo readers allowed</legend>
        {OCR_READERS.map(([key, label]) => (
          <label key={key} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.ocrProviders.includes(key)} onChange={(e) => setF((s) => ({ ...s, ocrProviders: e.target.checked ? [...s.ocrProviders, key] : s.ocrProviders.filter((x) => x !== key) }))} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="secondary" loading={saving}>Save plan</Button>
    </form>
  );
}
