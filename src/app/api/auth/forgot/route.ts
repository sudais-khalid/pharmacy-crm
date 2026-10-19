import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/origin";
import { platformDb } from "@/lib/platform-db";
import { isLimited, recordHit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { notify } from "@/modules/platform";

/**
 * "Forgot password" from the sign-in page (docs/plan/05-roadmap.md, task 3.5). There is no email: the
 * request becomes a notification for the people who manage staff in that pharmacy, who send a reset link
 * or set a temporary password. The answer is the same whether or not the account exists.
 */
const schema = z.object({ pharmacy: z.string().trim().toLowerCase().min(1).max(40), username: z.string().trim().toLowerCase().min(1).max(120) });
const ANSWER = { ok: true, message: "If the account exists, your pharmacy's admin has been told. They will give you a new way to sign in." };

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { pharmacy, username } = schema.parse(await readJson(req));
    const ip = clientIp(req) ?? "local";
    if (await isLimited(`forgot:${ip}`, 5, 15 * 60 * 1000)) throw new AppError(429, "Too many requests. Try again in a few minutes.");
    await recordHit(`forgot:${ip}`);
    const user = await platformDb.user.findFirst({
      where: { pharmacy: { slug: pharmacy, status: { in: ["ACTIVE", "GRACE"] } }, isSystem: false, active: true, OR: [{ username }, { email: username }] },
      select: { id: true, name: true, username: true, pharmacyId: true },
    });
    if (user) {
      await notify(platformDb, user.pharmacyId, {
        type: "RESET_REQUEST", severity: "WARNING", audiencePermission: "users.manage", dedupeKey: `reset-request:${user.id}`, link: "/users",
        title: `${user.name} asked for a new password`,
        body: `Username ${user.username}. Open Users to send a reset link or set a temporary password.`,
      });
    }
    return NextResponse.json(ANSWER);
  } catch (e) {
    return errorResponse(e);
  }
}
