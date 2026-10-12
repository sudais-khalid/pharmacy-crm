# 04. UI and UX Plan

Design direction comes from the `ui-ux-pro-max` style and guideline database (query: pharmacy healthcare POS admin dashboard, density 8, variance 3, motion 2), adapted to a pharmacy counter context.

## 1. Design principles

1. **Speed at the counter beats decoration.** A sale must be possible without touching the mouse.
2. **Each role sees its own app.** Cashiers get a full-screen POS, pharmacists an operational dashboard, the owner a business dashboard, the developer a system console.
3. **Status is always visible.** Expiry, low stock, open cash session, pending OCR reviews and sync errors are shown where the user works, not hidden in a report.
4. **Nothing irreversible without a clear confirmation**, and nothing that touches money without a printed or on-screen record.
5. **Dense but scannable.** Tables are the main surface; numbers are right-aligned in tabular figures.

## 2. Visual system

### 2.1 Style

**Minimalism and Swiss style** (database recommendation): grid based, high contrast, functional, sans-serif, sharp hierarchy, subtle hover transitions of 150 to 250 ms, no decorative motion. Best fit for enterprise dashboards and professional tools, low performance cost, low accessibility risk.

### 2.2 Colour tokens

The database proposed a dark slate palette with a green accent. For a pharmacy, light mode is the daily default (bright shops, printed-paper feel) and the existing teal brand signals health and trust, so the palette keeps teal as primary and adopts its slate neutrals and status colours. All values become CSS variables consumed by Tailwind, replacing raw colour classes in components.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8FAFC` | `#0F172A` | Page background |
| `--surface` | `#FFFFFF` | `#1B2336` | Cards, tables, dialogs |
| `--muted` | `#F1F5F9` | `#272F42` | Table header, subtle fills |
| `--fg` | `#0F172A` | `#F8FAFC` | Main text |
| `--fg-muted` | `#475569` | `#94A3B8` | Secondary text (meets 4.5:1 on surface) |
| `--border` | `#E2E8F0` | `#475569` | Dividers, inputs |
| `--primary` | `#1F7F78` | `#45B8AD` | Primary actions, active nav |
| `--on-primary` | `#FFFFFF` | `#0F172A` | Text on primary |
| `--success` | `#15803D` | `#22C55E` | In stock, paid, received |
| `--warning` | `#B45309` | `#F59E0B` | Expiring within 30 days, low stock, low OCR confidence |
| `--danger` | `#B91C1C` | `#EF4444` | Expired, out of stock, cash difference, destructive actions |
| `--info` | `#1D4ED8` | `#60A5FA` | Notices, links |
| `--ring` | `#1F7F78` | `#FFFFFF` | Focus ring |

Status is never conveyed by colour alone: every badge has a text label and an icon (Lucide), for example "Expired" with a circle-x icon.

### 2.3 Typography

| Role | Font | Notes |
|---|---|---|
| UI text | **Fira Sans** 400/500/600 | Recommended pairing for dashboards and data; good legibility at small sizes, Latin and numbers |
| Numbers, codes, batch numbers, invoice numbers | **Fira Code** 500 or Fira Sans with `font-variant-numeric: tabular-nums` | Columns of money line up |
| Base size | 14 px for back-office tables, 16 px for forms and POS | Never below 12 px |
| Line height | 1.5 body, 1.25 headings | |

Fonts are self-hosted through `next/font` so the app works offline on a LAN.

### 2.4 Spacing and density

Dense dashboard scale (density 8): 4, 8, 12, 16, 24, 32 px. Table rows 40 px (compact) or 48 px (comfortable, user toggle). Touch targets on POS and mobile at least 44 x 44 px.

### 2.5 Motion

Subtle only (motion 2): 150 ms for hover and press, 200 ms for dialogs and drawers, exit faster than enter. `prefers-reduced-motion` disables all non-essential transitions. No scroll animations in the app.

## 3. Information architecture

### 3.1 Navigation per role

| Section | Developer | Super Admin | Pharmacist | Cashier |
|---|:-:|:-:|:-:|:-:|
| System console (health, jobs, logs, backups, flags) | yes | | | |
| Owner dashboard (net profit, trends) | yes | yes | | |
| Pharmacist dashboard (expiry, low stock, orders, reviews) | yes | yes | yes | |
| POS | yes | yes | yes | yes |
| Invoices and returns | yes | yes | yes | own only |
| Cash sessions | yes | all | own | own |
| Medicines and batches | yes | yes | yes | lookup in POS |
| Inventory, stock card, expiry | yes | yes | yes | |
| Purchase orders, purchases, bill intake (OCR) | yes | yes | yes | |
| Suppliers | yes | yes | yes | |
| Customers | yes | yes | yes | quick add in POS |
| Expenses | yes | yes | | |
| Reports | yes | yes | operational | |
| Users and roles, settings, audit log | yes | yes | | |

