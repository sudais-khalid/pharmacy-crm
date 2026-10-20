import { z } from "zod";
import { route } from "@/lib/api";
import { addDays, todayStr } from "@/lib/dates";
import { stockCard } from "@/modules/inventory";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({ medicineId: z.string().uuid(), from: day.optional(), to: day.optional() });

/** One medicine's stock card for a range of days (the last 30 by default). */
export const GET = route("inventory.view", async ({ req, svc }) => {
  const q = schema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const to = q.to ?? todayStr();
  return stockCard(svc, q.medicineId, { from: q.from ?? addDays(to, -29), to });
});

export const dynamic = "force-dynamic";
