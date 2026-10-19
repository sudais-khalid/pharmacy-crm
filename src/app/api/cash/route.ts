import { route, readJson } from "@/lib/api";
import { mySession, openSession, openSessionSchema } from "@/modules/sales";

/** The caller's drawer: whether sessions are on, and the open session with running totals. */
export const GET = route("pos.use", async ({ svc }) => mySession(svc));

/** Opens the caller's drawer with the float counted into it. */
export const POST = route("pos.use", async ({ req, svc }) => openSession(svc, openSessionSchema.parse(await readJson(req))), { idempotent: true });

export const dynamic = "force-dynamic";
