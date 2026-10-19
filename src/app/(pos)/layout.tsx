import { PosShell } from "@/components/pos-shell";
import { BrandStyle } from "@/components/brand-style";
import { loadAppContext } from "../app-session";

export const dynamic = "force-dynamic";

/** The counter: full screen, no sidebar (UI plan, section 4.1). */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadAppContext();
  return <><BrandStyle color={ctx.settings.brandColor} /><PosShell ctx={ctx}>{children}</PosShell></>;
}
