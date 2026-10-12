import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/origin";
import { clearSession } from "@/modules/identity";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await clearSession("platform");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
