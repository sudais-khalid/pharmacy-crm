import { Shell } from "@/components/shell";
import { BrandStyle } from "@/components/brand-style";
import { loadAppContext } from "../app-session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadAppContext();
  return <><BrandStyle color={ctx.settings.brandColor} /><Shell ctx={ctx}>{children}</Shell></>;
}
