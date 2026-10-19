import { route } from "@/lib/api";
import { listAudit } from "@/modules/platform";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = route("audit.view", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  const s = (k: string) => sp.get(k)?.trim().slice(0, 80) || undefined;
  return listAudit(svc, {
    entity: s("entity"), entityId: s("entityId"), actorId: s("actorId"), action: s("action"),
    from: DATE.test(sp.get("from") ?? "") ? sp.get("from")! : undefined, to: DATE.test(sp.get("to") ?? "") ? sp.get("to")! : undefined,
    page: Number(sp.get("page")) || 1, pageSize: Number(sp.get("pageSize")) || 30,
  });
});

export const dynamic = "force-dynamic";
