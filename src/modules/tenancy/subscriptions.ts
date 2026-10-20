import type { PharmacyStatus } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import { audit, raiseOnce, resolveStale } from "@/modules/platform";

/**
 * Subscription check (roadmap 9.3; architecture, section 5): once a pharmacy's subscription ends it moves to
 * GRACE (staff keep working, with a banner), and after the grace days to SUSPENDED (sign-in stops, data is
 * kept). Statuses this check set return to ACTIVE when the Developer extends the subscription; a status the
 * Developer set by hand is left alone. The Pharmacy Admin is told a week before the end and during grace.
 */
export const GRACE_DAYS = Math.max(0, Number(process.env.SUBSCRIPTION_GRACE_DAYS ?? 7) || 0);
/** Marks a status set by this check (the reason the Developer sees in the console). */
export const AUTO_REASON = "Subscription ended on ";
const DAY = 86_400_000;
const WARN_DAYS = 7;
const TYPES = ["SUBSCRIPTION_ENDING", "SUBSCRIPTION_GRACE"];
const SYSTEM = { actor: { id: "system" }, realm: "PLATFORM" as const };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The day staff sign-in stops for a subscription ending at `endsAt`. */
export const suspendsOn = (endsAt: Date, graceDays = GRACE_DAYS) => day(new Date(endsAt.getTime() + graceDays * DAY));

export async function checkSubscriptions(now = new Date(), graceDays = GRACE_DAYS) {
  const pharmacies = await platformDb.pharmacy.findMany({
    where: { status: { in: ["ACTIVE", "GRACE", "SUSPENDED"] } },
    select: { id: true, status: true, statusReason: true, subscriptionEndsAt: true },
  });
  const moved = { grace: 0, suspended: 0, active: 0, notified: 0 };
  for (const p of pharmacies) {
    const ends = p.subscriptionEndsAt;
    const setByCheck = !!p.statusReason?.startsWith(AUTO_REASON);
    let next: PharmacyStatus | null = null;
    if (ends && ends < now) {
      const graceOver = ends.getTime() + graceDays * DAY <= now.getTime();
      if (p.status === "ACTIVE") next = graceOver ? "SUSPENDED" : "GRACE";
      else if (p.status === "GRACE" && graceOver) next = "SUSPENDED";
    } else if (setByCheck && p.status !== "ACTIVE") {
      next = "ACTIVE";
    }
    await platformDb.$transaction(async (tx) => {
      if (next) {
        const reason = next === "ACTIVE" ? "Subscription renewed" : `${AUTO_REASON}${day(ends!)}`;
        await tx.pharmacy.update({ where: { id: p.id }, data: { status: next, statusReason: reason } });
        await audit(tx, SYSTEM, {
          action: `pharmacy.status.${next.toLowerCase()}`, entity: "Pharmacy", entityId: p.id, pharmacyId: p.id,
          before: { status: p.status, statusReason: p.statusReason }, after: { status: next, statusReason: reason, by: "subscription check" },
        });
        moved[next === "ACTIVE" ? "active" : next === "GRACE" ? "grace" : "suspended"]++;
      }
      const status = next ?? p.status;
      const still = new Set<string>();
      if (ends && status === "ACTIVE" && ends > now && ends.getTime() - now.getTime() <= WARN_DAYS * DAY) {
        const key = `subscription:ending:${day(ends)}`;
        still.add(key);
        if (await raiseOnce(tx, p.id, { type: "SUBSCRIPTION_ENDING", severity: "WARNING", audiencePermission: "settings.manage", dedupeKey: key, title: `The subscription ends on ${day(ends)}`, body: "Please contact your software provider to renew it. Staff can keep working for a few days after it ends." })) moved.notified++;
      }
      if (ends && status === "GRACE") {
        const key = `subscription:grace:${day(ends)}`;
        still.add(key);
        if (await raiseOnce(tx, p.id, { type: "SUBSCRIPTION_GRACE", severity: "CRITICAL", audiencePermission: "settings.manage", dedupeKey: key, title: `The subscription has ended: sign-in stops on ${suspendsOn(ends, graceDays)}`, body: "Your records are safe. Contact your software provider to renew and keep working without a break." })) moved.notified++;
      }
      await resolveStale(tx, p.id, TYPES, still);
    });
  }
  return moved;
}
