import { readJson } from "@/lib/api";
import { pharmacyPlanSchema, setPharmacyPlan } from "@/modules/tenancy";
import { platformRoute } from "../../../_lib/platform-route";

export const PUT = platformRoute(async ({ req, params, dev, meta }) => setPharmacyPlan({ devId: dev.id, meta }, params.id, pharmacyPlanSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
