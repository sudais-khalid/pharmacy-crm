import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema, setSessionCookie } from "@/modules/identity";
import { errorResponse, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { allow, clearLimit } from "@/lib/rate-limit";

const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8e4PzBzAGOr2lCzPzkXY0bR0wC8o2S";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = loginSchema.parse(await readJson(req));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const key = `${ip}:${email}`;
    if (!allow(key, 8, 15 * 60 * 1000)) throw new AppError(429, "Too many login attempts. Try again in a few minutes.");

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, "Incorrect email or password.");
    if (!user.active) throw new AppError(403, "This account has been disabled. Contact your administrator.");

    clearLimit(key);
    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
