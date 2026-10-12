import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson, requestMeta } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/origin";
import { isLimited, recordHit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { inspectStaffToken, redeemStaffToken } from "@/modules/identity";

type Params = { params: Promise<{ token: string }> };

async function limit(req: NextRequest) {
  const bucket = `token:${clientIp(req) ?? "local"}`;
  if (await isLimited(bucket, 30, 15 * 60 * 1000)) throw new AppError(429, "Too many attempts. Try again in a few minutes.");
  await recordHit(bucket);
}

/** What an invite or reset link is for, so the page can greet the person. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await limit(req);
    return NextResponse.json(await inspectStaffToken((await params).token), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

const schema = z.object({ password: z.string().min(1).max(100) });

export async function POST(req: NextRequest, { params }: Params) {
  try {
    assertSameOrigin(req);
    await limit(req);
    const { password } = schema.parse(await readJson(req));
    return NextResponse.json(await redeemStaffToken((await params).token, password, requestMeta(req)));
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
