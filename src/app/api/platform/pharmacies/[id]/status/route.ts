import { z } from "zod";
import { readJson } from "@/lib/api";
import { reauthenticateDeveloper } from "@/modules/identity";
import { setPharmacyStatus, statusChangeSchema } from "@/modules/tenancy";
import { platformRoute } from "../../../_lib/platform-route";

const schema = statusChangeSchema.extend({ code: z.string().trim().max(10).optional() });

/** Status changes need a reason and a fresh authenticator code. */
export const POST = platformRoute(async ({ req, params, dev, meta }) => {
  const { code, ...input } = schema.parse(await readJson(req));
  await reauthenticateDeveloper(dev.id, code);
  return setPharmacyStatus({ devId: dev.id, meta }, params.id, input);
});

export const dynamic = "force-dynamic";
