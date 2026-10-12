import { listAccounts } from "@/modules/tenancy";
import { platformRoute } from "../_lib/platform-route";

export const GET = platformRoute(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  return listAccounts({ q: sp.get("q")?.trim() || undefined, pharmacyId: sp.get("pharmacyId") || undefined, page: Number(sp.get("page")) || 1 });
});

export const dynamic = "force-dynamic";
