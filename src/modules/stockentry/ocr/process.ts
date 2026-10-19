import type { Prisma } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { addUsage, audit, getFeatureFlags, notify, readUsage } from "@/modules/platform";
import { autoMatch } from "../service";
import { cloudProvider } from "./cloud";
import { localProvider } from "./local";
import { parseDocument } from "./parse";
import type { OcrProvider } from "./types";

/**
 * The OCR pipeline in the worker (architecture, section 6.1.2): an uploaded entry is claimed, its photos
 * read by the pharmacy's provider, parsed, matched to medicines and left NEEDS_REVIEW for a person. OCR
 * never posts stock or money. A failure leaves the entry FAILED with the photos, so it can be retried or
 * typed in by hand beside them.
 */
export const usageKey = (d = new Date()) => `USAGE_OCR_${d.toISOString().slice(0, 7).replace("-", "")}` as const;

type Providers = { LOCAL?: OcrProvider; CLOUD?: OcrProvider };
export function defaultProviders(): Providers {
  return { LOCAL: localProvider, ...(process.env.ANTHROPIC_API_KEY ? { CLOUD: cloudProvider(process.env.ANTHROPIC_API_KEY) } : {}) };
}

/** Picks the next uploaded entry (any pharmacy) and marks it PROCESSING. Entries stuck in PROCESSING for ten minutes (a crashed worker) are picked up again. */
export async function claimNextIntake(): Promise<{ id: string; pharmacyId: string } | null> {
  const rows = await platformDb.$queryRaw<{ id: string; pharmacyId: string }[]>`
    UPDATE "StockIntake" SET status = 'PROCESSING', attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "StockIntake"
      WHERE status = 'UPLOADED' OR (status = 'PROCESSING' AND "updatedAt" < now() - interval '10 minutes')
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "pharmacyId"`;
  return rows[0] ?? null;
}

async function fail(pharmacyId: string, id: string, message: string) {
  await tenantTransaction(pharmacyId, (tx) => tx.stockIntake.update({ where: { id }, data: { status: "FAILED", error: message.slice(0, 500) } }));
}

export async function processIntake(pharmacyId: string, id: string, providers: Providers = defaultProviders()) {
  // what to read, and with which provider
  const job = await tenantTransaction(pharmacyId, async (tx) => {
    const intake = await tx.stockIntake.findUnique({ where: { id }, include: { pages: { orderBy: { pageNo: "asc" } } } });
    if (!intake) return null;
    const files = await tx.storedFile.findMany({ where: { id: { in: intake.pages.map((p) => p.fileId) } }, select: { id: true, mime: true, data: true } });
    const pharmacy = await tx.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId }, select: { ocrProviders: true, ocrMonthlyLimit: true, settings: { select: { ocrProvider: true } } } });
    const flags = await getFeatureFlags(tx, pharmacyId);
    const used = await readUsage(tx, usageKey());
    return { intake, files, pharmacy, ocrOn: flags.ocr, used };
  });
  if (!job) return { status: "missing" as const };
  const { intake, files, pharmacy, ocrOn, used } = job;
  const pages = intake.pages.map((p) => ({ pageNo: p.pageNo, file: files.find((f) => f.id === p.fileId) })).filter((p) => p.file);

  if (!ocrOn) return fail(pharmacyId, id, "Reading photos is switched off for this pharmacy.").then(() => ({ status: "FAILED" as const }));
  if (used + pages.length > pharmacy.ocrMonthlyLimit) {
    return fail(pharmacyId, id, `This month's limit of ${pharmacy.ocrMonthlyLimit} photo pages is reached.`).then(() => ({ status: "FAILED" as const }));
  }
  const allowed = pharmacy.ocrProviders;
  const wanted = pharmacy.settings?.ocrProvider ?? "LOCAL";
  const name = ([wanted, "LOCAL", "CLOUD"] as const).find((p) => allowed.includes(p) && providers[p as keyof Providers]) as keyof Providers | undefined;
  const provider = name ? providers[name] : undefined;
  if (!provider) return fail(pharmacyId, id, "No photo reader is available for this pharmacy.").then(() => ({ status: "FAILED" as const }));

  let parsed;
  let raw;
  try {
    raw = await provider.extract(pages.map((p) => ({ pageNo: p.pageNo, data: Buffer.from(p.file!.data), mime: p.file!.mime })), intake.kind);
    parsed = parseDocument(raw, intake.kind);
  } catch (e) {
    await fail(pharmacyId, id, `The photo could not be read (${e instanceof Error ? e.message : String(e)}).`);
    return { status: "FAILED" as const };
  }
  if (!parsed.lines.length) {
    await fail(pharmacyId, id, "No medicine lines were found on the photo.");
    return { status: "FAILED" as const };
  }

  await tenantTransaction(pharmacyId, async (tx) => {
    // the supplier by name, when the bill shows one we know
    let supplierId = intake.supplierId;
    if (!supplierId && parsed.header.supplierName && intake.kind === "PURCHASE_BILL") {
      const s = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Supplier" WHERE active AND similarity(lower(name), lower(${parsed.header.supplierName})) > 0.35
        ORDER BY similarity(lower(name), lower(${parsed.header.supplierName})) DESC LIMIT 1`;
      supplierId = s[0]?.id ?? null;
    }
    await tx.stockIntakeLine.deleteMany({ where: { intakeId: id } });
    await tx.stockIntakeLine.createMany({
      data: parsed.lines.map((l, i) => ({
        intakeId: id, lineNo: i + 1, rawText: l.rawText, name: l.name, batchNumber: l.batchNumber, expiryDate: l.expiryDate ? dateOnly(l.expiryDate) : null,
        quantity: l.quantity, bonusQty: l.bonusQty, rate: l.rate, discountPercent: l.discountPercent, taxAmount: l.taxAmount, amount: l.amount,
        confidence: l.confidence, boxes: (l.box ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
    await autoMatch(tx, id, supplierId);
    await tx.stockIntake.update({
      where: { id },
      data: {
        status: "NEEDS_REVIEW", provider: provider.name, error: null, supplierId: intake.kind === "PURCHASE_BILL" ? supplierId : null,
        supplierInvoice: intake.supplierInvoice ?? parsed.header.invoiceNo, billDate: intake.billDate ?? (parsed.header.billDate ? dateOnly(parsed.header.billDate) : null),
        billTotal: intake.billTotal ?? parsed.header.billTotal, header: parsed.header as Prisma.InputJsonValue, rawResult: raw as unknown as Prisma.InputJsonValue,
      },
    });
    await addUsage(tx, usageKey(), pages.length);
    await audit(tx, { actor: { id: intake.createdById } }, { action: "stockEntry.read", entity: "StockIntake", entityId: id, after: { provider: provider.name, pages: pages.length, lines: parsed.lines.length } });
    await notify(tx, pharmacyId, {
      type: "INTAKE_READY", audiencePermission: "stockEntry.post", dedupeKey: `intake-ready:${id}`, link: `/stock-entry/${id}`,
      title: `Stock entry ${intake.number} is ready to check`, body: `${parsed.lines.length} line(s) read from ${pages.length} photo(s).`,
    });
  });
  return { status: "NEEDS_REVIEW" as const, lines: parsed.lines.length };
}