Sidebar groups for back-office roles: **Sell** (POS, Invoices, Returns, Cash), **Stock** (Medicines, Inventory, Expiry), **Buy** (Orders, Bill intake, Purchases, Suppliers), **People** (Customers), **Money** (Expenses, Reports), **Admin** (Users, Roles, Settings, Audit). Groups collapse; badge counts show pending work (for example "Bill intake 3").

### 3.2 Global elements

- **Top bar**: global search (Ctrl+K), notification bell with count, open cash session chip (amount and duration), theme toggle, user menu.
- **Command palette** (Ctrl+K): search medicines, customers, invoices, suppliers, and actions ("New purchase order", "Close cash session", "Upload bill"). Results filtered by permission.
- **Notification drawer**: grouped by severity, each item links to the fix (for example expiring batch opens the batch with "Return to supplier" and "Write off" actions).

## 4. Key screens

### 4.1 POS (cashier landing, full screen)

```
+--------------------------------------------------------------------------------+
| Pharmacy name   | Session: open 3h 12m, cash 14,250 | Ali (Cashier) | bell | ?  |
+---------------------------------------------+----------------------------------+
| [ Search or scan barcode (F2)            ]  | Customer: [ Name ] [ Phone ]     |
|                                             |   match: "Ahmed Raza" link?      |
|  Panadol 500mg   Tab  Batch B12 exp 03/27   |----------------------------------|
|  Stock 240       Rs 3.50          [ + ]     | Panadol 500mg   x 20     70.00   |
|  Augmentin 625   Tab  Rx                    | Brufen 400      x 10     55.00   |
|  ...                                        | ...                              |
|                                             |----------------------------------|
|                                             | Subtotal                125.00   |
|                                             | Discount [ 0 ] [Rs|%]     0.00   |
|                                             | TOTAL                   125.00   |
|                                             | [Cash F5] [Card F6] [Credit F7]  |
|                                             | Tendered [ 200 ]  Change  75.00  |
|                                             | [ Complete and print  F9 ]       |
+---------------------------------------------+----------------------------------+
```

- Search results show stock, nearest batch and expiry, price and Rx badge; expiring-within-30-days batches show a warning badge so the cashier can mention it.
- Keyboard: F2 search, arrow keys and Enter to add, `+`/`-` quantity, Delete removes line, F5/F6/F7 payment method, F9 complete, Esc clears search, Ctrl+P reprint last.
- Rx medicines open a small inline confirmation (doctor name optional, prescription photo optional) instead of a blocking modal.
- After completion: receipt prints automatically (setting), the cart clears, and a toast offers "Reprint" and "New sale". Focus returns to search.
- Without an open cash session the POS shows a single "Open session" card with the opening float field.

### 4.2 Bill intake (OCR review)

Mobile upload flow (pharmacist phone):

1. "Upload bill" opens the camera directly (`capture="environment"`), with a guide frame and tips (flat surface, good light).
2. Preview with crop and rotate; "Add page" for multi-page bills.
3. Upload with a progress bar; the screen says processing usually takes under 30 seconds and the user may leave.
4. Notification when ready.

Review screen (desktop, also usable on tablet):

```
+-------------------------------+------------------------------------------------+
|  [ bill image, zoom, rotate ] | Supplier [ Muller & Phipps   v ]  Inv [ 45812 ]|
|                               | Date [ 2026-10-10 ]  Link to PO [ PO-00031 v ] |
|   highlighted region of the   |------------------------------------------------|
|   line currently selected     | # Medicine          Batch  Exp    Qty Bon Rate |
|                               | 1 Panadol 500 (OK)  B771   04/28  100  10 2.80 |
|                               | 2 [ map medicine ]  C22    01/27   50   0 9.10 |  amber
|                               | 3 Brufen 400 (alias) ...                        |
|                               |------------------------------------------------|
|                               | Lines total 1,245.00  Bill total 1,245.00  OK  |
|                               | 1 line needs attention   [ Discard ] [ Post ]  |
+-------------------------------+------------------------------------------------+
```

- Selecting a row highlights its region on the image (bounding boxes from OCR).
- Low confidence cells are amber with the original OCR text in a tooltip.
- Totals check is live; "Post" is disabled until all lines are matched and totals agree (or a reason is entered).
- Step indicator at top: Uploaded, Read, Review, Posted.

### 4.3 Purchase orders

- **Suggestions view**: grouped by supplier, each line shows current stock, 30-day sales, open orders, suggested quantity (editable), last price. "Create orders" makes one draft per supplier.
- **Supplier page tab "Orders"**: the "list of available orders" from the notes, with status chips and pending quantities.
- **Receive**: opens the purchase form pre-filled from the PO; batch and expiry captured per line; remaining quantity stays open.

### 4.4 Dashboards

