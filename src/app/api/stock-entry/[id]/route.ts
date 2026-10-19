import { route, readJson } from "@/lib/api";
import { getIntake, intakeDraftSchema, saveDraft } from "@/modules/stockentry";

export const GET = route("stockEntry.create", async ({ params, svc }) => getIntake(svc, params.id));

/** Autosave: the header and every line as they are on the grid. */
export const PUT = route("stockEntry.create", async ({ req, params, svc }) => saveDraft(svc, params.id, intakeDraftSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
