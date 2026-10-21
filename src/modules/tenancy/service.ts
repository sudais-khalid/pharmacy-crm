import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PharmacyStatus, Prisma } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import { listServerBackups, readBackupStatus } from "@/lib/backup";
import { AppError } from "@/lib/errors";
import { audit, FEATURE_KEYS, FEATURE_FLAGS, getFeatureFlags, type FeatureKey } from "@/modules/platform";
import { ADMIN_ROLE_ID, ensureSupportAccount, issueStaffToken, temporaryPassword } from "@/modules/identity";
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


export async function createPharmacy(c: DevContext, input: CreatePharmacyInput) {
  const exists = await platformDb.pharmacy.findUnique({ where: { slug: input.pharmacy.slug } });
  if (exists) throw new AppError(409, "A pharmacy with this URL name already exists.", { fields: { "pharmacy.slug": "Already taken" } });

  const password = input.credentials === "password" ? temporaryPassword() : null;
  const adminHash = password ? await bcrypt.hash(password, 10) : await unusableHash();

  const created = await platformDb.$transaction(async (tx) => {
    const { slug, ...profile } = input.pharmacy;
    const pharmacy = await tx.pharmacy.create({
      data: {
        slug, ...profile, plan: input.plan.plan, maxUsers: input.plan.maxUsers, ocrMonthlyLimit: input.plan.ocrMonthlyLimit, ocrProviders: input.plan.ocrProviders,
        subscriptionEndsAt: input.plan.subscriptionEndsAt ? new Date(`${input.plan.subscriptionEndsAt}T23:59:59Z`) : null,
        createdById: c.devId,
        settings: { create: {} },
      },
    });
    // hidden account that platform support sessions act as (sales and stock rows need a staff user)
    await ensureSupportAccount(tx, pharmacy.id);
    const admin = await tx.user.create({
      data: { pharmacyId: pharmacy.id, name: input.admin.name, username: input.admin.username, email: input.admin.email, passwordHash: adminHash, roleId: ADMIN_ROLE_ID, mustChangePassword: !!password },
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
    platformDb.user.findMany({ where: { pharmacyId: id, isSystem: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, username: true, email: true, role: { select: { key: true, name: true } }, active: true, lastLoginAt: true, mustChangePassword: true } }),
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
    usage: await platformUsage(),
    backups: serverBackups(),
  };
}

/** Server backups for the console (roadmap 9.1): the last run and the newest files. Null on the desktop. */
function serverBackups() {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return null;
  return { status: readBackupStatus(dir), recent: listServerBackups(dir).slice(0, 10).map((b) => ({ name: b.name, at: b.at.toISOString(), size: b.size, reason: b.reason })) };
}

/**
 * Usage per pharmacy (roadmap 8.9): invoices this month and last, staff who signed in within 30 days,
 * OCR pages read this month and the space its stored files take. Counts only, never business figures.
 */
export async function platformUsage(now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ocrKey = `USAGE_OCR_${now.toISOString().slice(0, 7).replace("-", "")}`;
  const rows = await platformDb.$queryRaw<{ id: string; name: string; slug: string; status: string; invoices: number; invoicesLastMonth: number; activeUsers: number; ocrPages: bigint; storageBytes: bigint }[]>`
    SELECT p.id, p.name, p.slug, p.status::text AS status,
           (SELECT COUNT(*) FROM "Sale" s WHERE s."pharmacyId" = p.id AND s.status = 'COMPLETED' AND s."createdAt" >= ${monthStart})::int AS invoices,
           (SELECT COUNT(*) FROM "Sale" s WHERE s."pharmacyId" = p.id AND s.status = 'COMPLETED' AND s."createdAt" >= ${lastMonthStart} AND s."createdAt" < ${monthStart})::int AS "invoicesLastMonth",
           (SELECT COUNT(*) FROM "User" u WHERE u."pharmacyId" = p.id AND u.active AND NOT u."isSystem" AND u."lastLoginAt" >= ${new Date(now.getTime() - 30 * 86400000)})::int AS "activeUsers",
           COALESCE((SELECT c.value FROM "TenantCounter" c WHERE c."pharmacyId" = p.id AND c.key = ${ocrKey}), 0)::bigint AS "ocrPages",
           COALESCE((SELECT SUM(f.size) FROM "StoredFile" f WHERE f."pharmacyId" = p.id), 0)::bigint AS "storageBytes"
    FROM "Pharmacy" p ORDER BY p.name`;
  return rows.map((r) => ({ ...r, ocrPages: Number(r.ocrPages), storageBytes: Number(r.storageBytes) }));
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

// ---------------------------------------------------------------- staff accounts across pharmacies

const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MAX = 8;

/** Login rate-limit buckets of one account: login:<ip>:<pharmacy slug>:<username> (see the login route). */
const loginBuckets = (slug: string, username: string) => ({ bucket: { startsWith: "login:", endsWith: `:${slug}:${username}` } });

export async function listAccounts(filter: { q?: string; pharmacyId?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, filter.pageSize ?? 25);
  const where: Prisma.UserWhereInput = {
    isSystem: false,
    ...(filter.pharmacyId ? { pharmacyId: filter.pharmacyId } : {}),
    ...(filter.q
      ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { username: { contains: filter.q.toLowerCase() } }, { email: { contains: filter.q, mode: "insensitive" } }] }
      : {}),
  };
  const [total, users] = await Promise.all([
    platformDb.user.count({ where }),
    platformDb.user.findMany({
      where, orderBy: [{ pharmacy: { name: "asc" } }, { name: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, username: true, email: true, role: { select: { key: true, name: true } }, active: true, lastLoginAt: true, mustChangePassword: true, pharmacy: { select: { id: true, name: true, slug: true, status: true } } },
    }),
  ]);
  const since = new Date(Date.now() - LOGIN_LOCK_WINDOW_MS);
  const items = await Promise.all(
    users.map(async (u) => ({ ...u, locked: (await platformDb.rateLimitHit.count({ where: { ...loginBuckets(u.pharmacy.slug, u.username), at: { gt: since } } })) >= LOGIN_LOCK_MAX })),
  );
  return { total, page, pageSize, items };
}

async function staffAccount(id: string) {
  const user = await platformDb.user.findUnique({ where: { id }, select: { id: true, username: true, active: true, isSystem: true, pharmacyId: true, pharmacy: { select: { slug: true } } } });
  if (!user || user.isSystem) throw new AppError(404, "Account not found.");
  return user;
}

/** Deactivating ends every session of the account at once. */
export async function setAccountActive(c: DevContext, id: string, active: boolean) {
  const user = await staffAccount(id);
  if (user.active === active) return { active };
  if (active) {
    const pharmacy = await platformDb.pharmacy.findUniqueOrThrow({ where: { id: user.pharmacyId }, select: { maxUsers: true } });
    const activeStaff = await platformDb.user.count({ where: { pharmacyId: user.pharmacyId, active: true, isSystem: false } });
    if (activeStaff >= pharmacy.maxUsers) throw new AppError(409, `The plan allows ${pharmacy.maxUsers} active staff accounts. Raise the limit first.`);
  }
  await platformDb
    .$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { active, ...(active ? {} : { sessionVersion: { increment: 1 } }) } });
      await audit(tx, actorOf(c), { action: active ? "user.activate" : "user.deactivate", entity: "User", entityId: id, pharmacyId: user.pharmacyId, before: { active: user.active }, after: { active } });
    })
    .catch((e: unknown) => {
      // the database keeps one active Pharmacy Admin per pharmacy, for the Developer too
      if (e instanceof Error && e.message.includes("at least one active Pharmacy Admin")) {
        throw new AppError(409, "This is the pharmacy's last active Pharmacy Admin. Make another account Pharmacy Admin first.");
      }
      throw e;
    });
  return { active };
}

