/**
 * Letter shortcuts (R28, ADR-15): Alt plus a letter opens a screen, the letter is underlined in the menu,
 * Alt+N starts the page's "new" action, / jumps to the page's search box and ? lists everything.
 *
 * Keys are matched by physical position (KeyboardEvent.code), so they work the same with an Urdu or any
 * other keyboard layout. Ctrl+Alt is ignored, because AltGr arrives as Ctrl+Alt on Windows.
 */

/** Alt combinations a browser or Windows already uses (Alt+D, Alt+E, Alt+F in Chrome), or kept for actions. */
export const RESERVED_LETTERS = new Set(["D", "E", "F", "N"]);
export const NEW_KEY = "N";

export type Mnemonic = { label: string; key: string };

type KeyLike = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; key: string };

/** The letter of an Alt+letter press (no Ctrl, no Windows key), or null. */
export function altLetter(e: KeyLike): string | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1] : null;
}

/** A plain key press without modifiers, apart from Shift (which "?" needs). */
export function plainKey(e: KeyLike): string | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  return e.key;
}

/** Splits a label around its mnemonic letter for underlining: "Inventory", "V" -> ["In", "v", "entory"]. */
export function mnemonicParts(label: string, key: string): [string, string, string] {
  const i = label.toUpperCase().indexOf(key.toUpperCase());
  if (i < 0) return [label, "", ""];
  return [label.slice(0, i), label.slice(i, i + 1), label.slice(i + 1)];
}

/** Problems with a menu's letters: duplicates, letters missing from the label, reserved letters. */
export function mnemonicProblems(items: Mnemonic[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const { label, key } of items) {
    if (!/^[A-Z]$/.test(key)) problems.push(`${label}: "${key}" is not a single capital letter`);
    if (RESERVED_LETTERS.has(key)) problems.push(`${label}: Alt+${key} is reserved`);
    if (!label.toUpperCase().includes(key)) problems.push(`${label}: the letter ${key} is not in the label`);
    const other = seen.get(key);
    if (other) problems.push(`${label} and ${other} both use Alt+${key}`);
    seen.set(key, label);
  }
  return problems;
}

/** Whether keys typed now go into a text field (single-key shortcuts must not fire then). */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["checkbox", "radio", "button", "submit", "reset"].includes((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}
