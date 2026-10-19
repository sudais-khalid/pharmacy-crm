import { createHash } from "node:crypto";
import { platformDb } from "@/lib/platform-db";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { storeFile } from "@/lib/files";
import { sniffImage } from "@/lib/images";
import type { ServiceContext } from "@/modules/identity";
import { audit } from "@/modules/platform";
import { createIntake } from "./service";

/**
 * Photo upload (docs/plan/05-roadmap.md, task 4.8): the type comes from the bytes, at most 10 MB a page
 * and 10 pages; a photo already uploaded to a live entry returns that entry instead of a second one.
 */
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 10;
const FILES_KEPT_DAYS = 30;

export async function uploadPhotos(ctx: ServiceContext, input: { kind: "PURCHASE_BILL" | "STOCK_LIST"; pages: Buffer[] }) {
  if (!input.pages.length) throw new AppError(400, "Add at least one photo.");
  if (input.pages.length > MAX_PAGES) throw new AppError(400, `At most ${MAX_PAGES} pages at a time.`);
  const checked = input.pages.map((data, i) => {
    if (data.length > MAX_PAGE_BYTES) throw new AppError(400, `Page ${i + 1} is larger than 10 MB.`);
    const info = sniffImage(data);
    if (!info) throw new AppError(400, `Page ${i + 1} is not a JPEG, PNG or WebP picture.`);
    return { data, info, sha256: createHash("sha256").update(data).digest("hex") };
  });

  const existing = await runInTx(ctx, async (tx) => {
    const files = await tx.storedFile.findMany({ where: { sha256: { in: checked.map((c) => c.sha256) }, purpose: input.kind }, select: { id: true } });
    if (!files.length) return null;
    return tx.stockIntakePage.findFirst({ where: { fileId: { in: files.map((f) => f.id) }, intake: { status: { not: "DISCARDED" } } }, select: { intakeId: true } });
  });
  if (existing) return { id: existing.intakeId, duplicate: true };

  const intake = await createIntake(ctx, { kind: input.kind, source: "OCR", status: "UPLOADED" });
  await runInTx(ctx, async (tx) => {
    for (const [i, c] of checked.entries()) {
      const file = await storeFile(tx, { purpose: input.kind, mime: c.info.mime, data: c.data, width: c.info.width, height: c.info.height, uploadedById: ctx.actor.id });
      await tx.stockIntakePage.create({ data: { intakeId: intake.id, pageNo: i + 1, fileId: file.id } });
    }
    await audit(tx, ctx, { action: "stockEntry.upload", entity: "StockIntake", entityId: intake.id, after: { pages: checked.length, kind: input.kind } });
  });
  return { id: intake.id, duplicate: false };
}

/** Reads the photos again (after a failure, or with another provider). */
export async function retryReading(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const intake = await tx.stockIntake.findUnique({ where: { id }, select: { status: true, _count: { select: { pages: true } } } });
    if (!intake) throw new AppError(404, "Stock entry not found.");
    if (!intake._count.pages) throw new AppError(409, "This stock entry has no photos to read.");
    if (!["FAILED", "NEEDS_REVIEW"].includes(intake.status)) throw new AppError(409, "This stock entry cannot be read again now.");
    await tx.stockIntake.update({ where: { id }, data: { status: "UPLOADED", error: null } });
    await audit(tx, ctx, { action: "stockEntry.retry", entity: "StockIntake", entityId: id });
    return { ok: true };
  });
}

/**
 * files.cleanup (task 4.14): photos of entries discarded more than 30 days ago are deleted (the entry and
 * its lines stay). Runs across pharmacies from the worker.
 */
export async function cleanupDiscardedPhotos(now = new Date()) {
  const before = new Date(now.getTime() - FILES_KEPT_DAYS * 24 * 3600 * 1000);
  const pages = await platformDb.stockIntakePage.findMany({ where: { intake: { status: "DISCARDED", updatedAt: { lt: before } } }, select: { intakeId: true, pageNo: true, fileId: true } });
  if (!pages.length) return { removed: 0 };
  const fileIds = [...new Set(pages.map((p) => p.fileId))];
  await platformDb.$transaction([
    platformDb.stockIntakePage.deleteMany({ where: { OR: pages.map((p) => ({ intakeId: p.intakeId, pageNo: p.pageNo })) } }),
    // a photo still used by another entry stays
    platformDb.storedFile.deleteMany({ where: { id: { in: fileIds }, purpose: { in: ["PURCHASE_BILL", "STOCK_LIST"] }, NOT: { id: { in: (await platformDb.stockIntakePage.findMany({ where: { fileId: { in: fileIds }, intake: { status: { not: "DISCARDED" } } }, select: { fileId: true } })).map((p) => p.fileId) } } } }),
  ]);
  return { removed: fileIds.length };
}
