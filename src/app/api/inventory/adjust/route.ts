import { route, readJson } from "@/lib/api";
import { adjustSchema, adjustStock } from "@/modules/inventory";

export const POST = route("inventory.adjust", async ({ req, svc }) => adjustStock(svc, adjustSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
