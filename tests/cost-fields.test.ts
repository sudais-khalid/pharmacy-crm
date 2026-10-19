import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { jsonWithoutCost } from "@/lib/cost-fields";

describe("cost fields", () => {
  it("are removed at any depth, prices to customers stay", () => {
    const data = {
      today: { sales: "100", profit: "40" },
      items: [{ name: "Panadol", salePrice: new Prisma.Decimal("50"), purchasePrice: new Prisma.Decimal("40"), batches: [{ costPrice: "40", quantity: 3 }] }],
      summary: { stockValueCost: "400", stockValueRetail: "500" },
      cogs: "60",
    };
    expect(JSON.parse(jsonWithoutCost(data))).toEqual({
      today: { sales: "100" },
      items: [{ name: "Panadol", salePrice: "50", batches: [{ quantity: 3 }] }],
      summary: { stockValueRetail: "500" },
    });
  });
});
