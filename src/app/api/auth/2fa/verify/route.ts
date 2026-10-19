import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { setStaffSession, verifyStaffSecondFactor } from "@/modules/identity";

const schema = z.object({ code: z.string().trim().max(10).optional(), recoveryCode: z.string().trim().max(20).optional() });

/** The second step of sign-in: an authenticator code or a recovery code. */
export const POST = route(null, async ({ req, user, svc }) => {
  const r = await verifyStaffSecondFactor(user.id, schema.parse(await readJson(req)), svc.meta);
  await setStaffSession({ id: user.id, pharmacyId: user.pharmacyId, sessionVersion: r.sessionVersion }, true);
  return { method: r.method, recoveryCodesLeft: "recoveryCodesLeft" in r ? r.recoveryCodesLeft : undefined };
}, { allowSecondFactor: true });

export const dynamic = "force-dynamic";
