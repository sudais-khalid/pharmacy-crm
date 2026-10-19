import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { listNotifications, markNotificationsRead } from "@/modules/platform";

export const GET = route(null, async ({ svc }) => listNotifications(svc));

const schema = z.object({ ids: z.union([z.array(z.string().uuid()).max(100), z.literal("all")]) });

/** Marks notifications read for the signed-in person. */
export const POST = route(null, async ({ req, svc }) => markNotificationsRead(svc, schema.parse(await readJson(req)).ids));

export const dynamic = "force-dynamic";
