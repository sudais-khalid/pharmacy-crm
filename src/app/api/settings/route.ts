import { route, readJson } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/modules/platform";

export const GET = route(null, async () => prisma.setting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }));

export const PUT = route("settings.manage", async ({ req }) => {
  const data = settingsSchema.parse(await readJson(req));
  return prisma.setting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
});

export const dynamic = "force-dynamic";
