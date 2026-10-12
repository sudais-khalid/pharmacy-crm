import type { NextRequest } from "next/server";

/**
 * Client IP for rate limiting and the audit log.
 * X-Forwarded-For can be forged by any client, so it is only trusted when the app runs behind a
 * reverse proxy that sets it (TRUST_PROXY=1). Otherwise null, and callers fall back to one shared bucket.
 */
export function clientIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}
