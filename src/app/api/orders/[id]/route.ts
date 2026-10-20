import { route, readJson } from "@/lib/api";
import { getSettings } from "@/modules/platform";
import { getOrder, orderShareText, orderUpdateSchema, updateOrder } from "@/modules/procurement";

/** One order with received and pending quantities, and the text to send it by WhatsApp. */
export const GET = route("purchases.view", async ({ params, svc, db, user }) => {
  const order = await getOrder(svc, params.id);
  const { pharmacyName } = await getSettings(db, user.pharmacyId);
  return { ...order, shareText: orderShareText(order, pharmacyName) };
});

/** Changes a draft order. */
export const PUT = route("purchases.create", async ({ req, params, svc }) => updateOrder(svc, params.id, orderUpdateSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
