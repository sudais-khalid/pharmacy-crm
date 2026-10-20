import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requestMeta } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/origin";
import { getPlatformUser, type PlatformSessionUser, type RequestMeta } from "@/modules/identity";

type PlatformCtx = { req: NextRequest; dev: PlatformSessionUser; params: Record<string, string>; meta: RequestMeta };

/**
 * Wraps a Developer console API handler. Requires a Developer session that has passed the second factor,
 * unless `allowWithoutMfa` (enrolment and code entry only).
 */
export function platformRoute(fn: (ctx: PlatformCtx) => Promise<unknown>, opts: { allowWithoutMfa?: boolean } = {}) {
  return async (req: NextRequest, { params }: { params: Promise<Record<string, string>> }) => {
    try {
      assertSameOrigin(req);
      const dev = await getPlatformUser({ requireMfa: !opts.allowWithoutMfa, refresh: true });
      if (!dev) throw new AppError(401, "Sign in to the Developer console.");
      const data = await fn({ req, dev, params: await params, meta: requestMeta(req) });
      // a file (a data export) goes out as it is
      if (data instanceof Response) return data;
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
