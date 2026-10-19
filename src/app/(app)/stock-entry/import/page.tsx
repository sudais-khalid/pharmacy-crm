"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { Button, Card, Field, PageHeader, Select, TableWrap, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { expiryToIso } from "../grid";
import { TARGETS, guessMapping, parseCsv, type Target } from "../import-map";

type Kind = "STOCK_LIST" | "PURCHASE_BILL";

/** Excel or CSV import into a stock entry draft, with a column mapping step (task 4.5). */
export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("STOCK_LIST");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<(Target | "")[]>([]);
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    try {
      let data: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/universal");
        const sheet = await readSheet(file);
        data = sheet.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? "" : String(c))));
      } else {
        data = parseCsv(await file.text());
      }
      if (data.length < 2) throw new Error("The file needs a heading row and at least one line.");
      setRows(data);
      setFileName(file.name);
      setMapping(guessMapping(data[0]));
    } catch (err) {
      toast.error((err as Error).message || "This file could not be read. Use .xlsx or .csv.");
    }
  }

  const value = (row: string[], t: Target) => {
    const i = mapping.indexOf(t);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };
  const num = (v: string) => (v === "" ? null : Number(v.replace(/[,\s]/g, "")));

  async function create() {
    if (!rows) return;
    if (!mapping.includes("name") && !mapping.includes("barcode")) return toast.error("Choose the column with the medicine name or barcode.");
    if (!mapping.includes("quantity")) return toast.error("Choose the column with the quantity.");
    setBusy(true);
    try {
      const lines = rows.slice(1).map((r) => {
        const name = value(r, "name");
        const barcode = value(r, "barcode");
        const exp = value(r, "expiry");
        return {
          rawText: [barcode, name].filter(Boolean).join(" ") || null, name: name || barcode || null, batchNumber: value(r, "batchNumber") || null,
          expiryDate: exp ? expiryToIso(exp) ?? (/^\d{4}-\d{2}-\d{2}/.test(exp) ? exp.slice(0, 10) : null) : null,
          quantity: num(value(r, "quantity")) !== null ? Math.round(num(value(r, "quantity"))!) : null, bonusQty: num(value(r, "bonusQty")),
          rate: num(value(r, "rate")), discountPercent: num(value(r, "discountPercent")), taxAmount: num(value(r, "taxAmount")), salePrice: num(value(r, "salePrice")),
        };
      }).filter((l) => l.name);
      if (lines.length > 2000) throw new Error("At most 2,000 lines per stock entry. Split the file.");
      const intake = await api<{ id: string }>("/api/stock-entry", { body: { kind, source: "IMPORT" } });
      await api(`/api/stock-entry/${intake.id}`, { method: "PUT", body: { lines, note: `Imported from ${fileName}` } });
      await api(`/api/stock-entry/${intake.id}/match`, { body: {} });
      router.push(`/stock-entry/${intake.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Import stock from a file" subtitle="Excel (.xlsx) or CSV with a heading row. You will check every line before it is added." />
      <Card className="grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
        <Field label="What is in the file">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="STOCK_LIST">Opening stock or a stock count</option>
            <option value="PURCHASE_BILL">A supplier bill</option>
          </Select>
        </Field>
        <Field label="File">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> {fileName || "Choose a file"}
            <input type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
          </label>
        </Field>
      </Card>

      {rows && (
        <Card className="mt-4">
          <p className="border-b border-border p-4 text-sm">{rows.length - 1} line(s). Check which column holds what; columns set to &quot;Not used&quot; are ignored.</p>
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                {rows[0].map((h, i) => (
                  <th key={i} className="th">
                    <span className="block normal-case">{h || `Column ${i + 1}`}</span>
                    <Select aria-label={`Column ${h || i + 1} holds`} className="mt-1 min-w-[130px]" value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, k) => (k === i ? (e.target.value as Target | "") : x === e.target.value ? "" : x)))}>
                      <option value="">Not used</option>
                      {TARGETS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}
                    </Select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1, 11).map((r, i) => <tr key={i} className="border-b border-border/60">{rows[0].map((_, k) => <td key={k} className={mapping[k] ? "td" : "td text-fg-muted"}>{r[k]}</td>)}</tr>)}
            </tbody>
          </TableWrap>
          <div className="flex justify-end p-4"><Button onClick={create} loading={busy}>Create the stock entry</Button></div>
        </Card>
      )}
    </>
  );
}
