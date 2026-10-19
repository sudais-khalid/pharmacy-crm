import { describe, it, expect } from "vitest";
import { brandColorProblem, brandCss, contrast, onColor, palette, parseHex, toHex } from "@/lib/brand";

describe("brand colour", () => {
  it("accepts readable colours and builds the palette around them", () => {
    expect(brandColorProblem("#1F7F78")).toBeNull();
    const p = palette(parseHex("#1F7F78")!);
    expect(toHex(p[600])).toBe("#1F7F78");
    expect(contrast(p[50], [255, 255, 255])).toBeLessThan(1.1); // near white
    expect(contrast(p[900], [255, 255, 255])).toBeGreaterThan(contrast(p[600], [255, 255, 255]));
    const css = brandCss("#1f7f78")!;
    expect(css).toContain("--brand-600: 31 127 120;");
    expect(css).toContain("--on-primary: 255 255 255;");
  });

  it("refuses colours that cannot be read on white and malformed codes", () => {
    expect(brandColorProblem("#FFE680")).toMatch(/too light/);
    expect(brandColorProblem("teal")).toMatch(/colour code/);
    expect(brandCss("#FFE680")).toBeNull();
  });

  it("picks button text that reads best", () => {
    expect(onColor(parseHex("#0B3D91")!)).toEqual([255, 255, 255]);
    expect(onColor(parseHex("#E8A317")!)).toEqual([15, 23, 42]);
  });
});
