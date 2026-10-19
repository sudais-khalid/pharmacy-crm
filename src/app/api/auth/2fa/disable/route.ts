import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { disableOwnSecondFactor } from "@/modules/identity";

const schema = z.object({ code: z.string().trim().min(6).max(10) });

/** Turns one's own two-factor sign-in off, with a current code. */
export const POST = route(null, async ({ req, user, svc }) => disableOwnSecondFactor(user.id, schema.parse(await readJson(req)).code, svc.meta));

export const dynamic = "force-dynamic";
