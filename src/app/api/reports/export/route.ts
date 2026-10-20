import { route } from "@/lib/api";
import { getSettings } from "@/modules/platform";
import { reportWorkbook, runReport } from "@/modules/reports";

/** A report as an Excel file (roadmap 8.7). */
export const GET = route("reports.view", async ({ req, svc, db, user }) => {
  const sp = req.nextUrl.searchParams;
  const report = await runReport(svc, sp.get("type") || "sales", { from: sp.get("from"), to: sp.get("to"), unit: sp.get("group") });
  const shop = await getSettings(db, user.pharmacyId);
  const file = await reportWorkbook(report, shop);
  const name = `${report.type}-${report.ranged ? `${report.from}-to-${report.to}` : report.to}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});

export const dynamic = "force-dynamic";
