"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, TableWrap, Tabs, useToast } from "@/components/ui";
import { ApiError, api, formatDate, formatDateTime, useApi } from "@/lib/client";
import { StatusBadge, type PharmacyStatus } from "../../status-badge";

type Detail = {
  pharmacy: {
    id: string; slug: string; name: string; legalName: string | null; address: string; city: string | null; phone: string; whatsapp: string | null;
    email: string | null; licenseNumber: string | null; taxNumber: string | null; status: PharmacyStatus; statusReason: string | null; plan: string;
    subscriptionEndsAt: string | null; maxUsers: number; ocrMonthlyLimit: number; createdAt: string;
  };
  staff: { id: string; name: string; username: string; email: string; role: string; active: boolean; lastLoginAt: string | null; mustChangePassword: boolean }[];
  flags: { key: string; label: string; enabled: boolean }[];
  audits: { id: string; at: string; realm: "STAFF" | "PLATFORM"; actorId: string | null; action: string; entity: string; supportSessionId: string | null }[];
  supportSessions: { id: string; reason: string; startedAt: string; endedAt: string | null }[];
};

type Tab = "profile" | "staff" | "features" | "activity";

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
      <PageHeader title={p.name} subtitle={`/p/${p.slug} · created ${formatDate(p.createdAt)}`} actions={<StatusBadge status={p.status} />} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "profile", label: "Profile" }, { id: "staff", label: `Staff (${data.staff.length})` }, { id: "features", label: "Features" }, { id: "activity", label: "Activity" }]} />
      {tab === "profile" && <ProfileTab detail={data} onSaved={reload} />}
      {tab === "staff" && <StaffTab detail={data} />}
      {tab === "features" && <FeaturesTab detail={data} />}
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
      <TableWrap>
        <thead><tr className="border-b border-border"><th className="th">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th></tr></thead>
        <tbody>
          {detail.staff.map((u) => (
            <tr key={u.id} className="border-b border-border/60">
              <td className="td font-medium">{u.name}<span className="block text-xs text-fg-muted">{u.email}</span></td>
              <td className="td font-mono">{u.username}</td>
              <td className="td">{u.role === "ADMIN" ? "Pharmacy Admin" : u.role === "PHARMACIST" ? "Pharmacist" : "Cashier"}</td>
              <td className="td">{u.active ? (u.mustChangePassword ? <Badge tone="amber">Must change password</Badge> : <Badge tone="green">Active</Badge>) : <Badge>Inactive</Badge>}</td>
              <td className="td">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function FeaturesTab({ detail }: { detail: Detail }) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {detail.flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{f.label}</span>
            {f.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
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