export async function forceLogoutAccount(c: DevContext, id: string) {
  const user = await staffAccount(id);
  await platformDb.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, actorOf(c), { action: "user.logout.force", entity: "User", entityId: id, pharmacyId: user.pharmacyId });
  });
  return { ok: true };
}

/** A password reset link for any staff account; shown once to the Developer. */
export async function issueAccountReset(c: DevContext, id: string) {
  await staffAccount(id);
  const { path, expiresAt } = await issueStaffToken(id, "RESET", { realm: "PLATFORM", id: c.devId, meta: c.meta });
  return { path, expiresAt };
}

/** Clears failed sign-in attempts that locked the account. */
export async function unlockAccount(c: DevContext, id: string) {
  const user = await staffAccount(id);
  const { count } = await platformDb.rateLimitHit.deleteMany({ where: loginBuckets(user.pharmacy.slug, user.username) });
  await audit(platformDb, actorOf(c), { action: "user.unlock", entity: "User", entityId: id, pharmacyId: user.pharmacyId, after: { clearedAttempts: count } });
  return { clearedAttempts: count };
}

// ---------------------------------------------------------------- plan, limits and feature switches

export async function setPharmacyPlan(c: DevContext, id: string, input: { plan: string; maxUsers: number; ocrMonthlyLimit: number; ocrProviders?: string[]; subscriptionEndsAt?: string | null }) {
  return platformDb.$transaction(async (tx) => {
    const before = await tx.pharmacy.findUnique({ where: { id }, select: { plan: true, maxUsers: true, ocrMonthlyLimit: true, ocrProviders: true, subscriptionEndsAt: true } });
    if (!before) throw new AppError(404, "Pharmacy not found.");
    const after = await tx.pharmacy.update({
      where: { id },
      data: {
        plan: input.plan, maxUsers: input.maxUsers, ocrMonthlyLimit: input.ocrMonthlyLimit,
        ...(input.ocrProviders ? { ocrProviders: [...new Set(input.ocrProviders)] } : {}),
        subscriptionEndsAt: input.subscriptionEndsAt ? new Date(`${input.subscriptionEndsAt}T23:59:59Z`) : null,
      },
      select: { plan: true, maxUsers: true, ocrMonthlyLimit: true, ocrProviders: true, subscriptionEndsAt: true },
    });
    await audit(tx, actorOf(c), { action: "pharmacy.plan.update", entity: "Pharmacy", entityId: id, pharmacyId: id, before, after });
    return after;
  });
}

