import { route, readJson } from "@/lib/api";
import { ordersFromSuggestions, reorderSuggestions, suggestionPicksSchema } from "@/modules/procurement";

/** What to reorder, and from whom. */
export const GET = route("purchases.create", async ({ svc }) => ({ items: await reorderSuggestions(svc) }));

/** Turns the chosen suggestions into one draft order per supplier. */
export const POST = route("purchases.create", async ({ req, svc }) => ({ orders: await ordersFromSuggestions(svc, suggestionPicksSchema.parse(await readJson(req)).picks) }), { idempotent: true });

export const dynamic = "force-dynamic";
