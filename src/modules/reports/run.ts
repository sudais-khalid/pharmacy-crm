import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayStr } from "@/lib/dates";
import { D } from "@/lib/money";
import { COST_FIELDS } from "@/lib/cost-fields";
import { can, type ServiceContext } from "@/modules/identity";
import { REPORTS, reportById, type Column, type Result } from "./registry";

export type ReportOutput = Omit<Result, "sumKeys"> & { type: string; title: string; from: string; to: string; ranged: boolean; totals: Record<string, string> | null };

/** The reports this person may open, for the Reports screen's list. */
export function availableReports(ctx: ServiceContext) {
  const seesCost = can(ctx.actor, "cost.view");
  return REPORTS.filter((r) => (!r.costReport || seesCost) && (!r.needs || can(ctx.actor, r.needs))).map(({ id, title, group, ranged, grouped }) => ({ id, title, group, ranged, grouped: !!grouped }));
}

/** Runs a report for a range; cost columns leave without cost.view, and cost reports refuse. */
export async function runReport(ctx: ServiceContext, id: string, input: { from?: string | null; to?: string | null; unit?: string | null }): Promise<ReportOutput> {
  const def = reportById(id);
  if (!def) throw new AppError(400, "Unknown report.");
  const seesCost = can(ctx.actor, "cost.view");
  if (def.costReport && !seesCost) throw new AppError(403, "This report shows cost prices, which your role cannot see.");
  if (def.needs && !can(ctx.actor, def.needs)) throw new AppError(403, "This report needs permission to see expenses and net profit.");
  const today = todayStr();
  const from = input.from || `${today.slice(0, 8)}01`;
  const to = input.to || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(400, "Dates must be YYYY-MM-DD.");
  if (from > to) throw new AppError(400, "'From' date must not be after 'To' date.");
  const unit = input.unit === "month" ? "month" : "day";
  const result = await runInTx(ctx, (tx) => def.run(tx, { from, to, unit, pharmacyId: ctx.pharmacyId }));
  let columns = result.columns;
  let sumKeys = result.sumKeys;
  if (!seesCost) {
    columns = columns.filter((c) => !COST_FIELDS.has(c.key));
    sumKeys = sumKeys?.filter((k) => !COST_FIELDS.has(k));
  }
  let totals: Record<string, string> | null = null;
  if (sumKeys && result.rows.length) {
    totals = {};
    for (const k of sumKeys) totals[k] = result.rows.reduce<Prisma.Decimal>((s, row) => s.plus(D((row[k] as Prisma.Decimal.Value) ?? 0)), D(0)).toString();
  }
  return { type: id, title: def.title + (def.grouped ? (unit === "month" ? " (monthly)" : " (daily)") : ""), from, to, ranged: def.ranged, description: result.description, columns, rows: result.rows, totals, comparison: result.comparison ?? null };
}

/** The report as an Excel workbook: the pharmacy's name, the report and its range on top, numbers as numbers. */
export async function reportWorkbook(report: ReportOutput, shop: { pharmacyName: string; currency: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = shop.pharmacyName;
  const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\/?*[\]:]/g, " "));
  ws.addRow([shop.pharmacyName]).font = { bold: true, size: 14 };
  ws.addRow([report.title]).font = { bold: true, size: 12 };
  ws.addRow([report.ranged ? `${report.from} to ${report.to}` : `As of ${todayStr()}`]);
  ws.addRow([report.description]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(report.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } }; });
  const value = (c: Column, v: unknown) => (v === null || v === undefined || v === "" ? null : c.format === "money" || c.format === "int" || c.format === "percent" ? Number(v) : c.format === "date" ? String(v).slice(0, 10) : String(v));
  for (const row of report.rows) ws.addRow(report.columns.map((c) => value(c, row[c.key])));
  if (report.totals) {
    const t = ws.addRow(report.columns.map((c, i) => (i === 0 ? "Total" : report.totals![c.key] !== undefined ? Number(report.totals![c.key]) : null)));
    t.font = { bold: true };
  }
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, Math.min(40, c.label.length + 4, ...report.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2)));
    if (c.format === "money") col.numFmt = `"${shop.currency} "#,##0.00`;
    if (c.format === "int") col.numFmt = "#,##0";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
