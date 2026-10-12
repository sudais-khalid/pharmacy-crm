import { platformOverview } from "@/modules/tenancy";
import { platformRoute } from "../_lib/platform-route";

export const GET = platformRoute(async () => platformOverview());

export const dynamic = "force-dynamic";
