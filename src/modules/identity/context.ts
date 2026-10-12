import type { DbContext } from "@/lib/db";
import type { Role } from "./permissions";

/** Who is performing a service call. */
export type Actor = { id: string; role: Role };

/** Context every business service receives as its first argument. */
export type ServiceContext = DbContext & { actor: Actor };

export function serviceContext(actor: Actor, pharmacyId: string | null = null): ServiceContext {
  return { actor: { id: actor.id, role: actor.role }, pharmacyId };
}
