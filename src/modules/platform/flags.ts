import type { Tx } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";

/** Feature switches the Developer sets per pharmacy. Defaults apply where no row exists. */
export const FEATURE_FLAGS = {
  ocr: { label: "OCR stock entry from photos", defaultOn: true },
  purchaseOrders: { label: "Purchase orders to suppliers", defaultOn: true },
  cashSessions: { label: "Cash drawer sessions", defaultOn: false },
  returns: { label: "Customer and supplier returns", defaultOn: true },
  expenses: { label: "Expenses and net profit", defaultOn: true },
} as const;

export type FeatureKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_KEYS = Object.keys(FEATURE_FLAGS) as FeatureKey[];

/** Effective switches for one pharmacy: stored value, otherwise the default. */
export async function getFeatureFlags(db: Tx | PrismaClient, pharmacyId: string): Promise<Record<FeatureKey, boolean>> {
  const rows = await db.featureFlag.findMany({ where: { pharmacyId } });
  const stored = new Map(rows.map((r) => [r.key, r.enabled]));
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, stored.get(k) ?? FEATURE_FLAGS[k].defaultOn])) as Record<FeatureKey, boolean>;
}
