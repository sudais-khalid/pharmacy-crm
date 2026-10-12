import { route, readJson } from "@/lib/api";
import { adjustSchema, adjustStock } from "@/modules/inventory";

export const POST = route("inventory.adjust", async ({ req, user }) => adjustStock(adjustSchema.parse(await readJson(req)), user.id));

export const dynamic = "force-dynamic";
