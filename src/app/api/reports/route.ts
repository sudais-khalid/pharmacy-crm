import { route } from "@/lib/api";
import { runReport } from "@/modules/reports";

/** One report for a range (the registry in src/modules/reports lists them). */
export const GET = route("reports.view", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  return runReport(svc, sp.get("type") || "sales", { from: sp.get("from"), to: sp.get("to"), unit: sp.get("group") });
});

export const dynamic = "force-dynamic";
