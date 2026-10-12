import { redirect } from "next/navigation";
import { getPlatformUser } from "@/modules/identity";
import { ConsoleShell } from "./console-shell";

export const dynamic = "force-dynamic";

/** Developer console pages: only a Developer session that has passed the second factor gets in. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const dev = await getPlatformUser();
  if (!dev) redirect("/platform/login");
  return <ConsoleShell dev={{ name: dev.name, email: dev.email }}>{children}</ConsoleShell>;
}
