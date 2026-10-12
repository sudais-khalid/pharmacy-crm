import { readJson } from "@/lib/api";
import { getPharmacyDetail, pharmacyProfileSchema, updatePharmacyProfile } from "@/modules/tenancy";
import { platformRoute } from "../../_lib/platform-route";

export const GET = platformRoute(async ({ params }) => getPharmacyDetail(params.id));

export const PUT = platformRoute(async ({ req, params, dev, meta }) =>
  updatePharmacyProfile({ devId: dev.id, meta }, params.id, pharmacyProfileSchema.parse(await readJson(req))),
);

export const dynamic = "force-dynamic";
