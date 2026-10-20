/**
 * The keys of the counter and of the stock entry grid, in one place: the screens' "?" help and the printed
 * shortcut card (roadmap 9.10) both read these lists, so the card never disagrees with the app.
 */
export type KeyHelp = { keys: string; label: string };

export const POS_KEYS: KeyHelp[] = [
  { keys: "F2", label: "Search or scan a barcode" },
  { keys: "Up / Down, Enter", label: "Choose a search result and add it" },
  { keys: "+ / -", label: "Change the quantity of the selected line" },
  { keys: "Delete", label: "Remove the selected line" },
  { keys: "F5 / F6 / F7", label: "Pay by cash, card or credit" },
  { keys: "F8", label: "Cash received" },
  { keys: "F9", label: "Complete the sale" },
  { keys: "Esc", label: "Clear the search" },
  { keys: "Ctrl+P", label: "Reprint the last receipt" },
];

export const STOCK_ENTRY_KEYS: KeyHelp[] = [
  { keys: "F2", label: "Go to the medicine cell" },
  { keys: "Enter", label: "Next cell (a new row at the end)" },
  { keys: "Ctrl+D", label: "Copy the cell above" },
  { keys: "Ctrl+Enter", label: "Post the stock entry" },
];

export const ANYWHERE_KEYS: KeyHelp[] = [
  { keys: "Alt + underlined letter", label: "Open that screen from the menu" },
  { keys: "Alt+N", label: "The page's New action" },
  { keys: "/", label: "Jump to the search box" },
  { keys: "Ctrl+K", label: "Search everything" },
  { keys: "?", label: "List the keys of this screen" },
];
