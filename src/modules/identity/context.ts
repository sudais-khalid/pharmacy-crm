import type { DbContext } from "@/lib/db";
import type { Permission } from "./permissions";

/** Who is performing a service call, with what they may do (resolved from their role). */
export type Actor = { id: string; permissions: readonly Permission[] };

/** Where the request came from, recorded in the audit log. */
export type RequestMeta = { ip?: string | null; userAgent?: string | null };

/** Context every business service receives as its first argument. */
export type ServiceContext = DbContext & {
  actor: Actor;
  meta?: RequestMeta;
  /** Platform support: audit rows name the Developer and the support session instead of the support account. */
  realm?: "STAFF" | "PLATFORM";
  supportSessionId?: string | null;
  auditActorId?: string;
};

export function serviceContext(actor: Actor, pharmacyId: string, meta?: RequestMeta): ServiceContext {
  return { actor: { id: actor.id, permissions: actor.permissions }, pharmacyId, meta };
}
