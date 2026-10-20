import { route, readJson } from "@/lib/api";
import { createSupplierReturn, listSupplierReturns, supplierReturnSchema } from "@/modules/procurement";

export const GET = route("purchases.view", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  return listSupplierReturns(svc, { supplierId: sp.get("supplierId") || undefined, page: Number(sp.get("page")) || 1 });
});

/** Hands stock back to a supplier: out of the batches, credited to its account. */
export const POST = route("purchases.create", async ({ req, svc }) => createSupplierReturn(svc, supplierReturnSchema.parse(await readJson(req))), { idempotent: true });

export const dynamic = "force-dynamic";
