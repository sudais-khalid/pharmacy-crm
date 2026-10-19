import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getSessionUser, type SessionUser, can, type Permission, serviceContext, type ServiceContext, type RequestMeta } from "@/modules/identity";
import { jsonWithoutCost } from "./cost-fields";
import { AppError } from "./errors";
import { IDEMPOTENCY_HEADER, withIdempotency } from "./idempotency";
import { assertSameOrigin } from "./origin";
import { clientIp } from "./request";
import { tenantTransaction } from "./db";
import type { Tx } from "./prisma";
import { logger } from "./logger";

export { AppError };

/** `db` is the request's tenant transaction; `svc` is the context to pass to module services. */
type Ctx = { req: NextRequest; user: SessionUser; params: Record<string, string>; svc: ServiceContext; db: Tx };

type RouteOptions = {
  /**
   * Honour an `Idempotency-Key` header: a retried request with the same key gets the stored response
   * instead of running again.
   */
  idempotent?: boolean;
  /** Reachable while the account still has to replace a temporary password (only the change itself). */
  allowPasswordChange?: boolean;
  /** Reachable while the second factor is still to be entered or set up (the two-factor endpoints). */
  allowSecondFactor?: boolean;
};

/** Client address and user agent for the audit log. */
export function requestMeta(req: NextRequest): RequestMeta {
  return { ip: clientIp(req), userAgent: req.headers.get("user-agent") };
}

/** JSON response; cost and profit fields are left out for people without cost.view. */
function respond(user: { permissions: readonly string[] }, data: unknown, headers?: Record<string, string>) {
  if (can(user, "cost.view")) return NextResponse.json(data, headers ? { headers } : undefined);
  return new NextResponse(jsonWithoutCost(data), { headers: { "content-type": "application/json", ...headers } });
}

/**
 * Wraps an API handler with authentication, permission check, tenant scoping and uniform error handling.
 * The whole handler runs in one transaction scoped to the user's pharmacy (`db`, also `svc.tx`), so every
 * query it makes, raw SQL included, is tenant scoped.
 */
export function route(permission: Permission | null, fn: (ctx: Ctx) => Promise<unknown>, options: RouteOptions = {}) {
  return async (req: NextRequest, { params }: { params: Promise<Record<string, string>> }) => {
    try {
      assertSameOrigin(req);
      const user = await getSessionUser({ refresh: true });
      if (!user) throw new AppError(401, "You are not signed in.");
      // a second factor first, then a temporary password, then (if the pharmacy requires it) setting one up
      if (user.secondFactor === "verify" && !options.allowSecondFactor) throw new AppError(403, "Enter the code from your authenticator app first.", { code: "SECOND_FACTOR_REQUIRED" });
      if (user.mustChangePassword && !options.allowPasswordChange) {
        throw new AppError(403, "Choose a new password before continuing.", { code: "PASSWORD_CHANGE_REQUIRED" });
      }
      if (user.secondFactor === "enrol" && !options.allowSecondFactor && !options.allowPasswordChange) {
        throw new AppError(403, "Your pharmacy requires two-factor sign-in. Set it up to continue.", { code: "SECOND_FACTOR_SETUP_REQUIRED" });
      }
      if (permission && !can(user, permission)) throw new AppError(403, "You do not have permission to do this.");
      const svc = serviceContext(user, user.pharmacyId, requestMeta(req));
      if (user.support) Object.assign(svc, { realm: "PLATFORM", supportSessionId: user.support.sessionId, auditActorId: user.support.devId });
      const base = { req, user, params: await params, svc };
      const run = (tx: Tx) => fn({ ...base, db: tx, svc: { ...base.svc, tx } });

      const key = options.idempotent ? req.headers.get(IDEMPOTENCY_HEADER) : null;
      if (key) {
        const result = await withIdempotency(
          { key, actorId: user.id, pharmacyId: user.pharmacyId, route: `${req.method} ${req.nextUrl.pathname}`, rawBody: await req.clone().text() },
          run,
        );
        return respond(user, result.body ?? { ok: true }, result.replayed ? { "Idempotent-Replayed": "true" } : undefined);
      }

      const data = await tenantTransaction(user.pharmacyId, run);
      if (data instanceof Response) return data; // files and other raw bodies
      return respond(user, data ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] = i.message;
    const first = e.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input", fields },
      { status: 400 },
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: "A record with the same unique value already exists." }, { status: 409 });
    if (e.code === "P2003") return NextResponse.json({ error: "This record is referenced by other records." }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  const ref = randomUUID().slice(0, 8);
  logger.error({ err: e, ref }, "unhandled API error");
  return NextResponse.json({ error: `Something went wrong on the server. Reference: ${ref}`, ref }, { status: 500 });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "Request body must be valid JSON.");
  }
}

export function pageParams(req: NextRequest, defaultSize = 20) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || String(defaultSize), 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sp };
}
