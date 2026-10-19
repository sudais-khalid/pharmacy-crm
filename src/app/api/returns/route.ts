import { route, readJson } from "@/lib/api";
import { createReturn, listReturns, returnSchema } from "@/modules/sales";

export const GET = route("sales.view", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  return listReturns(svc, { q: sp.get("q")?.trim() || undefined, page: Number(sp.get("page")) || 1 });
});

export const POST = route("returns.create", async ({ req, svc }) => {
  const r = await createReturn(svc, returnSchema.parse(await readJson(req)));
  return { id: r.id, number: r.number, total: r.total, refundMethod: r.refundMethod };
}, { idempotent: true });

export const dynamic = "force-dynamic";
