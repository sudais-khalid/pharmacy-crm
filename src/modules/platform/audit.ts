import type { Tx } from "@/lib/prisma";
import { toJson } from "@/lib/json";

export type AuditEntry = {
  action: string; // <entity>.<verb>, e.g. sale.create, medicine.price.update
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

/** The parts of a service context the audit log needs (kept structural to avoid depending on identity). */
export type AuditContext = { actor: { id: string }; meta?: { ip?: string | null; userAgent?: string | null } };

/** Appends one audit row inside the caller's transaction, so it can never disagree with the data. */
export async function audit(tx: Tx, ctx: AuditContext, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: ctx.actor.id,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : toJson(entry.before),
      after: entry.after === undefined ? undefined : toJson(entry.after),
      ip: ctx.meta?.ip ?? null,
      userAgent: ctx.meta?.userAgent ? ctx.meta.userAgent.slice(0, 300) : null,
    },
  });
}
