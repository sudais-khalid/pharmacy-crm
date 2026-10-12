import type { Tx } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { toJson } from "@/lib/json";

export type AuditEntry = {
  action: string; // <entity>.<verb>, e.g. sale.create, medicine.price.update, pharmacy.suspend
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Only for Developer actions written outside a tenant transaction; tenant rows take it from the transaction. */
  pharmacyId?: string | null;
};

/** The parts of a service context the audit log needs (kept structural to avoid depending on identity). */
export type AuditContext = {
  actor: { id: string };
  meta?: { ip?: string | null; userAgent?: string | null };
  realm?: "STAFF" | "PLATFORM";
  supportSessionId?: string | null;
  /** Overrides actor.id in the audit row (platform support acts through the hidden support account). */
  auditActorId?: string;
};

/** Appends one audit row inside the caller's transaction, so it can never disagree with the data. */
export async function audit(tx: Tx | PrismaClient, ctx: AuditContext, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      realm: ctx.realm ?? "STAFF",
      actorId: ctx.auditActorId ?? ctx.actor.id,
      supportSessionId: ctx.supportSessionId ?? null,
      ...(entry.pharmacyId !== undefined ? { pharmacyId: entry.pharmacyId } : {}),
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
