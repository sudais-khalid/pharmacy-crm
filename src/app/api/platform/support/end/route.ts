import { clearSession, endSupportSession, readSupportToken } from "@/modules/identity";
import { platformRoute } from "../../_lib/platform-route";

/** Ends the current support session and returns to the pharmacy in the console. */
export const POST = platformRoute(async ({ dev, meta }) => {
  const token = await readSupportToken();
  await clearSession("support");
  if (!token?.ssid) return { redirect: "/platform/pharmacies" };
  const { pharmacyId } = await endSupportSession(token.ssid, dev.id, meta);
  return { redirect: `/platform/pharmacies/${pharmacyId}` };
});

export const dynamic = "force-dynamic";
