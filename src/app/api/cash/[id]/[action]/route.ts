import { route, readJson, AppError } from "@/lib/api";
import { addCashMovement, cashMovementSchema, closeSession, closeSessionSchema } from "@/modules/sales";

/** movement: pay-in or pay-out; close: counted cash and an optional note. Own drawer, or any with cash.manage. */
export const POST = route("pos.use", async ({ req, params, svc }) => {
  const body = await readJson(req);
  switch (params.action) {
    case "movement":
      return addCashMovement(svc, params.id, cashMovementSchema.parse(body));
    case "close":
      return closeSession(svc, params.id, closeSessionSchema.parse(body));
    default:
      throw new AppError(404, "Unknown action.");
  }
}, { idempotent: true });

export const dynamic = "force-dynamic";
