import bcrypt from "bcryptjs";
import { route, readJson, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { userUpdateSchema } from "@/modules/identity";

export const PUT = route("users.manage", async ({ req, params, user }) => {
  const { password, ...data } = userUpdateSchema.parse(await readJson(req));
  if (params.id === user.id && (data.active === false || (data.role && data.role !== "ADMIN"))) {
    throw new AppError(409, "You cannot deactivate or demote your own account.");
  }
  return prisma.user.update({
    where: { id: params.id },
    data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
});

export const dynamic = "force-dynamic";
