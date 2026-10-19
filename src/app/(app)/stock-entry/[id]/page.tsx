"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, RotateCw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Input, Modal, Select, Spinner, Textarea, cn, useToast } from "@/components/ui";
import { useCan, useMoney } from "@/components/app-context";
import { useShortcutHelp } from "@/components/shortcuts";
import { ApiError, api, useApi } from "@/lib/client";
import { COLUMNS, blankLine, fromApiLine, isEmptyLine, lineTotal, toApiLine, type Column, type GridLine } from "../grid";
import { MedicineCell, type CellMedicine } from "../medicine-cell";

type Issue = { line: number | null; field: string; message: string };
type Intake = {
  id: string; number: string; kind: "PURCHASE_BILL" | "STOCK_LIST"; source: "MANUAL" | "OCR" | "IMPORT";
  status: "DRAFT" | "UPLOADED" | "PROCESSING" | "NEEDS_REVIEW" | "POSTED" | "FAILED" | "DISCARDED";
  supplierId: string | null; supplierInvoice: string | null; billDate: string | null; billTotal: string | null; billDiscount: string; paid: string;
  paymentMethod: string | null; note: string | null; error: string | null; provider: string | null; updatedAt: string;
  pages: { pageNo: number; fileId: string }[]; lines: Parameters<typeof fromApiLine>[0][]; purchase: { id: string; number: string } | null;
  checks: { errors: Issue[]; warnings: Issue[]; linesTotal: string; total: string };
};
type Header = { supplierId: string; supplierInvoice: string; billDate: string; billTotal: string; billDiscount: string; paid: string; paymentMethod: string; note: string };

const COL_LABEL: Record<Column, string> = { medicine: "Medicine (F2)", batchNumber: "Batch", expiry: "Exp (MM/YY)", quantity: "Qty", bonusQty: "Bonus", rate: "Rate", discountPercent: "Disc%", taxAmount: "Tax", salePrice: "Sale price" };
const COL_FIELD: Partial<Record<Column, string>> = { medicine: "medicineId", expiry: "expiryDate" };
const MATCH_LABEL: Record<string, string> = { BARCODE: "barcode", SUPPLIER_CODE: "catalog", ALIAS: "learned", TRIGRAM: "similar name", MANUAL: "chosen" };
const LOW_CONFIDENCE = 0.8;
const STEPS = ["Uploaded", "Read", "Review", "Posted"];

