import type { Prisma } from "@prisma/client";

/** Plain JSON copy of a value (Decimal becomes a string, Date an ISO string) for Json columns. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
