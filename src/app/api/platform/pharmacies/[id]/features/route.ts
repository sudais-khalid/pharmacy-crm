import { readJson } from "@/lib/api";
import type { FeatureKey } from "@/modules/platform";
import { featureChangeSchema, setFeatureFlag } from "@/modules/tenancy";
import { platformRoute } from "../../../_lib/platform-route";

export const POST = platformRoute(async ({ req, params, dev, meta }) => {
  const { key, enabled } = featureChangeSchema.parse(await readJson(req));
  return setFeatureFlag({ devId: dev.id, meta }, params.id, key as FeatureKey, enabled);
});

export const dynamic = "force-dynamic";
