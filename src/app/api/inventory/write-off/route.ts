import { route, readJson } from "@/lib/api";
import { writeOffBatches, writeOffSchema } from "@/modules/inventory";

/** Writes off whole batches (an EXPIRY movement for what is left in each). */
export const POST = route("inventory.adjust", async ({ req, svc }) => writeOffBatches(svc, writeOffSchema.parse(await readJson(req))), { idempotent: true });

export const dynamic = "force-dynamic";
