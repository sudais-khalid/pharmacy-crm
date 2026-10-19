import { redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity";
import { tenantTransaction } from "@/lib/db";
import { getSettings } from "@/modules/platform";
import { Shell } from "@/components/shell";
import { BrandStyle } from "@/components/brand-style";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !user.support) redirect("/account/password");
  const { settings, status } = await tenantTransaction(user.pharmacyId, async (tx) => ({
    settings: await getSettings(tx, user.pharmacyId),
    status: (await tx.pharmacy.findUniqueOrThrow({ where: { id: user.pharmacyId }, select: { status: true } })).status,
  }));
  return <><BrandStyle color={settings.brandColor} /><Shell ctx={{ user, permissions: user.permissions, settings, pharmacyStatus: status, support: user.support && { devName: user.support.devName, reason: user.support.reason } }}>{children}</Shell></>;
}
