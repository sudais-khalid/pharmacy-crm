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

/** Marks a condition as handled (for example, the reset link was issued). */
export async function resolveNotifications(db: Tx | PrismaClient, pharmacyId: string, dedupeKeys: string[]) {
  await db.notification.updateMany({ where: { pharmacyId, dedupeKey: { in: dedupeKeys }, resolvedAt: null }, data: { resolvedAt: new Date() } });
}

/** Open notifications this person may see, newest first, with whether they have read each. */
export async function listNotifications(ctx: DbContext & { actor: { id: string; permissions: readonly string[] } }) {
  return runInTx(ctx, async (tx) => {
    const rows = await tx.notification.findMany({
      where: { resolvedAt: null, audiencePermission: { in: [...ctx.actor.permissions] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { reads: { where: { userId: ctx.actor.id }, select: { readAt: true } } },
    });
    const items = rows.map(({ reads, ...n }) => ({ ...n, read: reads.length > 0 }));
    return { unread: items.filter((n) => !n.read).length, items };
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
