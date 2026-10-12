import { z } from "zod";
import { readJson } from "@/lib/api";
import { startTotpEnrolment, confirmTotpEnrolment, setPlatformSession } from "@/modules/identity";
import { platformRoute } from "../../_lib/platform-route";

export const GET = platformRoute(async ({ dev }) => startTotpEnrolment(dev.id), { allowWithoutMfa: true });

const confirmSchema = z.object({ code: z.string().trim().min(6).max(10) });

export const POST = platformRoute(async ({ req, dev, meta }) => {
  const { code } = confirmSchema.parse(await readJson(req));
  const r = await confirmTotpEnrolment(dev.id, code, meta);
  await setPlatformSession({ id: dev.id, sessionVersion: r.sessionVersion }, true);
  return { recoveryCodes: r.recoveryCodes };
}, { allowWithoutMfa: true });

export const dynamic = "force-dynamic";
