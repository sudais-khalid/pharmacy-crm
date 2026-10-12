import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PharmacyStatus, Prisma } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import { AppError } from "@/lib/errors";
import { audit, FEATURE_KEYS, FEATURE_FLAGS, getFeatureFlags, type FeatureKey } from "@/modules/platform";
import { issueStaffToken } from "@/modules/identity";
import type { CreatePharmacyInput } from "./schema";

/**
 * Developer console operations across pharmacies (docs/plan/02-architecture.md, sections 5 and 6.7).
 * Runs with the platform client; every change is audited as a platform action against the pharmacy.
 */
export type DevContext = { devId: string; meta?: { ip?: string | null; userAgent?: string | null } };
const actorOf = (c: DevContext) => ({ actor: { id: c.devId }, meta: c.meta, realm: "PLATFORM" as const });

/** A bcrypt hash of random bytes: a password nobody knows, for accounts that must not sign in yet. */
async function unusableHash() {
  return bcrypt.hash(randomBytes(32).toString("base64url"), 10);
}

/** A temporary password that is readable over the phone: 4 groups of 4. */
export function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const raw = Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

const SUPPORT_USERNAME = "platform-support";

export async function createPharmacy(c: DevContext, input: CreatePharmacyInput) {
  const exists = await platformDb.pharmacy.findUnique({ where: { slug: input.pharmacy.slug } });
  if (exists) throw new AppError(409, "A pharmacy with this URL name already exists.", { fields: { "pharmacy.slug": "Already taken" } });
  const emailTaken = await platformDb.user.findUnique({ where: { email: input.admin.email } });
  if (emailTaken) throw new AppError(409, "This email is already used by another account.", { fields: { "admin.email": "Already used" } });

  const password = input.credentials === "password" ? temporaryPassword() : null;
  const [adminHash, supportHash] = await Promise.all([password ? bcrypt.hash(password, 10) : unusableHash(), unusableHash()]);

  const created = await platformDb.$transaction(async (tx) => {
    const { slug, ...profile } = input.pharmacy;
    const pharmacy = await tx.pharmacy.create({
      data: {
        slug, ...profile, plan: input.plan.plan, maxUsers: input.plan.maxUsers, ocrMonthlyLimit: input.plan.ocrMonthlyLimit,
        subscriptionEndsAt: input.plan.subscriptionEndsAt ? new Date(`${input.plan.subscriptionEndsAt}T23:59:59Z`) : null,
        createdById: c.devId,
        settings: { create: {} },
      },
    });
    // hidden account that platform support sessions act as (sales and stock rows need a staff user)
    await tx.user.create({
      data: { pharmacyId: pharmacy.id, name: "Platform support", username: SUPPORT_USERNAME, email: `support-${pharmacy.id}@system.invalid`, passwordHash: supportHash, role: "ADMIN", isSystem: true },
    });
    const admin = await tx.user.create({
      data: { pharmacyId: pharmacy.id, name: input.admin.name, username: input.admin.username, email: input.admin.email, passwordHash: adminHash, role: "ADMIN", mustChangePassword: !!password },
      select: { id: true, username: true, name: true },
    });
    const chosen = new Set(input.features);
    await tx.featureFlag.createMany({ data: FEATURE_KEYS.map((key) => ({ pharmacyId: pharmacy.id, key, enabled: chosen.has(key) })) });
    await audit(tx, actorOf(c), {
      action: "pharmacy.create", entity: "Pharmacy", entityId: pharmacy.id, pharmacyId: pharmacy.id,
      after: { slug, name: pharmacy.name, plan: input.plan, features: [...chosen], admin: { username: admin.username, credentials: input.credentials } },
    });
    return { pharmacy, admin };
  });

  const credentials = password
    ? { kind: "password" as const, password }
    : { kind: "invite" as const, ...(await issueStaffToken(created.admin.id, "INVITE", { realm: "PLATFORM", id: c.devId, meta: c.meta })) };
  return { pharmacy: { id: created.pharmacy.id, slug: created.pharmacy.slug, name: created.pharmacy.name }, admin: created.admin, credentials };
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Pharmacies with the figures the console list shows. */
export async function listPharmacies(filter: { q?: string; status?: PharmacyStatus } = {}) {
  const where: Prisma.PharmacyWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { slug: { contains: filter.q.toLowerCase() } }, { city: { contains: filter.q, mode: "insensitive" } }] } : {}),
  };
  const pharmacies = await platformDb.pharmacy.findMany({ where, orderBy: { createdAt: "desc" } });
  const ids = pharmacies.map((p) => p.id);
  const [staff, invoices, activity] = await Promise.all([
    platformDb.user.groupBy({ by: ["pharmacyId"], where: { pharmacyId: { in: ids }, isSystem: false }, _count: { _all: true } }),
    platformDb.sale.groupBy({ by: ["pharmacyId"], where: { pharmacyId: { in: ids }, createdAt: { gte: monthStart() }, status: "COMPLETED" }, _count: { _all: true } }),
    platformDb.auditLog.groupBy({ by: ["pharmacyId"], where: { pharmacyId: { in: ids }, realm: "STAFF" }, _max: { at: true } }),
  ]);
  const count = (rows: { pharmacyId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.pharmacyId === id)?._count._all ?? 0;
  return pharmacies.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, city: p.city, status: p.status, plan: p.plan, subscriptionEndsAt: p.subscriptionEndsAt, maxUsers: p.maxUsers, createdAt: p.createdAt,
    staffCount: count(staff, p.id),
    invoicesThisMonth: count(invoices, p.id),
    lastActivityAt: activity.find((a) => a.pharmacyId === p.id)?._max.at ?? null,
  }));
}

