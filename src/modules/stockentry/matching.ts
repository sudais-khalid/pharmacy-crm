import type { Tx } from "@/lib/prisma";

/**
 * Matching a line's printed text to a medicine (architecture, section 6.1.2), in order of trust:
 * 1) barcode, 2) supplier code (joins in phase 7), 3) learned alias for this supplier or the whole
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

export async function matchMedicine(tx: Tx, text: string, supplierId: string | null): Promise<Match | null> {
  const raw = text.trim();
  if (!raw) return null;
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
