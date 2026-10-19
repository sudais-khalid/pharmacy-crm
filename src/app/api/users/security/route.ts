import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { setStaffTotpRequired } from "@/modules/identity";

const schema = z.object({ requireStaffTotp: z.boolean() });

/** Requires two-factor sign-in for every staff account of the pharmacy, or stops requiring it. */
export const PUT = route("users.manage", async ({ req, svc }) => setStaffTotpRequired(svc, schema.parse(await readJson(req)).requireStaffTotp));

export const dynamic = "force-dynamic";
