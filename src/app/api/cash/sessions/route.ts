import { route } from "@/lib/api";
import { listSessions } from "@/modules/sales";

/** Drawer sessions: everyone's with cash.manage, otherwise the caller's own. */
export const GET = route("pos.use", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  return listSessions(svc, { status: status === "OPEN" || status === "CLOSED" ? status : undefined, page: Number(sp.get("page")) || 1 });
});

export const dynamic = "force-dynamic";
