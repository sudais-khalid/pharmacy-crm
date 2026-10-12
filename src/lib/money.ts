import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);
