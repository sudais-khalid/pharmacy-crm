import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getSessionUser, type SessionUser, can, type Permission, serviceContext, type ServiceContext, type RequestMeta } from "@/modules/identity";
import { AppError } from "./errors";
import { IDEMPOTENCY_HEADER, withIdempotency } from "./idempotency";
import { assertSameOrigin } from "./origin";
import { clientIp } from "./request";

export { AppError };

/** `svc` is the context to pass to module services. */
type Ctx = { req: NextRequest; user: SessionUser; params: Record<string, string>; svc: ServiceContext };

type RouteOptions = {
  /**
   * Honour an `Idempotency-Key` header: a retried request with the same key gets the stored response
   * instead of running again. The handler then runs inside the transaction given in `svc.tx`.
   */
  idempotent?: boolean;
};

/** Client address and user agent for the audit log. */
export function requestMeta(req: NextRequest): RequestMeta {
  return { ip: clientIp(req), userAgent: req.headers.get("user-agent") };
}

/** Wraps an API handler with authentication, permission check and uniform error handling. */
export function route(permission: Permission | null, fn: (ctx: Ctx) => Promise<unknown>, options: RouteOptions = {}) {
  return async (req: NextRequest, { params }: { params: Promise<Record<string, string>> }) => {
    try {
      assertSameOrigin(req);
      const user = await getSessionUser();
      if (!user) throw new AppError(401, "You are not signed in.");
      if (permission && !can(user.role, permission)) throw new AppError(403, "You do not have permission to do this.");
      const ctx: Ctx = { req, user, params: await params, svc: serviceContext(user, null, requestMeta(req)) };

      const key = options.idempotent ? req.headers.get(IDEMPOTENCY_HEADER) : null;
      if (key) {
        const result = await withIdempotency(
          { key, actorId: user.id, route: `${req.method} ${req.nextUrl.pathname}`, rawBody: await req.clone().text() },
          (tx) => fn({ ...ctx, svc: { ...ctx.svc, tx } }),
        );
        return NextResponse.json(result.body ?? { ok: true }, result.replayed ? { headers: { "Idempotent-Replayed": "true" } } : undefined);
      }

      const data = await fn(ctx);
      return NextResponse.json(data ?? { ok: true });
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
  console.error("[api error]", e);
  return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
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
