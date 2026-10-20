import { route } from "@/lib/api";
import { globalSearch } from "@/modules/catalog";

/** The Ctrl+K palette's search: everything the signed-in person may see, a few of each kind. */
export const GET = route(null, async ({ req, svc }) => ({ items: await globalSearch(svc, req.nextUrl.searchParams.get("q") ?? "") }));

export const dynamic = "force-dynamic";
