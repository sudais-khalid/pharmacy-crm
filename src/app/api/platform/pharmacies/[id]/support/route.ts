import { z } from "zod";
import { readJson } from "@/lib/api";
import { setSupportSession, startSupportSession } from "@/modules/identity";
import { platformRoute } from "../../../_lib/platform-route";

const schema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

/** Opens the pharmacy as platform support; the browser then uses the pharmacy app. */
export const POST = platformRoute(async ({ req, params, dev, meta }) => {
  const { reason } = schema.parse(await readJson(req));
  const session = await startSupportSession(dev.id, params.id, reason, meta);
  await setSupportSession(dev, params.id, session.id);
  return { redirect: "/dashboard" };
});

export const dynamic = "force-dynamic";
