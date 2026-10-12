import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/modules/identity";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
