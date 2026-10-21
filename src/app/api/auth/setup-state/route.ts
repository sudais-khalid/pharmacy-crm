import { NextResponse } from "next/server";
import { installationHasPharmacies } from "@/modules/tenancy";

/** Public: whether this installation has a pharmacy yet (a new one sends the Developer to the console). */
export async function GET() {
  return NextResponse.json({ hasPharmacies: await installationHasPharmacies() }, { headers: { "cache-control": "no-store" } });
}

export const dynamic = "force-dynamic";
