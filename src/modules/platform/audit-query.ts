import type { Prisma } from "@prisma/client";
import { runInTx, type DbContext } from "@/lib/db";

/**
 * The pharmacy's activity history for its admins (docs/plan/05-roadmap.md, task 3.10). Row-level security
 * limits it to the pharmacy's own rows. Work done by the Developer inside the pharmacy is shown as
 * "Platform support", never under a staff member's name.
 */
export type AuditFilter = { entity?: string; entityId?: string; actorId?: string; action?: string; from?: string; to?: string; page?: number; pageSize?: number };

export async function listAudit(ctx: DbContext, filter: AuditFilter) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 30));
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.entity ? { entity: filter.entity } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.actorId ? { actorId: filter.actorId, realm: "STAFF" as const } : {}),
    ...(filter.action ? { action: { startsWith: filter.action } } : {}),
    ...(filter.from || filter.to ? { at: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}) } } : {}),
  };
  return runInTx(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.auditLog.count({ where }),
      tx.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const staffIds = [...new Set(rows.filter((r) => r.realm === "STAFF" && r.actorId).map((r) => r.actorId!))];
    const staff = new Map((await tx.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const items = rows.map((r) => ({
      id: r.id.toString(),
      at: r.at,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      actor: r.realm === "PLATFORM" ? "Platform support" : (r.actorId && staff.get(r.actorId)) || "System",
      byPlatform: r.realm === "PLATFORM",
      before: r.before,
      after: r.after,
      ip: r.ip,
    }));
    return { total, page, pageSize, items };
  });
}
