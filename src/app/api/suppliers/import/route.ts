import { route, readJson } from "@/lib/api";
import { importSuppliers, supplierImportSchema } from "@/modules/procurement";

/** Suppliers with what the pharmacy already owes them, many at once (first-run setup). */
export const POST = route("settings.manage", async ({ req, svc }) => importSuppliers(svc, supplierImportSchema.parse(await readJson(req)).rows));

export const dynamic = "force-dynamic";
