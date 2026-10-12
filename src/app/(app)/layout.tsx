import { redirect } from "next/navigation";
import { getSessionUser, ROLE_PERMISSIONS } from "@/modules/identity";
import { tenantTransaction } from "@/lib/db";
import { getSettings } from "@/modules/platform";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  const settings = await tenantTransaction(user.pharmacyId, (tx) => getSettings(tx, user.pharmacyId));
  return <Shell ctx={{ user, permissions: [...ROLE_PERMISSIONS[user.role]], settings }}>{children}</Shell>;
}
