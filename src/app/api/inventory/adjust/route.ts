import { route, readJson } from "@/lib/api";
import { adjustSchema } from "@/lib/schemas";
import { adjustStock } from "@/services/inventory";

export const POST = route("inventory.adjust", async ({ req, user }) => adjustStock(adjustSchema.parse(await readJson(req)), user.id));

export const dynamic = "force-dynamic";
