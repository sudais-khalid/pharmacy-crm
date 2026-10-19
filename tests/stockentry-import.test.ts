import { describe, it, expect } from "vitest";
import { guessMapping, parseCsv } from "@/app/(app)/stock-entry/import-map";

describe("file import", () => {
  it("reads CSV with quotes, semicolons and blank lines", () => {
    expect(parseCsv('Name,Qty,Exp\r\n"Panadol, 500mg",20,04/28\n\n"Brufen ""Syrup""",6,11/27')).toEqual([["Name", "Qty", "Exp"], ["Panadol, 500mg", "20", "04/28"], ['Brufen "Syrup"', "6", "11/27"]]);
    expect(parseCsv("Item;Stock\nAmoxil;12")).toEqual([["Item", "Stock"], ["Amoxil", "12"]]);
  });
  it("guesses which column holds what from the headings", () => {
    expect(guessMapping(["Sr", "Product Name", "Batch No", "Expiry", "Qty", "Free", "T.P", "Retail Price", "Barcode"])).toEqual(["", "name", "batchNumber", "expiry", "quantity", "bonusQty", "rate", "salePrice", "barcode"]);
  });
});
