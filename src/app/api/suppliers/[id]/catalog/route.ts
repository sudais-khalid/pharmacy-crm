import { route, readJson } from "@/lib/api";
import { catalogItemSchema, listCatalog, saveCatalogItem } from "@/modules/procurement";

/** A supplier's catalog: the medicines it sells, with its codes and last prices. */
export const GET = route("suppliers.view", async ({ req, params, svc }) => listCatalog(svc, params.id, req.nextUrl.searchParams.get("q")?.trim() || undefined));

/** Adds a medicine (or a brand-new one) to the catalog, or updates its entry. */
export const POST = route("supplierCatalog.manage", async ({ req, params, svc }) => saveCatalogItem(svc, params.id, catalogItemSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
