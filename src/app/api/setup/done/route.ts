import { route } from "@/lib/api";
import { audit } from "@/modules/platform";

/** Ends the first-run setup: the dashboard stops offering it. Steps can still be done later. */
export const POST = route("settings.manage", async ({ db, svc, user }) => {
  await db.pharmacySettings.update({ where: { pharmacyId: user.pharmacyId }, data: { setupDoneAt: new Date() } });
  await audit(db, svc, { action: "setup.done", entity: "Pharmacy", entityId: user.pharmacyId });
  return { ok: true };
});

export const dynamic = "force-dynamic";
