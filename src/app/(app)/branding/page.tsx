"use client";
import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Pill, Trash2 } from "lucide-react";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/client";
import { brandColorProblem, onColor, palette, parseHex, toHex } from "@/lib/brand";

type Profile = {
  pharmacyName: string; legalName: string; address: string; city: string; phone: string; whatsapp: string; email: string;
  licenseNumber: string; taxNumber: string; receiptHeader: string; invoiceFooter: string; brandColor: string | null;
  logoFileId: string | null; logoIconFileId: string | null;
};
const DEFAULT_COLOR = "#1F7F78";

/** Fits a picture into a square of `size` pixels on a transparent background and returns a PNG. */
async function squarePng(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.max(w, h, 64);
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Could not read the picture."))), "image/png"));
}

/** The pharmacy's profile and branding (task 3.6), with a live preview of the header, a button and a receipt. */
export default function BrandingPage() {
  const toast = useToast();
  const { data, error, reload } = useApi<Profile>("/api/branding");
  const [f, setF] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);

  const color = f?.brandColor || DEFAULT_COLOR;
  const problem = f?.brandColor ? brandColorProblem(f.brandColor) : null;
  const shades = useMemo(() => {
    const c = parseHex(color);
    return c && !brandColorProblem(color) ? palette(c) : palette(parseHex(DEFAULT_COLOR)!);
  }, [color]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!f) return <Spinner />;
  const set = (k: keyof Profile, v: string) => setF({ ...f, [k]: v });
  const logoSrc = preview ?? (f.logoFileId ? `/api/files/${f.logoFileId}` : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const { logoFileId: _l, logoIconFileId: _i, ...body } = f!;
      await api("/api/branding", { method: "PUT", body });
      toast.success("Saved. Reloading to apply the new look.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const [logo, icon] = await Promise.all([squarePng(file, 512), squarePng(file, 128)]);
      const form = new FormData();
      form.append("logo", logo, "logo.png");
      form.append("icon", icon, "icon.png");
      const res = await fetch("/api/branding/logo", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setPreview(URL.createObjectURL(logo));
      setF({ ...f!, logoFileId: body.logoFileId, logoIconFileId: body.logoIconFileId });
      toast.success("Logo saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    try {
      await api("/api/branding/logo", { method: "DELETE" });
      setPreview(null);
      setF({ ...f!, logoFileId: null, logoIconFileId: null });
      toast.success("Logo removed");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;
  return (
    <>
      <PageHeader title="Profile & branding" subtitle="How the pharmacy appears in the app, on its sign-in page and on receipts." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={save} className="space-y-4">
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Pharmacy</h2>
            <Field label="Name" error={errors.pharmacyName}><Input value={f.pharmacyName} onChange={(e) => set("pharmacyName", e.target.value)} required /></Field>
            <Field label="Registered name" hint="If different, printed under the name"><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="WhatsApp"><Input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Drug sale licence number"><Input value={f.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} /></Field>
            <Field label="Tax number (NTN/STRN)"><Input value={f.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} /></Field>
          </Card>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Receipts</h2>
            <Field label="Header line" hint="For example opening hours or a slogan" className="sm:col-span-2"><Input value={f.receiptHeader} onChange={(e) => set("receiptHeader", e.target.value)} maxLength={200} /></Field>
            <Field label="Footer line" className="sm:col-span-2"><Input value={f.invoiceFooter} onChange={(e) => set("invoiceFooter", e.target.value)} maxLength={250} /></Field>
          </Card>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Look</h2>
            <Field label="Brand colour" error={errors.brandColor ?? problem ?? undefined} hint="Buttons, the menu and receipts use it. It must be dark enough to read on white.">
              <span className="flex gap-2">
                <input type="color" aria-label="Pick a colour" value={parseHex(color) ? toHex(parseHex(color)!) : DEFAULT_COLOR} onChange={(e) => set("brandColor", e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded border border-border bg-surface" />
                <Input value={f.brandColor ?? ""} placeholder={DEFAULT_COLOR} onChange={(e) => set("brandColor", e.target.value)} className="font-mono" />
              </span>
            </Field>
            <Field label="Logo" hint="PNG, JPG or WebP. It is resized here before it is sent.">
              <span className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                  <ImagePlus className="h-4 w-4" aria-hidden /> {uploading ? "Saving..." : f.logoFileId ? "Change logo" : "Choose logo"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                {f.logoFileId && <Button size="sm" variant="ghost" onClick={removeLogo} aria-label="Remove logo"><Trash2 className="h-4 w-4 text-danger" /></Button>}
              </span>
            </Field>
          </Card>
          <Button type="submit" loading={saving} disabled={!!problem}>Save profile</Button>
        </form>

        <aside aria-label="Preview" className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview of the chosen logo */}
              {logoSrc ? <img src={logoSrc} alt="" className="h-8 w-8 rounded-lg object-contain" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: rgb(shades[600]), color: rgb(onColor(shades[600])) }}><Pill className="h-4 w-4" aria-hidden /></span>}
              <span className="truncate font-semibold">{f.pharmacyName}</span>
            </div>
            <div className="space-y-2 p-3">
              <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: rgb(shades[600]), color: rgb(onColor(shades[600])) }}>Menu item, selected</div>
              <button type="button" className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: rgb(shades[600]), color: rgb(onColor(shades[600])) }}>Complete sale</button>
              <p className="text-sm" style={{ color: rgb(shades[700]) }}>A link in the brand colour</p>
            </div>
          </Card>
          <Card className="bg-white p-4 text-center text-xs text-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview of the chosen logo */}
            {logoSrc && <img src={logoSrc} alt="" className="mx-auto mb-1 h-12 w-12 object-contain" />}
            <p className="text-sm font-bold">{f.pharmacyName}</p>
            <p>{[f.address, f.city].filter(Boolean).join(", ")}</p>
            <p>{f.phone}</p>
            {f.licenseNumber && <p>Drug licence {f.licenseNumber}</p>}
            {f.receiptHeader && <p className="mt-1 font-medium" style={{ color: rgb(shades[700]) }}>{f.receiptHeader}</p>}
            <div className="my-2 border-t border-dashed border-slate-400" />
            <p className="flex justify-between"><span>Panadol 500mg x 2</span><span>100.00</span></p>
            <div className="my-2 border-t border-dashed border-slate-400" />
            <p>{f.invoiceFooter}</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
