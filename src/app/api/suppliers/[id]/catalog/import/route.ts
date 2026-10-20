import { route, readJson } from "@/lib/api";
import { catalogImportSchema, importCatalog } from "@/modules/procurement";

/** A supplier's price list from a file (rows already mapped to columns in the browser). */
export const POST = route("supplierCatalog.manage", async ({ req, params, svc }) => importCatalog(svc, params.id, catalogImportSchema.parse(await readJson(req)).rows));

export const dynamic = "force-dynamic";
