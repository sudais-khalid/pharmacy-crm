import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { platformDb } from "@/lib/platform-db";
import { confirmStaffEnrolment, setStaffSession, startStaffEnrolment } from "@/modules/identity";

/** Own two-factor status; with ?start=1 also the secret and QR code to set it up. */
export const GET = route(null, async ({ req, user }) => {
  const row = await platformDb.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabledAt: true, recoveryCodes: true, pharmacy: { select: { settings: { select: { requireStaffTotp: true } } } } } });
  const status = { enabled: !!row.totpEnabledAt, required: row.pharmacy.settings?.requireStaffTotp ?? false, pending: user.secondFactor ?? null, recoveryCodesLeft: row.recoveryCodes.length };
  if (!status.enabled && req.nextUrl.searchParams.get("start") === "1") return { ...status, enrolment: await startStaffEnrolment(user.id) };
  return status;
}, { allowSecondFactor: true });

const confirmSchema = z.object({ code: z.string().trim().min(6).max(10) });

/** Confirms set-up with a first code; the recovery codes are returned once. */
export const POST = route(null, async ({ req, user, svc }) => {
  const { code } = confirmSchema.parse(await readJson(req));
  const r = await confirmStaffEnrolment(user.id, code, svc.meta);
  await setStaffSession({ id: user.id, pharmacyId: user.pharmacyId, sessionVersion: r.sessionVersion }, true);
  return { recoveryCodes: r.recoveryCodes };
}, { allowSecondFactor: true });

export const dynamic = "force-dynamic";
