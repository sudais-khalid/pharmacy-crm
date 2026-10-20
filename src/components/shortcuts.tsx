"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { Modal } from "./ui";
import { NEW_KEY, altLetter, isTyping, mnemonicParts } from "@/lib/shortcuts";
import type { NavItem } from "@/lib/navigation";

/**
 * Keyboard shortcuts for a whole area (staff app or Developer console): Alt+letter opens a menu entry,
 * Alt+N clicks the page's [data-shortcut="new"] control, / focuses its [data-shortcut="search"] field and
 * ? opens the list of shortcuts. Pages add their own keys to that list with useShortcutHelp.
 */
type PageKey = { keys: string; label: string };
type Ctx = { openHelp: () => void; setPageKeys: (keys: PageKey[] | null) => void };
const ShortcutContext = createContext<Ctx>({ openHelp: () => {}, setPageKeys: () => {} });

/** Lists a page's own keys (for example the POS function keys) in the shortcut help. */
export function useShortcutHelp(keys: PageKey[]) {
  const { setPageKeys } = useContext(ShortcutContext);
  const signature = JSON.stringify(keys);
  useEffect(() => {
    setPageKeys(JSON.parse(signature) as PageKey[]);
    return () => setPageKeys(null);
  }, [signature, setPageKeys]);
}

const usable = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null && !(el as HTMLButtonElement).disabled;
const firstUsable = (selector: string) => Array.from(document.querySelectorAll(selector)).find(usable) ?? null;
const dialogOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

export function ShortcutProvider({ nav, palette = false, children }: { nav: NavItem[]; palette?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [pageKeys, setPageKeys] = useState<PageKey[] | null>(null);
  const [onPage, setOnPage] = useState<{ newLabel: string | null; search: boolean }>({ newLabel: null, search: false });
  const navRef = useRef(nav);
  navRef.current = nav;

  function openHelp() {
    const add = firstUsable('[data-shortcut="new"]');
    setOnPage({ newLabel: add ? (add.getAttribute("aria-label") || add.textContent || "").trim() || "New" : null, search: Boolean(firstUsable('[data-shortcut="search"]')) });
    setHelp(true);
  }
  const openRef = useRef(openHelp);
  openRef.current = openHelp;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const letter = altLetter(e);
      if (letter) {
        if (dialogOpen()) return; // never leave or act behind an open dialog
        if (letter === NEW_KEY) {
          const add = firstUsable('[data-shortcut="new"]');
          if (add) {
            e.preventDefault();
            add.click();
          }
          return;
        }
        const item = navRef.current.find((n) => n.key === letter);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (isTyping(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "?") {
        e.preventDefault();
        if (dialogOpen()) setHelp(false);
        else openRef.current();
      } else if (e.key === "/" && !dialogOpen()) {
        const search = firstUsable('[data-shortcut="search"]');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <ShortcutContext.Provider value={{ openHelp, setPageKeys }}>
      {children}
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" wide>
        <div className="grid gap-6 sm:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Go to</h3>
            <ul className="space-y-1.5 text-sm">
              {nav.map((n) => (
                <li key={n.href} className="flex items-center justify-between gap-3"><MnemonicLabel label={n.label} k={n.key} /><Keys keys={`Alt+${n.key}`} /></li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">On this page</h3>
            <ul className="space-y-1.5 text-sm">
              {onPage.newLabel && <li className="flex items-center justify-between gap-3"><span>{onPage.newLabel}</span><Keys keys={`Alt+${NEW_KEY}`} /></li>}
              {onPage.search && <li className="flex items-center justify-between gap-3"><span>Search</span><Keys keys="/" /></li>}
              {pageKeys?.map((k) => <li key={k.keys} className="flex items-center justify-between gap-3"><span>{k.label}</span><Keys keys={k.keys} /></li>)}
              {!onPage.newLabel && !onPage.search && !pageKeys?.length && <li className="text-fg-muted">No extra keys on this page.</li>}
            </ul>
            <h3 className="mb-2 mt-5 text-sm font-semibold">Anywhere</h3>
            <ul className="space-y-1.5 text-sm">
              {palette && <li className="flex items-center justify-between gap-3"><span>Search anything or go to a screen</span><Keys keys="Ctrl+K" /></li>}
              <li className="flex items-center justify-between gap-3"><span>Show this list</span><Keys keys="?" /></li>
              <li className="flex items-center justify-between gap-3"><span>Close a dialog</span><Keys keys="Esc" /></li>
            </ul>
          </section>
        </div>
      </Modal>
    </ShortcutContext.Provider>
  );
}

/** A label with its shortcut letter underlined. */
export function MnemonicLabel({ label, k }: { label: string; k: string }) {
  const [before, letter, after] = mnemonicParts(label, k);
  return <span>{before}<span className="underline decoration-2 underline-offset-2">{letter}</span>{after}</span>;
}

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.split("+").map((k) => <kbd key={k} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>)}
    </span>
  );
}

/** Header button that opens the shortcut list. */
export function ShortcutHelpButton({ className }: { className?: string }) {
  const { openHelp } = useContext(ShortcutContext);
  return (
    <button onClick={openHelp} aria-label="Keyboard shortcuts" aria-keyshortcuts="?" title="Keyboard shortcuts (?)" className={className}>
      <Keyboard className="h-5 w-5" aria-hidden />
    </button>
  );
}
