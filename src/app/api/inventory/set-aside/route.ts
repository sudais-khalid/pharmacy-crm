import { route, readJson } from "@/lib/api";
import { setAsideBatches, setAsideSchema } from "@/modules/inventory";

/** Sets batches aside for return to the supplier (they are not sold meanwhile), or puts them back on sale. */
export const POST = route("inventory.adjust", async ({ req, svc }) => setAsideBatches(svc, setAsideSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
