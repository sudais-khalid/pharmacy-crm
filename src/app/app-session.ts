import { redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity";
import { tenantTransaction } from "@/lib/db";
import { getSettings } from "@/modules/platform";
import { suspendsOn } from "@/modules/tenancy";
import type { AppCtx } from "@/components/app-context";

/** The signed-in staff member and their pharmacy, for the app layouts; sends everyone else where they must go first. */
export async function loadAppContext(): Promise<AppCtx & { settings: Awaited<ReturnType<typeof getSettings>> }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.secondFactor === "verify") redirect("/account/two-factor");
  if (user.mustChangePassword && !user.support) redirect("/account/password");
  if (user.secondFactor === "enrol") redirect("/account/two-factor");
  const { settings, pharmacy } = await tenantTransaction(user.pharmacyId, async (tx) => ({
    settings: await getSettings(tx, user.pharmacyId),
    pharmacy: await tx.pharmacy.findUniqueOrThrow({ where: { id: user.pharmacyId }, select: { status: true, subscriptionEndsAt: true } }),
  }));
  const ends = pharmacy.subscriptionEndsAt;
  return {
    user, permissions: user.permissions, settings, pharmacyStatus: pharmacy.status,
    subscription: ends ? { endsAt: ends.toISOString().slice(0, 10), suspendsOn: suspendsOn(ends) } : null,
    support: user.support && { devName: user.support.devName, reason: user.support.reason },
  };
}
