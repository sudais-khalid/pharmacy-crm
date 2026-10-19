import { redirect } from "next/navigation";
import { getSessionUser, landingFor } from "@/modules/identity";

export const dynamic = "force-dynamic";

/** After sign-in: the role's first screen (Cashier to POS, others to the dashboard, custom roles as set). */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !user.support) redirect("/account/password");
  redirect(landingFor(user.role, user.permissions));
}
