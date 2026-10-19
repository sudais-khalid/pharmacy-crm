import { route, readJson } from "@/lib/api";
import { getSettings, profileSchema, updateProfile } from "@/modules/platform";

export const GET = route(null, async ({ db, user }) => getSettings(db, user.pharmacyId));

export const PUT = route("branding.manage", async ({ req, svc }) => updateProfile(svc, profileSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
