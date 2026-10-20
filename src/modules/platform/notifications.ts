import type { PrismaClient } from "@prisma/client";
import { runInTx, type DbContext } from "@/lib/db";
import type { Tx } from "@/lib/prisma";

/**
 * Notifications (data model, section 5): something staff with a given permission should see or act on.
 * A repeated condition (same dedupeKey) updates its open notification instead of adding another; a
 * resolved one comes back as new when the condition returns.
 */
export type NewNotification = {
  type: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body?: string;
  link?: string | null;
  audiencePermission: string;
  dedupeKey: string;
};

/** Creates or refreshes a notification for one pharmacy. `db` is a tenant transaction or the platform client. */
export async function notify(db: Tx | PrismaClient, pharmacyId: string, n: NewNotification) {
  const data = { type: n.type, severity: n.severity ?? "INFO", title: n.title, body: n.body ?? "", link: n.link ?? null, audiencePermission: n.audiencePermission };
  return db.notification.upsert({
    where: { pharmacyId_dedupeKey: { pharmacyId, dedupeKey: n.dedupeKey } },
    create: { pharmacyId, dedupeKey: n.dedupeKey, ...data },
    // a refreshed notification is unread again for everyone
    update: { ...data, createdAt: new Date(), resolvedAt: null, reads: { deleteMany: {} } },
  });
}

/**
 * Raises a standing condition (a batch near expiry, a medicine out of stock) once: a new notification, or a
 * resolved one opened again. One that is still open is left alone, so a daily scan does not make it unread
 * every day. Returns whether something was raised.
 */
export async function raiseOnce(db: Tx | PrismaClient, pharmacyId: string, n: NewNotification): Promise<boolean> {
  const existing = await db.notification.findUnique({ where: { pharmacyId_dedupeKey: { pharmacyId, dedupeKey: n.dedupeKey } }, select: { resolvedAt: true } });
  if (existing && !existing.resolvedAt) return false;
  await notify(db, pharmacyId, n);
  return true;
}

/** Resolves the open notifications of these types whose condition no longer holds (their key is not in `still`). */
export async function resolveStale(db: Tx | PrismaClient, pharmacyId: string, types: string[], still: Set<string>) {
  const open = await db.notification.findMany({ where: { pharmacyId, type: { in: types }, resolvedAt: null }, select: { dedupeKey: true } });
  const gone = open.map((o) => o.dedupeKey).filter((k) => !still.has(k));
  if (gone.length) await resolveNotifications(db, pharmacyId, gone);
  return gone.length;
}

/** Marks a condition as handled (for example, the reset link was issued). */
export async function resolveNotifications(db: Tx | PrismaClient, pharmacyId: string, dedupeKeys: string[]) {
  await db.notification.updateMany({ where: { pharmacyId, dedupeKey: { in: dedupeKeys }, resolvedAt: null }, data: { resolvedAt: new Date() } });
}

/** Kinds of notification, for the drawer's filter. */
export const NOTIFICATION_GROUPS = {
  expiry: ["EXPIRY_SOON", "EXPIRY_7", "EXPIRED"],
  stock: ["LOW_STOCK", "OUT_OF_STOCK"],
} as const;
export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS | "other";

/**
 * Open notifications this person may see, most serious and newest first, with whether they have read
 * each, and the counts per group for the drawer's tabs.
 */
export async function listNotifications(
  ctx: DbContext & { actor: { id: string; permissions: readonly string[] } },
  filter: { group?: NotificationGroup; take?: number } = {},
) {
  const known = Object.values(NOTIFICATION_GROUPS).flat() as string[];
  const typeWhere = !filter.group ? {} : filter.group === "other" ? { type: { notIn: known } } : { type: { in: [...NOTIFICATION_GROUPS[filter.group]] as string[] } };
  return runInTx(ctx, async (tx) => {
    const base = { resolvedAt: null, audiencePermission: { in: [...ctx.actor.permissions] } };
    const [rows, unread, byType] = await Promise.all([
      tx.notification.findMany({
        where: { ...base, ...typeWhere },
        orderBy: { createdAt: "desc" },
        take: Math.min(filter.take ?? 50, 200),
        include: { reads: { where: { userId: ctx.actor.id }, select: { readAt: true } } },
      }),
      tx.notification.count({ where: { ...base, reads: { none: { userId: ctx.actor.id } } } }),
      tx.notification.groupBy({ by: ["type"], where: base, _count: true }),
    ]);
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
    const items = rows.map(({ reads, ...n }) => ({ ...n, read: reads.length > 0 }))
      .sort((a, b) => Number(a.read) - Number(b.read) || (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.createdAt.getTime() - a.createdAt.getTime());
    const count = (types: readonly string[]) => byType.filter((t) => types.includes(t.type)).reduce((n, t) => n + t._count, 0);
    const groups = { expiry: count(NOTIFICATION_GROUPS.expiry), stock: count(NOTIFICATION_GROUPS.stock), other: byType.filter((t) => !known.includes(t.type)).reduce((n, t) => n + t._count, 0) };
    return { unread, groups, items };
  });
}

export async function markNotificationsRead(ctx: DbContext & { actor: { id: string; permissions: readonly string[] } }, ids: string[] | "all") {
  return runInTx(ctx, async (tx) => {
    const visible = await tx.notification.findMany({
      where: { resolvedAt: null, audiencePermission: { in: [...ctx.actor.permissions] }, ...(ids === "all" ? {} : { id: { in: ids } }) },
      select: { id: true },
    });
    await tx.notificationRead.createMany({ data: visible.map((n) => ({ notificationId: n.id, userId: ctx.actor.id })), skipDuplicates: true });
    return { read: visible.length };
  });
}
