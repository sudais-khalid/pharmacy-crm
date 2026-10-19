import { describe, it, expect } from "vitest";
import { blankLine, expiryToIso, isoToExpiry, lineTotal, toApiLine } from "@/app/(app)/stock-entry/grid";

describe("stock entry grid helpers", () => {
  it("reads expiry the way bills print it, as the end of that month", () => {
    expect(expiryToIso("04/28")).toBe("2028-04-30");
    expect(expiryToIso("2/2028")).toBe("2028-02-29");
    expect(expiryToIso("11-27")).toBe("2027-11-30");
    expect(expiryToIso("2027-06-15")).toBe("2027-06-15");
    expect(expiryToIso("13/27")).toBeNull();
    expect(expiryToIso("soon")).toBeNull();
    expect(isoToExpiry("2028-04-30")).toBe("04/28");
  });

  it("computes the line total like the server", () => {
    const l = { ...blankLine(), quantity: "100", rate: "2.80", discountPercent: "10", taxAmount: "12.6" };
    expect(lineTotal(l)).toBe(264.6);
    expect(lineTotal({ ...l, rate: "" })).toBeNull();
    expect(toApiLine({ ...l, quantity: "1,000", bonusQty: "" })).toMatchObject({ quantity: 1000, bonusQty: null, rate: 2.8, discountPercent: 10 });
  });
});