export async function setFeatureFlag(c: DevContext, id: string, key: FeatureKey, enabled: boolean) {
  if (!FEATURE_KEYS.includes(key)) throw new AppError(400, "Unknown feature.");
  return platformDb.$transaction(async (tx) => {
    const pharmacy = await tx.pharmacy.findUnique({ where: { id }, select: { id: true } });
    if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
    const before = await tx.featureFlag.findUnique({ where: { pharmacyId_key: { pharmacyId: id, key } } });
    await tx.featureFlag.upsert({ where: { pharmacyId_key: { pharmacyId: id, key } }, update: { enabled }, create: { pharmacyId: id, key, enabled } });
    await audit(tx, actorOf(c), {
      action: "pharmacy.feature.update", entity: "Pharmacy", entityId: id, pharmacyId: id,
      before: { [key]: before?.enabled ?? FEATURE_FLAGS[key].defaultOn }, after: { [key]: enabled },
    });
    return { key, enabled };
  });
}

/** What a sign-in page may show about a pharmacy before anyone signs in. */
/**
 * Public: whether any pharmacy exists yet. On a new installation the sign-in page then points the
 * Developer to the console, where the first pharmacy is created; nothing else is revealed.
 */
export async function installationHasPharmacies() {
  return (await platformDb.pharmacy.count({ where: { status: { not: "DEACTIVATED" } } })) > 0;
}

export async function publicPharmacyInfo(slug: string) {
  const p = await platformDb.pharmacy.findUnique({ where: { slug: slug.toLowerCase() }, select: { slug: true, name: true, city: true, status: true, brandColor: true, logoFileId: true } });
  if (!p || p.status === "DEACTIVATED") return null;
  return { slug: p.slug, name: p.name, city: p.city, suspended: p.status === "SUSPENDED", brandColor: p.brandColor, hasLogo: !!p.logoFileId };
}
