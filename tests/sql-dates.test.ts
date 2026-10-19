import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import { TZ } from "@/lib/dates";
import { localDate } from "@/lib/sql-dates";

describe("local dates in SQL", () => {
  it("put a sale at 1 am Karachi time (8 pm UTC) on the local day, not the day before", async () => {
    expect(TZ).toBe("Asia/Karachi");
    const [row] = await platformDb.$queryRaw<{ d: string }[]>`SELECT ${localDate(Prisma.sql`'2026-10-19 20:00:00'::timestamp`)}::text AS d`;
    expect(row.d).toBe("2026-10-20");
    const [noon] = await platformDb.$queryRaw<{ d: string }[]>`SELECT ${localDate(Prisma.sql`'2026-10-19 07:00:00'::timestamp`)}::text AS d`;
    expect(noon.d).toBe("2026-10-19");
  });
});
