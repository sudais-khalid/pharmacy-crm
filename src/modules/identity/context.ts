import type { DbContext } from "@/lib/db";
import type { Role } from "./permissions";

/** Who is performing a service call. */
export type Actor = { id: string; role: Role };

/** Where the request came from, recorded in the audit log. */
export type RequestMeta = { ip?: string | null; userAgent?: string | null };

/** Context every business service receives as its first argument. */
export type ServiceContext = DbContext & { actor: Actor; meta?: RequestMeta };

export function serviceContext(actor: Actor, pharmacyId: string | null = null, meta?: RequestMeta): ServiceContext {
  return { actor: { id: actor.id, role: actor.role }, pharmacyId, meta };
}
