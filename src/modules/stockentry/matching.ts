import type { Tx } from "@/lib/prisma";
import { cleanItemName } from "./ocr/parse";

/**
 * Matching a line's printed text to a medicine (architecture, section 6.1.2), in order of trust:
 * 1) barcode, 2) the supplier's own item code from its catalog, 3) learned alias for this supplier or the whole
 * pharmacy, 4) trigram similarity on name and generic name above a threshold. Anything else is matched
 * by the reviewer in the grid.
 */
export type MatchMethod = "BARCODE" | "SUPPLIER_CODE" | "ALIAS" | "TRIGRAM" | "MANUAL";
export type Match = { medicineId: string; method: MatchMethod; score: number; name: string };

const TRIGRAM_THRESHOLD = 0.45;

/** Lower case, single spaces, letters and digits only: the form aliases are stored in. */
export function normalizeItemText(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Item codes a bill prints with a name: "MONITOR 5MG TAB / 808", "055/ESSO 40MG", "678 KOOLOX SUSP". */
export function itemCodes(raw: string): string[] {
  const out = new Set<string>();
  const { code } = cleanItemName(raw);
  if (code) out.add(code);
  // on a whole bill row the code sits after the name: "MONITOR 5MG TAB / 808 UT274 1 ..."
  const after = raw.match(/[A-Za-z][^/]*\/\s*(\d{2,6})(?=\s|$)/)?.[1];
  if (after) out.add(after);
  const lead = raw.trim().match(/^([A-Z]{0,3}\d{2,6})\s*[/\s]/i)?.[1];
  if (lead) out.add(lead.toUpperCase());
  return [...out];
}

export async function matchMedicine(tx: Tx, text: string, supplierId: string | null, rawText?: string | null): Promise<Match | null> {
  const raw = text.trim();
  if (!raw) return null;
  // 2) the supplier's code for the item, kept in its catalog
  if (supplierId) {
    const codes = itemCodes(rawText ?? raw);
    if (codes.length) {
      const hit = await tx.supplierProduct.findFirst({ where: { supplierId, supplierCode: { in: codes } }, include: { medicine: { select: { id: true, name: true, active: true } } } });
      if (hit?.medicine.active) return { medicineId: hit.medicine.id, method: "SUPPLIER_CODE", score: 1, name: hit.medicine.name };
    }
  }
  // 1) a barcode printed or scanned on the line
  const code = raw.match(/\b\d{8,14}\b/)?.[0];
  if (code) {
    const m = await tx.medicine.findFirst({ where: { barcode: code, active: true }, select: { id: true, name: true } });
    if (m) return { medicineId: m.id, method: "BARCODE", score: 1, name: m.name };
  }
  const norm = normalizeItemText(raw);
  if (!norm) return null;
  // 3) what this supplier (or anyone in the pharmacy) printed for it before
  const alias = await tx.supplierItemAlias.findFirst({
    where: { text: norm, supplierId: { in: supplierId ? [supplierId, ""] : [""] } },
    orderBy: [{ supplierId: "desc" }, { hits: "desc" }],
    include: { medicine: { select: { id: true, name: true, active: true } } },
  });
  if (alias?.medicine.active) return { medicineId: alias.medicine.id, method: "ALIAS", score: 1, name: alias.medicine.name };
  // 4) the most similar name or generic name
  const rows = await tx.$queryRaw<{ id: string; name: string; score: number }[]>`
    SELECT id, name, GREATEST(similarity(lower(name), ${norm}), similarity(lower(coalesce("genericName", '')), ${norm}))::float AS score
    FROM "Medicine" WHERE active
    ORDER BY score DESC LIMIT 1`;
  const best = rows[0];
  if (best && best.score >= TRIGRAM_THRESHOLD) return { medicineId: best.id, method: "TRIGRAM", score: Math.round(best.score * 100) / 100, name: best.name };
  return null;
}

/** Keeps the item code a supplier printed, when its catalog entry has none yet and no other medicine uses it. */
export async function learnSupplierCode(tx: Tx, supplierId: string, medicineId: string, rawText: string) {
  const [code] = itemCodes(rawText);
  if (!code) return;
  const clash = await tx.supplierProduct.findFirst({ where: { supplierId, supplierCode: code }, select: { id: true } });
  if (clash) return;
  await tx.supplierProduct.updateMany({ where: { supplierId, medicineId, supplierCode: null }, data: { supplierCode: code } });
}

/** Remembers what a supplier printed for a medicine, confirmed by a reviewer when the entry was posted. */
export async function learnAlias(tx: Tx, pharmacyId: string, text: string, supplierId: string | null, medicineId: string) {
  const norm = normalizeItemText(text);
  if (!norm || norm.length < 3) return;
  await tx.supplierItemAlias.upsert({
    where: { pharmacyId_supplierId_text: { pharmacyId, supplierId: supplierId ?? "", text: norm } },
    create: { supplierId: supplierId ?? "", text: norm, medicineId },
    update: { medicineId, hits: { increment: 1 } },
  });
}
