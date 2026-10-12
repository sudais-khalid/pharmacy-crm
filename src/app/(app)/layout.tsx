import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const s = await prisma.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const settings = { pharmacyName: s.pharmacyName, address: s.address, phone: s.phone, email: s.email, invoiceFooter: s.invoiceFooter, expiryWarningDays: s.expiryWarningDays, currency: s.currency };
  return <Shell ctx={{ user, permissions: [...ROLE_PERMISSIONS[user.role]], settings }}>{children}</Shell>;
}
