import { NextResponse } from "next/server";
import { getHealth } from "@/modules/platform";

/** Public health check for Docker, the desktop supervisor and uptime monitors. Exposes no business data. */
export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, { status: health.status === "down" ? 503 : 200, headers: { "cache-control": "no-store" } });
}

export const dynamic = "force-dynamic";
