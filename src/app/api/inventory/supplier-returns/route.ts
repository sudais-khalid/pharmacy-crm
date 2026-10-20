import { route } from "@/lib/api";
import { supplierReturnList } from "@/modules/inventory";

export const GET = route("inventory.view", async ({ svc }) => supplierReturnList(svc));

export const dynamic = "force-dynamic";
