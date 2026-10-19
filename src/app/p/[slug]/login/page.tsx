import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicPharmacyInfo } from "@/modules/tenancy";
import { StaffLoginForm } from "@/components/staff-login-form";
import { BrandStyle } from "@/components/brand-style";

export const dynamic = "force-dynamic";

/** Sign-in page of one pharmacy, e.g. /p/city-care/login. */
export default async function PharmacyLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const info = await publicPharmacyInfo((await params).slug);
  if (!info) notFound();
  return (
    <Suspense>
      <BrandStyle color={info.brandColor} />
      <StaffLoginForm pharmacy={info} />
    </Suspense>
  );
}
