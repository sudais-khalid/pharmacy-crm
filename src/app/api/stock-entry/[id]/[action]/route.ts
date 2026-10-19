import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { can } from "@/modules/identity";
import { autoMatch, discardIntake, getIntake, postIntake, retryReading } from "@/modules/stockentry";

/** post (stockEntry.post, safe to retry with an Idempotency-Key), discard, retry (read the photos again), match (fill medicines from text). */
export const POST = route("stockEntry.create", async ({ params, svc, user, db }) => {
  switch (params.action) {
    case "post":
      if (!can(user, "stockEntry.post")) throw new AppError(403, "You can enter stock, but posting it needs a pharmacist or admin.");
      return postIntake(svc, params.id);
    case "discard":
      return discardIntake(svc, params.id);
    case "retry":
      return retryReading(svc, params.id);
    case "match": {
      const intake = await db.stockIntake.findUnique({ where: { id: params.id }, select: { supplierId: true } });
      if (!intake) throw new AppError(404, "Stock entry not found.");
      await autoMatch(db, params.id, intake.supplierId);
      return getIntake(svc, params.id);
    }
    default:
      throw new AppError(404, "Unknown action.");
  }
}, { idempotent: true });

export const dynamic = "force-dynamic";
