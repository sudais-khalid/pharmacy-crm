import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicPharmacyInfo } from "@/modules/tenancy";
import { StaffLoginForm } from "@/components/staff-login-form";

export const dynamic = "force-dynamic";

/** Sign-in page of one pharmacy, e.g. /p/city-care/login. */
export default async function PharmacyLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const info = await publicPharmacyInfo((await params).slug);
  if (!info) notFound();
  return (
    <Suspense>
      <StaffLoginForm pharmacy={info} />
    </Suspense>
  );
}