export async function getPharmacyDetail(id: string) {
  const pharmacy = await platformDb.pharmacy.findUnique({ where: { id }, include: { settings: true } });
  if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
  const [staff, flags, audits, supportSessions] = await Promise.all([
    platformDb.user.findMany({ where: { pharmacyId: id, isSystem: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, username: true, email: true, role: true, active: true, lastLoginAt: true, mustChangePassword: true } }),
    getFeatureFlags(platformDb, id),
    platformDb.auditLog.findMany({ where: { pharmacyId: id }, orderBy: { id: "desc" }, take: 50, select: { id: true, at: true, realm: true, actorId: true, action: true, entity: true, entityId: true, supportSessionId: true } }),
    platformDb.supportSession.findMany({ where: { pharmacyId: id }, orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  return {
    pharmacy,
    staff,
    flags: FEATURE_KEYS.map((key) => ({ key, label: FEATURE_FLAGS[key].label, enabled: flags[key as FeatureKey] })),
    audits: audits.map((a) => ({ ...a, id: a.id.toString() })),
    supportSessions,
  };
}

export async function updatePharmacyProfile(c: DevContext, id: string, data: Prisma.PharmacyUpdateInput) {
  return platformDb.$transaction(async (tx) => {
    const before = await tx.pharmacy.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Pharmacy not found.");
    const after = await tx.pharmacy.update({ where: { id }, data });
    await audit(tx, actorOf(c), { action: "pharmacy.profile.update", entity: "Pharmacy", entityId: id, pharmacyId: id, before, after });
    return after;
  });
}

/** Developer overview: counts by status and what needs attention. */
export async function platformOverview() {
  const soon = new Date(Date.now() + 14 * 86400 * 1000);
  const [byStatus, endingSoon, newest, recent] = await Promise.all([
    platformDb.pharmacy.groupBy({ by: ["status"], _count: { _all: true } }),
    platformDb.pharmacy.findMany({ where: { subscriptionEndsAt: { lte: soon }, status: { in: ["ACTIVE", "GRACE"] } }, orderBy: { subscriptionEndsAt: "asc" }, take: 10, select: { id: true, name: true, slug: true, subscriptionEndsAt: true, status: true } }),
    platformDb.pharmacy.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, slug: true, createdAt: true, status: true } }),
    platformDb.auditLog.findMany({ where: { realm: "PLATFORM" }, orderBy: { id: "desc" }, take: 15, select: { id: true, at: true, action: true, entity: true, entityId: true, pharmacyId: true } }),
  ]);
  return {
    counts: Object.fromEntries(["ACTIVE", "GRACE", "SUSPENDED", "DEACTIVATED"].map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])),
    endingSoon,
    newest,
    recent: recent.map((r) => ({ ...r, id: r.id.toString() })),
  };
}

/** Changes a pharmacy's status. Staff sessions of a suspended or deactivated pharmacy end on their next request. */
export async function setPharmacyStatus(c: DevContext, id: string, input: { status: PharmacyStatus; reason: string }) {
  return platformDb.$transaction(async (tx) => {
    const before = await tx.pharmacy.findUnique({ where: { id }, select: { status: true, statusReason: true } });
    if (!before) throw new AppError(404, "Pharmacy not found.");
    if (before.status === input.status) throw new AppError(409, "The pharmacy already has this status.");
    const after = await tx.pharmacy.update({ where: { id }, data: { status: input.status, statusReason: input.reason }, select: { status: true, statusReason: true } });
    await audit(tx, actorOf(c), { action: `pharmacy.status.${input.status.toLowerCase()}`, entity: "Pharmacy", entityId: id, pharmacyId: id, before, after });
    return after;
  });
}