| Dashboard | Top row KPIs | Main panels |
|---|---|---|
| Owner | Today's sales, gross profit, net profit (month to date), receivables, payables | Sales vs last period (line), profit by category (bar), cash sessions with differences, top medicines, expense breakdown |
| Pharmacist | Expiring in 30 days, expired with stock, low stock, OCR bills to review, orders due today | Expiry list with actions, low stock with "add to order", purchase orders by status, recent stock adjustments |
| Cashier (inside POS) | Session sales, cash in drawer, invoices today | Recent own invoices with reprint |
| Developer console | Uptime, DB size, queue depth, failed jobs, last backup | Job list with retry, error log, feature flags, maintenance mode, backup and restore |

Charts follow the chart guidelines: legends and tooltips, accessible colours, numbers available as a table toggle, no colour-only meaning.

### 4.5 Reports

One report shell: filter bar (date range presets: Today, Yesterday, This week, This month, Last month, Custom; grouping Daily or Monthly; supplier, category, cashier), result table, summary row, chart toggle, export (CSV, Excel, PDF via print). Reports required by the notes: daily and monthly sales, daily and monthly purchases, profit, net profit (P&L), stock in and out (stock card), expiry.

### 4.6 Receipts

| Format | Width | Content order |
|---|---|---|
| Thermal 80 mm | 72 mm printable | Logo (optional), pharmacy name, address, phone, licence no; invoice no, date, cashier; customer name and phone; lines (name, qty x price, amount, batch and expiry on a second small line); totals; payment and change; balance due if credit; footer; QR with invoice no |
| Thermal 58 mm | 48 mm printable | Same, names truncated, batch line omitted if the setting says so |
| A4 | full page | Current invoice layout plus customer details block and signature line |

## 5. Interaction patterns

| Pattern | Rule |
|---|---|
| Forms | Visible labels, inline validation on blur, error text under the field, server field errors mapped back to inputs, primary action bottom-right, Enter submits |
| Tables | Sticky header, sortable columns, column visibility, saved filters in the URL (deep links), row click opens detail drawer, multi-select with bulk action bar (for example bulk price update, bulk add to order) |
| Destructive actions | Confirmation dialog naming the object ("Cancel invoice INV-20261012-00042?"), required reason for cancellations and write-offs, re-auth for high-risk ones |
| Feedback | Toast for success with undo where possible, skeleton loaders for first load, inline spinners on buttons, never a blank screen |
| Empty states | Explain and offer the next action ("No orders yet. Create from suggestions") |
| Errors | Plain language, what to do next, a reference id for the developer console |
| Mobile | Bottom navigation (max 5 items) for pharmacist and owner on phones: Dashboard, Upload bill, Stock, Reports, More |

## 6. Accessibility checklist (WCAG 2.2 AA)

- Text contrast at least 4.5:1, large text and icons 3:1, in both themes.
- Every control reachable by keyboard in visual order; visible focus ring (2 px, `--ring`); no keyboard traps in dialogs (focus is trapped inside and returned on close).
- Icon-only buttons have `aria-label`; decorative icons have `aria-hidden`.
- Live regions announce cart total changes and toast messages.
- Inputs have labels, not placeholder-only; errors linked with `aria-describedby`.
- Target size at least 24 x 24 px everywhere and 44 x 44 px on touch layouts.
- Respect `prefers-reduced-motion` and browser zoom up to 200 percent without horizontal scroll (tables scroll inside their own container).

## 7. Component library plan

| Need | Choice | Reason |
|---|---|---|
| Accessible primitives (dialog, popover, menu, combobox, tabs) | Radix UI primitives styled with Tailwind (the shadcn/ui pattern, code copied into `components/ui`) | Proven accessibility, no runtime theme lock-in, fits the existing Tailwind setup |
| Data tables | TanStack Table | Sorting, column visibility, selection, virtualisation for long lists |
| Forms | React Hook Form with the existing Zod schemas | Same schema on client and server |
| Command palette | `cmdk` | Small, accessible, keyboard-first |
| Charts | Recharts (already used) | Keep, wrap in themed components |
| Icons | Lucide (already used) | Consistent stroke icons; no emoji anywhere in the UI |
| Dates | `date-fns` with `date-fns-tz` | Timezone-correct display |

The current `components/ui.tsx` (15 KB, one file) is split into one file per component as part of Phase 0, then migrated to the primitives above screen by screen.

## 8. Pre-delivery checklist per screen

- [ ] Works with keyboard only
- [ ] Light and dark mode contrast checked
- [ ] Usable at 375, 768, 1024 and 1440 px
- [ ] Loading, empty, error and success states designed
- [ ] Permission-restricted elements hidden and server-protected
- [ ] No emoji used as icons; Lucide icons only
- [ ] Clickable elements have pointer cursor and hover state (150 to 250 ms)
- [ ] Reduced motion respected
- [ ] Numbers right-aligned, tabular, with currency from settings
