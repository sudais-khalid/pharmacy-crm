import { route } from "@/lib/api";
import { availableReports } from "@/modules/reports";

/** The reports this person may open. */
export const GET = route("reports.view", async ({ svc }) => ({ items: availableReports(svc) }));

export const dynamic = "force-dynamic";
