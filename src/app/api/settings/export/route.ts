import { route } from "@/lib/api";
import { audit } from "@/modules/platform";
import { exportPharmacyData, zipResponse } from "@/modules/tenancy";

/** The Pharmacy Admin downloads all of the pharmacy's data (roadmap 9.4). Audited. */
export const POST = route("data.export", async ({ svc, db, user }) => {
  const r = await exportPharmacyData(user.pharmacyId);
  await audit(db, svc, { action: "pharmacy.export", entity: "Pharmacy", entityId: user.pharmacyId, after: { file: r.name, bytes: r.file.length } });
  return zipResponse(r);
});

export const dynamic = "force-dynamic";
