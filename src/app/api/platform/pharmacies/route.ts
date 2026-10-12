import { readJson } from "@/lib/api";
import { createPharmacy, createPharmacySchema, listPharmacies } from "@/modules/tenancy";
import { platformRoute } from "../_lib/platform-route";

const STATUSES = ["ACTIVE", "GRACE", "SUSPENDED", "DEACTIVATED"] as const;

export const GET = platformRoute(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const status = STATUSES.find((s) => s === sp.get("status")) ?? undefined;
  return { items: await listPharmacies({ q: sp.get("q")?.trim() || undefined, status }) };
});

/** Creates a pharmacy with its first admin; the credentials in the answer are shown once. */
export const POST = platformRoute(async ({ req, dev, meta }) => createPharmacy({ devId: dev.id, meta }, createPharmacySchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
