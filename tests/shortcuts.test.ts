import { describe, it, expect } from "vitest";
import { CONSOLE_DESKTOP_NAV, CONSOLE_NAV, STAFF_NAV } from "@/lib/navigation";
import { altLetter, isTyping, mnemonicParts, mnemonicProblems } from "@/lib/shortcuts";

const key = (over: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; key: string }>) => ({
  altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: "", key: "", ...over,
});

describe("menu letters", () => {
  it("are unique, part of the label and not reserved, in both menus", () => {
    expect(mnemonicProblems([...STAFF_NAV])).toEqual([]);
    expect(mnemonicProblems([...CONSOLE_NAV, CONSOLE_DESKTOP_NAV])).toEqual([]);
  });

  it("are checked for every mistake", () => {
    expect(mnemonicProblems([{ label: "Stock", key: "S" }, { label: "Sales", key: "S" }, { label: "Files", key: "F" }, { label: "Users", key: "X" }])).toEqual([
      "Sales and Stock both use Alt+S",
      "Files: Alt+F is reserved",
      "Users: the letter X is not in the label",
    ]);
  });

  it("are underlined at their first appearance in the label", () => {
    expect(mnemonicParts("Inventory", "V")).toEqual(["In", "v", "entory"]);
    expect(mnemonicParts("POS / Sales", "P")).toEqual(["", "P", "OS / Sales"]);
    expect(mnemonicParts("Dashboard", "Z")).toEqual(["Dashboard", "", ""]);
  });
});

describe("key matching", () => {
  it("takes the physical key, so other keyboard layouts work the same", () => {
    // Urdu layout: the key produces an Urdu letter, its position is still KeyM
    expect(altLetter(key({ altKey: true, code: "KeyM", key: "م" }))).toBe("M");
  });

  it("ignores AltGr (Ctrl+Alt), Shift and the Windows key", () => {
    expect(altLetter(key({ altKey: true, ctrlKey: true, code: "KeyM" }))).toBeNull();
    expect(altLetter(key({ altKey: true, shiftKey: true, code: "KeyM" }))).toBeNull();
    expect(altLetter(key({ altKey: true, metaKey: true, code: "KeyM" }))).toBeNull();
    expect(altLetter(key({ code: "KeyM" }))).toBeNull();
    expect(altLetter(key({ altKey: true, code: "Digit1" }))).toBeNull();
  });

  it("knows when the user is typing", () => {
    const el = (tag: string, extra: Record<string, unknown> = {}) => ({ tagName: tag, ...extra }) as unknown as Element;
    expect(isTyping(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTyping(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTyping(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTyping(el("TEXTAREA"))).toBe(true);
    expect(isTyping(el("SELECT"))).toBe(true);
    expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTyping(el("BUTTON"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