/** The stock entry grid (architecture 6.1.1 and 6.1.2): typed, read from photos or imported, then posted. */
export default function StockEntryEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const money = useMoney();
  const canPost = useCan("stockEntry.post");
  const { data, error, reload } = useApi<Intake>(`/api/stock-entry/${id}`);
  const suppliers = useApi<{ items: { id: string; name: string }[] }>("/api/suppliers?active=1&pageSize=200");
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<GridLine[]>([]);
  const [checks, setChecks] = useState<Intake["checks"] | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error" | "idle">("idle");
  const [savedAt, setSavedAt] = useState<string>("");
  const [selected, setSelected] = useState(0);
  const [posting, setPosting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [creating, setCreating] = useState<{ row: number; name: string } | null>(null);
  const dirty = useRef(false);
  const grid = useRef<HTMLTableElement>(null);

  // load (and keep polling while OCR reads the photos)
  useEffect(() => {
    if (!data) return;
    setChecks(data.checks);
    if (!dirty.current) {
      setHeader({
        supplierId: data.supplierId ?? "", supplierInvoice: data.supplierInvoice ?? "", billDate: data.billDate?.slice(0, 10) ?? "",
        billTotal: data.billTotal ? String(Number(data.billTotal)) : "", billDiscount: Number(data.billDiscount) ? String(Number(data.billDiscount)) : "",
        paid: Number(data.paid) ? String(Number(data.paid)) : "", paymentMethod: data.paymentMethod ?? "CASH", note: data.note ?? "",
      });
      setLines(data.lines.length ? [...data.lines.map(fromApiLine), ...(editable(data.status) ? [blankLine()] : [])] : [blankLine()]);
    }
    if (data.status === "UPLOADED" || data.status === "PROCESSING") {
      const t = setTimeout(reload, 3000);
      return () => clearTimeout(t);
    }
  }, [data, reload]);

  const status = data?.status;
  const readOnly = !status || !editable(status);
  const busyReading = status === "UPLOADED" || status === "PROCESSING";

  const save = useCallback(async () => {
    if (!header || readOnly) return;
    setSaved("saving");
    try {
      const body = {
        supplierId: header.supplierId || null, supplierInvoice: header.supplierInvoice || null, billDate: header.billDate || null,
        billTotal: header.billTotal ? Number(header.billTotal) : null, billDiscount: Number(header.billDiscount) || 0, paid: Number(header.paid) || 0,
        paymentMethod: header.paymentMethod || null, note: header.note || null,
        lines: lines.filter((l) => !isEmptyLine(l)).map(toApiLine),
      };
      const r = await api<Intake>(`/api/stock-entry/${id}`, { method: "PUT", body });
      setChecks(r.checks);
      dirty.current = false;
      setSaved("saved");
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setSaved("error");
      toast.error((err as Error).message);
    }
  }, [header, lines, id, readOnly, toast]);

  // autosave a moment after the last change
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [header, lines, save]);

  const touch = () => { dirty.current = true; setSaved("idle"); };
  const setH = (patch: Partial<Header>) => { touch(); setHeader((h) => (h ? { ...h, ...patch } : h)); };
  const setLine = (row: number, patch: Partial<GridLine>) => {
    touch();
    setLines((ls) => {
      const next = ls.map((l, i) => (i === row ? { ...l, ...patch } : l));
      // there is always one empty row at the end to type into
      if (!isEmptyLine(next[next.length - 1])) next.push(blankLine());
      return next;
    });
  };

  const focusCell = (row: number, col: Column) => {
    setTimeout(() => grid.current?.querySelector<HTMLInputElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus(), 0);
  };

  function onGridKey(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: Column) {
    const c = COLUMNS.indexOf(col);
    if ((e.key === "Enter" && !e.ctrlKey) || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (c < COLUMNS.length - 1) focusCell(row, COLUMNS[c + 1]);
      else {
        if (row === lines.length - 1) setLines((ls) => [...ls, blankLine()]);
        focusCell(row + 1, COLUMNS[0]);
      }
    } else if (e.key === "Tab" && e.shiftKey && c > 0) {
      e.preventDefault();
      focusCell(row, COLUMNS[c - 1]);
    } else if (e.key === "ArrowDown" && col !== "medicine") {
      e.preventDefault();
      focusCell(Math.min(row + 1, lines.length - 1), col);
    } else if (e.key === "ArrowUp" && col !== "medicine") {
      e.preventDefault();
      focusCell(Math.max(row - 1, 0), col);
    } else if (e.key.toLowerCase() === "d" && e.ctrlKey && row > 0) {
      // copy the cell above (the same expiry on many lines)
      e.preventDefault();
      const above = lines[row - 1];
      setLine(row, col === "medicine" ? { medicine: above.medicine } : { [col]: above[col as Exclude<Column, "medicine">] } as Partial<GridLine>);
    } else if (e.key === "Delete" && isEmptyLine(lines[row]) && lines.length > 1) {
      e.preventDefault();
      touch();
      setLines((ls) => ls.filter((_, i) => i !== row));
      focusCell(Math.max(0, row - 1), col);
    }
  }

  // F2: the medicine cell of the current row; Ctrl+Enter: post
  useShortcutHelp([{ keys: "F2", label: "Go to the medicine cell" }, { keys: "Enter", label: "Next cell (a new row at the end)" }, { keys: "Ctrl+D", label: "Copy the cell above" }, { keys: "Ctrl+Enter", label: "Post the stock entry" }]);
  const postRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); focusCell(selected, "medicine"); }
      if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); postRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  async function post() {
    if (readOnly || posting) return;
    setPosting(true);
    try {
      await save();
      const r = await api<{ reference: string }>(`/api/stock-entry/${id}/post`, { body: {} });
      toast.success(`Posted as ${r.reference}`);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
      reload();
    } finally {
      setPosting(false);
    }
  }
  postRef.current = post;

  async function runAction(action: "discard" | "match" | "retry") {
    try {
      await save();
      await api(`/api/stock-entry/${id}/${action}`, { body: {} });
      dirty.current = false;
      if (action === "discard") router.push("/stock-entry");
      else reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const issuesFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of checks?.errors ?? []) if (e.line !== null) map.set(`${e.line}:${e.field}`, e.message);
    return map;
  }, [checks]);
  const lineNoOf = (row: number) => lines.slice(0, row + 1).filter((l) => !isEmptyLine(l)).length;

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !header) return <Spinner />;
  const bill = data.kind === "PURCHASE_BILL";
  const hasPhotos = data.pages.length > 0;
  const step = data.status === "POSTED" ? 3 : busyReading ? 0 : data.status === "FAILED" ? 1 : 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/stock-entry" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Stock entry</Link>
        <h1 className="text-xl font-semibold">{data.number}: {bill ? "Supplier bill" : "Stock list"}</h1>
        <StatusBadge status={data.status} />
        {data.source === "OCR" && <Steps active={step} />}
        <span className="ml-auto text-xs text-fg-muted" aria-live="polite">{readOnly ? "" : saved === "saving" ? "Saving..." : saved === "error" ? "Not saved" : savedAt ? `Draft saved ${savedAt}` : ""}</span>
      </div>

      {busyReading && <Card className="flex items-center gap-3 p-4 text-sm"><Spinner label="" /> Reading the photo. This usually takes under 30 seconds; you can leave this screen and come back.</Card>}
      {data.status === "FAILED" && (
        <Card className="flex flex-wrap items-center gap-3 border-amber-300 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
          <span>The photo could not be read{data.error ? `: ${data.error}` : "."} Type the lines below with the photo beside you, or try again.</span>
          {hasPhotos && <Button size="sm" variant="secondary" onClick={() => runAction("retry")}>Try reading again</Button>}
        </Card>
      )}
      {data.status === "POSTED" && data.purchase && <Card className="p-4 text-sm">Posted as purchase <Link className="text-primary hover:underline" href="/purchases">{data.purchase.number}</Link>.</Card>}

      <div className={cn("grid gap-4", hasPhotos && "xl:grid-cols-[minmax(320px,40%)_minmax(0,1fr)]")}>
        {hasPhotos && <PhotoPane pages={data.pages} box={lines[selected]?.boxes} />}
        <div className="min-w-0 space-y-4">
          <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {bill && <>
              <Field label="Supplier" error={checks?.errors.find((e) => e.field === "supplierId")?.message}>
                <Select value={header.supplierId} disabled={readOnly} onChange={(e) => setH({ supplierId: e.target.value })}>
                  <option value="">Choose...</option>
                  {suppliers.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Invoice no." error={checks?.errors.find((e) => e.field === "supplierInvoice")?.message}><Input value={header.supplierInvoice} disabled={readOnly} onChange={(e) => setH({ supplierInvoice: e.target.value })} /></Field>
              <Field label="Bill date"><Input type="date" value={header.billDate} disabled={readOnly} onChange={(e) => setH({ billDate: e.target.value })} /></Field>
              <Field label="Bill total" error={checks?.errors.find((e) => e.field === "billTotal") ? "Does not match the lines" : undefined}><Input inputMode="decimal" value={header.billTotal} disabled={readOnly} onChange={(e) => setH({ billTotal: e.target.value })} /></Field>
            </>}
            {!bill && <p className="text-sm text-fg-muted sm:col-span-2 lg:col-span-4">A stock list adds opening stock: no supplier, no bill and nothing owed.</p>}
          </Card>

          <Card className="overflow-x-auto">
            <table ref={grid} className="w-full text-sm" aria-label="Stock entry lines">
              <thead>
                <tr className="border-b border-border">
                  <th className="th w-8">#</th>
                  {COLUMNS.map((c) => <th key={c} className="th">{COL_LABEL[c]}</th>)}
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, row) => {
                  const n = lineNoOf(row);
                  const low = l.confidence !== null && l.confidence < LOW_CONFIDENCE;
                  const err = (field: string) => (!isEmptyLine(l) ? issuesFor.get(`${n}:${field}`) : undefined);
                  const total = lineTotal(l);
                  return (
                    <tr key={l.key} className={cn("border-b border-border/60 align-top", row === selected && "bg-brand-50/50 dark:bg-slate-800/50", l.ignored && "opacity-40")} onFocus={() => setSelected(row)}>
                      <td className="td text-fg-muted">{isEmptyLine(l) ? "" : n}</td>
                      {COLUMNS.map((col) => (
                        <td key={col} className={cn("px-1 py-1", low && l.rawText && "bg-amber-50 dark:bg-amber-950/40")} title={col === "medicine" && l.rawText ? `Read: ${l.rawText}` : undefined}>
                          {col === "medicine" ? (
                            <div>
                              <MedicineCell data-row={row} data-col={col} value={l.medicine as CellMedicine | null} printed={l.name} invalid={!!err("medicineId")} disabled={readOnly}
                                onPick={(m) => setLine(row, { medicine: m, matchMethod: "MANUAL", salePrice: l.salePrice || (m.salePrice ? String(Number(m.salePrice)) : ""), rate: l.rate || (bill && m.purchasePrice ? String(Number(m.purchasePrice)) : "") })}
                                onCreate={(name) => setCreating({ row, name })} onGridKey={(e) => onGridKey(e, row, col)} />
                              {l.matchMethod && l.medicine && <span className="text-[10px] text-fg-muted">{MATCH_LABEL[l.matchMethod] ?? l.matchMethod}{l.name && l.matchMethod !== "MANUAL" ? `: ${l.name}` : ""}</span>}
                            </div>
                          ) : (
                            <input data-row={row} data-col={col} disabled={readOnly} aria-label={`${COL_LABEL[col]}, line ${n || row + 1}`} aria-invalid={!!err(COL_FIELD[col] ?? col) || undefined}
                              inputMode={col === "batchNumber" || col === "expiry" ? "text" : "decimal"} autoComplete="off"
                              className={cn("w-full rounded border bg-surface px-2 py-1 text-sm", col === "batchNumber" ? "min-w-[90px]" : "min-w-[64px]", err(COL_FIELD[col] ?? col) ? "border-danger" : "border-border")}
                              value={l[col]} onChange={(e) => setLine(row, { [col]: e.target.value } as Partial<GridLine>)} onKeyDown={(e) => onGridKey(e, row, col)} />
                          )}
                        </td>
                      ))}
                      <td className="td whitespace-nowrap text-right">
                        {total !== null ? money(total) : ""}
                        {!isEmptyLine(l) && !readOnly && (
                          <button type="button" className="ml-2 align-middle text-fg-muted hover:text-danger" aria-label={l.ignored ? `Use line ${n} again` : `Leave line ${n} out`} title={l.ignored ? "Use this line" : "Leave this line out"} onClick={() => setLine(row, { ignored: !l.ignored })}>
                            {l.ignored ? <Check className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-2 text-sm">
              {checks?.errors.map((e, i) => <p key={`e${i}`} className="flex gap-2 text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{e.message}</p>)}
              {checks?.warnings.map((w, i) => <p key={`w${i}`} className="flex gap-2 text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w.message}</p>)}
              {checks && !checks.errors.length && !checks.warnings.length && <p className="flex gap-2 text-success"><Check className="h-4 w-4" aria-hidden /> Ready to post.</p>}
              {bill && <Field label="Note (reason for a difference from the bill total, delivery charges...)"><Textarea rows={2} value={header.note} disabled={readOnly} onChange={(e) => setH({ note: e.target.value })} /></Field>}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Lines total</span><b>{money(checks?.linesTotal ?? 0)}</b></div>
              {bill && <>
                <div className="flex items-center justify-between gap-2"><span>Bill discount</span><Input className="w-28 text-right" inputMode="decimal" value={header.billDiscount} disabled={readOnly} onChange={(e) => setH({ billDiscount: e.target.value })} /></div>
                <div className="flex justify-between"><span>Total</span><b>{money(checks?.total ?? 0)}</b></div>
                {header.billTotal && <div className="flex justify-between"><span>Bill total</span><span>{money(header.billTotal)}</span></div>}
                <div className="flex items-center justify-between gap-2"><span>Paid now</span><span className="flex gap-1"><Select className="w-24" value={header.paymentMethod} disabled={readOnly} onChange={(e) => setH({ paymentMethod: e.target.value })}><option value="CASH">Cash</option><option value="CARD">Card</option></Select><Input className="w-28 text-right" inputMode="decimal" value={header.paid} disabled={readOnly} onChange={(e) => setH({ paid: e.target.value })} /></span></div>
              </>}
              {!readOnly && (
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setDiscarding(true)}>Discard</Button>
                  {lines.some((x) => !x.medicine && (x.name || x.rawText)) && <Button variant="secondary" onClick={() => runAction("match")}>Match names</Button>}
                  <Button onClick={post} loading={posting} disabled={!canPost || !!checks?.errors.length} title={canPost ? "Ctrl+Enter" : "Posting needs a pharmacist or admin"}>{bill ? "Post stock" : "Add to stock as opening balance"}</Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {discarding && <ConfirmDialog open danger title="Discard this stock entry" message="Nothing is added to stock. The entry stays in the list as discarded." confirmLabel="Discard" onConfirm={() => runAction("discard")} onClose={() => setDiscarding(false)} />}
      {creating && <NewMedicineDialog name={creating.name} onClose={() => setCreating(null)} onCreated={(m) => { setLine(creating.row, { medicine: m, matchMethod: "MANUAL", salePrice: m.salePrice ? String(Number(m.salePrice)) : "" }); setCreating(null); focusCell(creating.row, "batchNumber"); }} />}
    </div>
  );
}

const editable = (s: Intake["status"]) => s === "DRAFT" || s === "NEEDS_REVIEW" || s === "FAILED";

function StatusBadge({ status }: { status: Intake["status"] }) {
  const map: Record<Intake["status"], [string, "slate" | "blue" | "amber" | "green" | "red"]> = {
    DRAFT: ["Draft", "slate"], UPLOADED: ["Uploaded", "blue"], PROCESSING: ["Reading", "blue"], NEEDS_REVIEW: ["Needs review", "amber"],
    POSTED: ["Posted", "green"], FAILED: ["Could not read", "red"], DISCARDED: ["Discarded", "slate"],
  };
  return <Badge tone={map[status][1]}>{map[status][0]}</Badge>;
}

function Steps({ active }: { active: number }) {
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Progress">
      {STEPS.map((s, i) => <li key={s} className={cn("rounded-full px-2 py-0.5", i <= active ? "bg-primary text-on-primary" : "bg-muted text-fg-muted")} aria-current={i === active ? "step" : undefined}>{s}</li>)}
    </ol>
  );
}

/** The photo beside the grid; the selected row's region is outlined (boxes are fractions of the page). */
function PhotoPane({ pages, box }: { pages: { pageNo: number; fileId: string }[]; box: unknown }) {
  const b = box as { page?: number; x?: number; y?: number; w?: number; h?: number } | null;
  const [page, setPage] = useState(pages[0].pageNo);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  useEffect(() => { if (b?.page && b.page !== page) setPage(b.page); }, [b?.page, page]);
  const current = pages.find((p) => p.pageNo === page) ?? pages[0];
  return (
    <Card className="flex max-h-[80vh] flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-border p-2">
        {pages.length > 1 && pages.map((p) => <Button key={p.pageNo} size="sm" variant={p.pageNo === page ? "primary" : "ghost"} onClick={() => setPage(p.pageNo)}>Page {p.pageNo}</Button>)}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" aria-label="Rotate" onClick={() => setTurn((t) => (t + 90) % 360)}><RotateCw className="h-4 w-4" /></Button>
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-muted p-2">
        <div className="relative mx-auto origin-top" style={{ width: `${zoom * 100}%`, transform: `rotate(${turn}deg)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded bill photo from our file route */}
          <img src={`/api/files/${current.fileId}`} alt={`Page ${current.pageNo} of the bill`} className="block w-full" />
          {b && b.page === current.pageNo && typeof b.x === "number" && (
            <div aria-hidden className="pointer-events-none absolute rounded border-2 border-primary bg-primary/10" style={{ left: `${b.x * 100}%`, top: `${(b.y ?? 0) * 100}%`, width: `${(b.w ?? 0) * 100}%`, height: `${(b.h ?? 0) * 100}%` }} />
          )}
        </div>
      </div>
    </Card>
  );
}

/** Adds an unknown medicine without leaving the bill. */
function NewMedicineDialog({ name, onClose, onCreated }: { name: string; onClose: () => void; onCreated: (m: CellMedicine) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name, genericName: "", unit: "Pack", salePrice: "", barcode: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api<{ id: string; name: string; salePrice: string }>("/api/medicines", {
        body: { name: f.name, genericName: f.genericName || null, unit: f.unit, salePrice: Number(f.salePrice) || 0, purchasePrice: 0, barcode: f.barcode || null, sku: null, minStock: 0, prescriptionRequired: false, description: null, active: true },
      });
      toast.success(`${m.name} added`);
      onCreated(m);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="New medicine" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-med" loading={busy}>Add medicine</Button></>}>
      <form id="new-med" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-autofocus /></Field>
        <Field label="Generic name"><Input value={f.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} /></Field>
        <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Sale price" error={errors.salePrice}><Input inputMode="decimal" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} required /></Field>
        <Field label="Barcode" error={errors.barcode}><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
