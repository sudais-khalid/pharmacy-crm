import { route, readJson } from "@/lib/api";
import { createOrder, listOrders, orderSchema } from "@/modules/procurement";

export const GET = route("purchases.view", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  return listOrders(svc, { supplierId: sp.get("supplierId") || undefined, status: sp.get("status") || "open", page: Number(sp.get("page")) || 1 });
});

export const POST = route("purchases.create", async ({ req, svc }) => createOrder(svc, orderSchema.parse(await readJson(req))), { idempotent: true });

export const dynamic = "force-dynamic";
