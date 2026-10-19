import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { platformDb } from "@/lib/platform-db";
import { BLOCKED_STATUSES, pendingSecondFactor, roleSelect, staffLoginSchema, setStaffSession } from "@/modules/identity";
import { errorResponse, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { isLimited, recordHit, clearBucket } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/origin";
import { clientIp } from "@/lib/request";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 8; // failed attempts per IP and account
const MAX_PER_IP = 30; // failed attempts per IP across all accounts

const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e4PzBzAGOr2lCzPzkXY0bR0wC8o2S";
const WRONG = "Incorrect pharmacy, username or password.";

/** Rate-limit bucket of one account; the Developer console clears it to unlock (see tenancy unlockAccount). */
const accountBucket = (ip: string, pharmacySlug: string, username: string) => `login:${ip}:${pharmacySlug}:${username}`;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { pharmacy: slug, username, password } = staffLoginSchema.parse(await readJson(req));
    const ip = clientIp(req) ?? "local";
    const bucket = accountBucket(ip, slug, username);
    const ipBucket = `login:${ip}`;
    if ((await isLimited(bucket, MAX_PER_ACCOUNT, WINDOW_MS)) || (await isLimited(ipBucket, MAX_PER_IP, WINDOW_MS))) {
      throw new AppError(429, "Too many login attempts. Try again in a few minutes.");
    }

    const user = await platformDb.user.findFirst({
      where: { pharmacy: { slug }, isSystem: false, OR: [{ username }, { email: username }] },
      include: { pharmacy: { select: { status: true, settings: { select: { requireStaffTotp: true } } } }, role: { select: roleSelect } },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await recordHit(bucket);
      await recordHit(ipBucket);
      throw new AppError(401, WRONG);
    }
    if (!user.active) throw new AppError(403, "This account has been disabled. Contact your administrator.");
    if (BLOCKED_STATUSES.includes(user.pharmacy.status)) {
      throw new AppError(403, user.pharmacy.status === "SUSPENDED" ? "This pharmacy's account is suspended. Contact your software provider." : "This pharmacy's account is closed. Contact your software provider.");
    }

    await clearBucket(bucket);
    await platformDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await setStaffSession(user);
    // with two-factor sign-in the session stays "pending" until /api/auth/2fa/verify (or set-up)
    const secondFactor = pendingSecondFactor(user, user.pharmacy.settings?.requireStaffTotp ?? false, false);
    return NextResponse.json({ user: { id: user.id, name: user.name, username: user.username, role: user.role.name }, mustChangePassword: user.mustChangePassword, secondFactor });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
