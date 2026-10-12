import type { NextRequest } from "next/server";
import { AppError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) hosts.add(host.toLowerCase());
  for (const o of (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      hosts.add(new URL(o).host.toLowerCase());
    } catch {
      // ignore malformed entries
    }
  }
  return hosts;
}

/**
 * Rejects state-changing requests sent by a browser from another site (CSRF defence in depth, next to
 * the SameSite=Lax cookie). Browsers always send Origin on POST, PUT, PATCH and DELETE; requests without
 * it come from non-browser clients, which cannot carry a victim's cookie, so they are allowed.
 */
export function assertSameOrigin(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) {
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") throw new AppError(403, "Cross-site request blocked.");
    return;
  }
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    throw new AppError(403, "Cross-site request blocked.");
  }
  if (!allowedHosts(req).has(host)) throw new AppError(403, "Cross-site request blocked.");
}
