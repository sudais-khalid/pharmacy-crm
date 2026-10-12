import { route, readJson } from "@/lib/api";
import { settingsSchema, getSettings, updateSettings } from "@/modules/platform";

export const GET = route(null, async ({ db, user }) => getSettings(db, user.pharmacyId));

export const PUT = route("settings.manage", async ({ req, svc }) => updateSettings(svc, settingsSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
