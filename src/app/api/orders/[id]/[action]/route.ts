import { route, readJson, AppError } from "@/lib/api";
import { can } from "@/modules/identity";
import { endOrder, endOrderSchema, sendOrder } from "@/modules/procurement";
import { intakeFromOrder } from "@/modules/stockentry";

/**
 * send: approve and send a draft (po.approve). end: cancel, or close short (po.approve).
 * receive: open the stock entry draft that receives against the order (stockEntry.create).
 */
export const POST = route("purchases.view", async ({ req, params, svc, user }) => {
  const need = (p: Parameters<typeof can>[1]) => { if (!can(user, p)) throw new AppError(403, "You do not have permission to do this."); };
  switch (params.action) {
    case "send":
      need("po.approve");
      return sendOrder(svc, params.id);
    case "end":
      need("po.approve");
      return endOrder(svc, params.id, endOrderSchema.parse(await readJson(req)).reason);
    case "receive":
      need("stockEntry.create");
      return intakeFromOrder(svc, params.id);
    default:
      throw new AppError(404, "Unknown action.");
  }
}, { idempotent: true });

export const dynamic = "force-dynamic";
