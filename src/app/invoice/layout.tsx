import { getSessionUser } from "@/modules/identity";
import { tenantTransaction } from "@/lib/db";
import { getSettings } from "@/modules/platform";
import { BrandStyle } from "@/components/brand-style";

export const dynamic = "force-dynamic";

/** Printed invoices carry the pharmacy's brand colour too. */
export default async function InvoiceLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const color = user ? (await tenantTransaction(user.pharmacyId, (tx) => getSettings(tx, user.pharmacyId))).brandColor : null;
  return <><BrandStyle color={color} />{children}</>;
}
