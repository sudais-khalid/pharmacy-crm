"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Camera, Crop, ImagePlus, RotateCcw, RotateCw, Trash2, Upload } from "lucide-react";
import { Button, Card, PageHeader, cn, useToast } from "@/components/ui";

type Kind = "PURCHASE_BILL" | "STOCK_LIST";
type Area = { x: number; y: number; w: number; h: number }; // fractions of the picture
type PageItem = { key: string; file: File; url: string; turn: number; crop: Area | null };
const LONGEST = 2000;

/** Applies rotation and crop, fits the longest side into 2000 px and re-encodes as JPEG (which drops EXIF data such as location). */
async function prepare(p: PageItem): Promise<Blob> {
  const bitmap = await createImageBitmap(p.file, { imageOrientation: "from-image" });
  const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * bitmap.width);
  const sy = Math.round(c.y * bitmap.height);
  const sw = Math.max(1, Math.round(c.w * bitmap.width));
  const sh = Math.max(1, Math.round(c.h * bitmap.height));
  const scale = Math.min(1, LONGEST / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const sideways = p.turn % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;
  const g = canvas.getContext("2d")!;
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate((p.turn * Math.PI) / 180);
  g.drawImage(bitmap, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Could not prepare the photo."))), "image/jpeg", 0.85));
}

/** Phone-first photo upload for a supplier bill or a stock list (task 4.9). */
function UploadInner() {
  const router = useRouter();
  const toast = useToast();
  const initial = useSearchParams().get("kind");
  const [kind, setKind] = useState<Kind | null>(initial === "PURCHASE_BILL" || initial === "STOCK_LIST" ? initial : null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [cropping, setCropping] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), [pages]);

  const add = (files: FileList | null) => {
    if (!files) return;
    setPages((ps) => [...ps, ...Array.from(files).filter((f) => f.type.startsWith("image/")).map((file) => ({ key: `${file.name}-${Math.random()}`, file, url: URL.createObjectURL(file), turn: 0, crop: null }))].slice(0, 10));
  };
  const update = (key: string, patch: Partial<PageItem>) => setPages((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => setPages((ps) => {
    const next = [...ps];
    const [p] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, p);
    return next;
  });

  async function upload() {
    if (!kind || !pages.length) return;
    try {
      setProgress(0);
      const form = new FormData();
      form.append("kind", kind);
      for (const [i, p] of pages.entries()) form.append("page", await prepare(p), `page-${i + 1}.jpg`);
      const result = await new Promise<{ id: string; duplicate: boolean }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/stock-entry/upload");
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error ?? "Upload failed"));
        };
        xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
        xhr.send(form);
      });
      if (result.duplicate) toast.info("These photos were uploaded before; opening that stock entry.");
      router.push(`/stock-entry/${result.id}`);
    } catch (err) {
      setProgress(null);
      toast.error((err as Error).message);
    }
  }

  if (!kind) {
    return (
      <>
        <PageHeader title="Photo stock entry" subtitle="What are you photographing?" />
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <button type="button" className="card p-5 text-left hover:border-primary" onClick={() => setKind("PURCHASE_BILL")}><b>A supplier bill</b><span className="block text-sm text-fg-muted">The bill that came with the goods.</span></button>
          <button type="button" className="card p-5 text-left hover:border-primary" onClick={() => setKind("STOCK_LIST")}><b>A stock list</b><span className="block text-sm text-fg-muted">A written or printed list of what is on the shelves.</span></button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={kind === "PURCHASE_BILL" ? "Photo of a supplier bill" : "Photo of a stock list"} subtitle="Flat surface, good light, the whole page in view. Add a photo for every page." />
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary">
          <Camera className="h-4 w-4" aria-hidden /> Take a photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium">
          <ImagePlus className="h-4 w-4" aria-hidden /> Choose pictures
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((p, i) => (
          <li key={p.key}>
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
                <b>Page {i + 1}</b>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === pages.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Rotate left" onClick={() => update(p.key, { turn: (p.turn + 270) % 360 })}><RotateCcw className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Rotate right" onClick={() => update(p.key, { turn: (p.turn + 90) % 360 })}><RotateCw className="h-4 w-4" /></Button>
                  <Button size="sm" variant={cropping === p.key ? "primary" : "ghost"} aria-label="Crop" onClick={() => setCropping(cropping === p.key ? null : p.key)}><Crop className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove page ${i + 1}`} onClick={() => setPages((ps) => ps.filter((x) => x.key !== p.key))}><Trash2 className="h-4 w-4 text-danger" /></Button>
                </span>
              </div>
              <CropView page={p} active={cropping === p.key} onCrop={(crop) => update(p.key, { crop })} />
              {cropping === p.key && <p className="px-3 py-2 text-xs text-fg-muted">Drag across the picture to keep only the bill. {p.crop && <button type="button" className="text-primary hover:underline" onClick={() => update(p.key, { crop: null })}>Use the whole picture</button>}</p>}
            </Card>
          </li>
        ))}
      </ol>

      {pages.length > 0 && (
        <div className="mt-4 max-w-xl space-y-2">
          {progress !== null ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="text-sm text-fg-muted">Uploading {progress}%. After the upload, reading usually takes under 30 seconds and you can leave the screen; a notification says when it is ready.</p>
            </>
          ) : (
            <Button onClick={upload}><Upload className="h-4 w-4" aria-hidden /> Upload {pages.length} page{pages.length > 1 ? "s" : ""}</Button>
          )}
        </div>
      )}
    </>
  );
}

/** The picture with its rotation; while cropping, a dragged rectangle chooses the part to keep. */
function CropView({ page, active, onCrop }: { page: PageItem; active: boolean; onCrop: (a: Area | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Area | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const area = live ?? page.crop;
  return (
    <div className="bg-muted p-2">
      <div ref={box} className={cn("relative mx-auto touch-none select-none", active && "cursor-crosshair")} style={{ transform: active ? undefined : `rotate(${page.turn}deg)` }}
        onPointerDown={(e) => { if (!active) return; (e.target as Element).setPointerCapture(e.pointerId); setDrag(at(e)); }}
        onPointerMove={(e) => { if (!drag) return; const p = at(e); setLive({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }); }}
        onPointerUp={() => { if (live && live.w > 0.05 && live.h > 0.05) onCrop(live); setDrag(null); setLive(null); }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen photo */}
        <img src={page.url} alt="" className="block max-h-80 w-full object-contain" draggable={false} />
        {area && <div aria-hidden className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.w * 100}%`, height: `${area.h * 100}%` }} />}
      </div>
    </div>
  );
}

export default function UploadPage() {
  return <Suspense><UploadInner /></Suspense>;
}
