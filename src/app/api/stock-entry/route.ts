import { route, readJson } from "@/lib/api";
import { createIntake, listIntakes, newIntakeSchema } from "@/modules/stockentry";

export const GET = route("stockEntry.create", async ({ req, svc }) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  return listIntakes(svc, { status: status === "posted" || status === "all" ? status : "open", page: Number(sp.get("page")) || 1 });
});

export const POST = route("stockEntry.create", async ({ req, svc }) => createIntake(svc, newIntakeSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
