import { route, readJson } from "@/lib/api";
import { cancelSchema, cancelSale } from "@/modules/sales";

export const POST = route("sales.cancel", async ({ req, params, svc }) => {
  const { reason } = cancelSchema.parse(await readJson(req));
  return cancelSale(svc, params.id, reason);
});

export const dynamic = "force-dynamic";
