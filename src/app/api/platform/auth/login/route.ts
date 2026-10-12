import { NextRequest, NextResponse } from "next/server";
import { errorResponse, readJson, requestMeta } from "@/lib/api";
import { assertSameOrigin } from "@/lib/origin";
import { loginSchema, platformPasswordLogin, setPlatformSession } from "@/modules/identity";

/** Step one of Developer sign-in. The session it starts is not yet trusted (second factor pending). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { email, password } = loginSchema.parse(await readJson(req));
    const dev = await platformPasswordLogin(email, password, requestMeta(req));
    await setPlatformSession(dev, false);
    return NextResponse.json({ next: dev.totpEnabled ? "verify" : "enrol" });
  } catch (e) {
    return errorResponse(e);
  }
}

export const dynamic = "force-dynamic";
