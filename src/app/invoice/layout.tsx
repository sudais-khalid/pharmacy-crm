import { BrandStyle } from "@/components/brand-style";
import { AppProvider } from "@/components/app-context";
import { loadAppContext } from "../app-session";

export const dynamic = "force-dynamic";

/** Printed invoices and return slips carry the pharmacy's brand colour, and know what the viewer may do. */
export default async function InvoiceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadAppContext();
  return <AppProvider ctx={ctx}><BrandStyle color={ctx.settings.brandColor} />{children}</AppProvider>;
}
