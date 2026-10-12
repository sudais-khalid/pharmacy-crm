import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema, setSessionCookie } from "@/modules/identity";
import { errorResponse, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { isLimited, recordHit, clearBucket } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/origin";
import { clientIp } from "@/lib/request";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 8; // failed attempts per IP and email
const MAX_PER_IP = 30; // failed attempts per IP across all emails

const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e4PzBzAGOr2lCzPzkXY0bR0wC8o2S";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { email, password } = loginSchema.parse(await readJson(req));
    const ip = clientIp(req) ?? "local";
    const accountBucket = `login:${ip}:${email}`;
    const ipBucket = `login:${ip}`;
    if ((await isLimited(accountBucket, MAX_PER_ACCOUNT, WINDOW_MS)) || (await isLimited(ipBucket, MAX_PER_IP, WINDOW_MS))) {
      throw new AppError(429, "Too many login attempts. Try again in a few minutes.");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await recordHit(accountBucket);
      await recordHit(ipBucket);
      throw new AppError(401, "Incorrect email or password.");
    }
    if (!user.active) throw new AppError(403, "This account has been disabled. Contact your administrator.");

    await clearBucket(accountBucket);
    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
