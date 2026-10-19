import { redirect } from "next/navigation";
import { getSessionUser, landingFor } from "@/modules/identity";

export const dynamic = "force-dynamic";

/** After sign-in: the role's first screen (Cashier to POS, others to the dashboard, custom roles as set). */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.secondFactor === "verify") redirect("/account/two-factor");
  if (user.mustChangePassword && !user.support) redirect("/account/password");
  if (user.secondFactor === "enrol") redirect("/account/two-factor");
  redirect(landingFor(user.role, user.permissions));
}
