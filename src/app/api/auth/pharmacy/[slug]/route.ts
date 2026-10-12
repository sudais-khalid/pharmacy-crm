import { NextResponse } from "next/server";
import { publicPharmacyInfo } from "@/modules/tenancy";

/** Public: the pharmacy name for a sign-in page, or 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const info = await publicPharmacyInfo((await params).slug);
  if (!info) return NextResponse.json({ error: "No pharmacy with this code." }, { status: 404 });
  return NextResponse.json(info, { headers: { "cache-control": "no-store" } });
}

export const dynamic = "force-dynamic";
