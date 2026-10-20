import { z } from "zod";
import { readJson } from "@/lib/api";
import { platformDb } from "@/lib/platform-db";
import { reauthenticateDeveloper } from "@/modules/identity";
import { audit } from "@/modules/platform";
import { exportPharmacyData, zipResponse } from "@/modules/tenancy";
import { platformRoute } from "../../../_lib/platform-route";

const schema = z.object({ code: z.string().trim().max(10).optional() });

/** All of a pharmacy's data as a ZIP (roadmap 9.4). Needs a fresh authenticator code, and is audited. */
export const POST = platformRoute(async ({ req, params, dev, meta }) => {
  const { code } = schema.parse(await readJson(req));
  await reauthenticateDeveloper(dev.id, code);
  const r = await exportPharmacyData(params.id);
  await audit(platformDb, { actor: { id: dev.id }, meta, realm: "PLATFORM" }, { action: "pharmacy.export", entity: "Pharmacy", entityId: params.id, pharmacyId: params.id, after: { file: r.name, bytes: r.file.length } });
  return zipResponse(r);
});

export const dynamic = "force-dynamic";
