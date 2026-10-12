import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/modules/identity";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/origin";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
