import { route, readJson } from "@/lib/api";
import { cancelSchema, cancelSale } from "@/modules/sales";

export const POST = route("sales.cancel", async ({ req, params, user }) => {
  const { reason } = cancelSchema.parse(await readJson(req));
  return cancelSale(params.id, reason, user.id);
});

export const dynamic = "force-dynamic";
