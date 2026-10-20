import { route } from "@/lib/api";
import { removeCatalogItem } from "@/modules/procurement";

export const DELETE = route("supplierCatalog.manage", async ({ params, svc }) => removeCatalogItem(svc, params.id, params.itemId));

export const dynamic = "force-dynamic";
