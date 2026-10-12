import { z } from "zod";
import { readJson } from "@/lib/api";
import { verifySecondFactor, setPlatformSession } from "@/modules/identity";
import { platformRoute } from "../../_lib/platform-route";

const schema = z
  .object({ code: z.string().trim().max(10).optional(), recoveryCode: z.string().trim().max(20).optional() })
  .refine((v) => !!v.code !== !!v.recoveryCode, "Enter a code from your authenticator app or a recovery code");

export const POST = platformRoute(async ({ req, dev, meta }) => {
  const input = schema.parse(await readJson(req));
  const r = await verifySecondFactor(dev.id, input, meta);
  await setPlatformSession({ id: dev.id, sessionVersion: r.sessionVersion }, true);
  return { method: r.method, recoveryCodesLeft: "recoveryCodesLeft" in r ? r.recoveryCodesLeft : undefined };
}, { allowWithoutMfa: true });

export const dynamic = "force-dynamic";
