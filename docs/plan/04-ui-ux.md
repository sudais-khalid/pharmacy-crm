# 04. UI and UX Plan

Design direction comes from the `ui-ux-pro-max` style and guideline database (query: pharmacy healthcare POS admin dashboard, density 8, variance 3, motion 2), adapted to a pharmacy counter context.

## 1. Design principles

1. **Speed at the counter beats decoration.** A sale must be possible without touching the mouse.
2. **Each role sees its own app.** The Developer gets a platform console, Pharmacy Admins a business dashboard, pharmacists an operational dashboard, and cashiers a full-screen POS.
3. **Every pharmacy feels like its own product.** Its logo, name and brand colour appear on login, header, receipts and purchase orders.
4. **Status is always visible.** Expiry, low stock, open cash session, pending OCR reviews and sync errors are shown where the user works, not hidden in a report.
5. **Nothing irreversible without a clear confirmation**, and nothing that touches money without a printed or on-screen record.
6. **Dense but scannable.** Tables are the main surface; numbers are right-aligned in tabular figures.

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

**Per-pharmacy brand colour**: a pharmacy's `brandColor` overrides `--primary` (and a derived dark-mode shade) through a style attribute on the app root. Status colours are never overridden, so warnings look the same in every pharmacy.

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

There are two separate apps, one per identity realm, each with its own layout:

| App | Path | Users | Layout |
|---|---|---|---|
| Platform console | `/platform` | Developer | Dark-accented header so it is never confused with a pharmacy, sidebar: Overview, Pharmacies, Accounts, Support sessions, Feature flags, System, Audit |
| Pharmacy app | `/p/<slug>/...` after login (short paths inside) | Pharmacy Admin, Pharmacist, Cashier, custom roles | Pharmacy logo and name in the header, sidebar groups below, Cashier gets full-screen POS |

Pharmacy app sections by role (custom roles see whatever their permissions allow):

| Section | Pharmacy Admin | Pharmacist | Cashier |
|---|:-:|:-:|:-:|
| Owner dashboard (net profit, trends) | yes | | |
| Pharmacist dashboard (expiry, low stock, orders, reviews) | yes | yes | |
| POS | yes | yes | yes |
| Invoices and returns | yes | yes | own only |
| Cash sessions | all | own | own |
| Medicines and batches | yes | yes | lookup in POS |
| Inventory, stock card, expiry | yes | yes | |
| Suppliers and supplier catalogs | yes | yes | |
| Stock entry (manual grid, OCR photos, drafts) | yes | yes | upload photo only |
| Purchase orders and purchases | yes | yes | |
| Customers (name, phone, credit) | yes | yes | quick add in POS |
| Expenses | yes | | |
| Reports | yes | operational | |
| Staff, roles, audit log | yes | | |
| Pharmacy profile and branding, settings | yes | | |

When the Developer opens a pharmacy through support access, they see the Pharmacy Admin view with a fixed amber banner: "Platform support session for <pharmacy>. All actions are logged. End session".

Sidebar groups for the pharmacy app: **Sell** (POS, Invoices, Returns, Cash), **Stock** (Stock entry, Medicines, Inventory, Expiry), **Buy** (Orders, Purchases, Suppliers), **People** (Customers, Staff), **Money** (Expenses, Reports), **Admin** (Roles, Profile and branding, Settings, Audit). Groups collapse; badge counts show pending work (for example "Stock entry 3 to review").

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

### 4.2 Stock entry (manual grid and OCR review)

Stock entry is one screen family under **Stock > Stock entry**, with a list of drafts and posted entries, and a "New stock entry" button offering four choices: **Type it in**, **Photo of supplier bill**, **Photo of stock list**, **Import file**. Whatever the choice, the user finishes on the same grid.

**Manual grid** (desktop and tablet):

```
+----------------------------------------------------------------------------------+
| New stock entry: Supplier bill                       Draft saved 10:42  [Discard]|
| Supplier [ Muller & Phipps   v ]  Invoice no [ 45812 ]  Date [ 12/10/26 ]        |
| Bill total [ 12,450.00 ]   Link to order [ PO-00031 v ]                          |
|----------------------------------------------------------------------------------|
| # | Medicine (F2)        | Batch | Exp   | Qty | Bonus | Rate | Disc% | Tax | Amt |
| 1 | Panadol 500mg Tab    | B771  | 04/28 | 100 |  10   | 2.80 |  0    | 0   | 280 |
| 2 | Brufen 400mg Tab     | K19   | 11/27 |  50 |   0   | 4.10 |  2    | 0   | 201 |
| 3 | [ type to search...] |       |       |     |       |      |       |     |     |
|----------------------------------------------------------------------------------|
| Lines total 12,450.00   Bill total 12,450.00   Matches                            |
| ! Line 2: rate 4.10 is 12% above last purchase (3.66)                             |
|                                         [ Save draft ]  [ Post stock  Ctrl+Enter ]|
+----------------------------------------------------------------------------------+
```

- Enter or Tab moves cell to cell, a new row appears automatically, Ctrl+D copies the cell above, Delete on an empty row removes it, F2 focuses the medicine cell, barcode scan fills it.
- Expiry is typed as `MM/YY`. Amounts update as you type. Warnings sit under the grid and never block typing; blocking errors are shown on the cell and disable Post.
- "New medicine" in the medicine dropdown opens an inline form without leaving the bill.
- "Draft saved" indicator; drafts survive refresh, logout and power cuts.

**Photo upload** (phone first, also works on desktop):

1. Choose "Photo of supplier bill" or "Photo of stock list". The camera opens directly (`capture="environment"`) with a guide frame and tips (flat surface, good light, whole page in view). On desktop a file picker accepts JPEG, PNG and PDF.
2. Preview with crop and rotate; "Add page" for multi-page bills or lists.
3. Upload with a progress bar. The screen says reading usually takes under 30 seconds and the user may leave; a notification arrives when it is ready.
4. If the monthly OCR limit is reached or OCR fails, the same draft opens as an empty manual grid with the photo shown beside it, so the work is never blocked.

**OCR review** (desktop and tablet):

```
+-------------------------------+--------------------------------------------------+
|  [ photo, zoom, rotate, page ]| Supplier [ Muller & Phipps v ]  Inv [ 45812 ]    |
|                               | Date [ 12/10/26 ]   Link to PO [ PO-00031 v ]    |
|   highlighted region of the   |--------------------------------------------------|
|   row currently selected      | # Medicine             Batch  Exp   Qty Bon Rate |
|                               | 1 Panadol 500 (alias)  B771   04/28 100  10 2.80 |
|                               | 2 [ map medicine ]     C22    01/27  50   0 9.10 | amber
|                               | 3 Brufen 400 (catalog) K19    11/27  50   0 4.10 |
|                               |--------------------------------------------------|
|                               | Lines total 12,450.00  Bill total 12,450.00  OK  |
|                               | 1 line needs attention     [ Discard ] [ Post ] |
+-------------------------------+--------------------------------------------------+
```

- The right side **is the manual grid**, pre-filled; every keyboard shortcut works the same.
- Selecting a row highlights its region on the photo; low confidence cells are amber with the original OCR text in a tooltip; the match method is shown as a small tag (barcode, catalog, alias, similar name, manual).
- Post is disabled until every line is matched and totals agree, or a reason for a difference is entered.
- Step indicator at the top: Uploaded, Read, Review, Posted.
- For a stock list the header shows no supplier fields and the Post button reads "Add to stock as opening balance".

### 4.3 Purchase orders

- **Suggestions view**: grouped by supplier, each line shows current stock, 30-day sales, open orders, suggested quantity (editable), last price. "Create orders" makes one draft per supplier.
- **Supplier page tab "Orders"**: the "list of available orders" from the notes, with status chips and pending quantities.
- **Receive**: opens the purchase form pre-filled from the PO; batch and expiry captured per line; remaining quantity stays open.

### 4.4 Dashboards

| Dashboard | Top row KPIs | Main panels |
|---|---|---|
| Pharmacy Admin | Today's sales, gross profit, net profit (month to date), receivables, payables | Sales vs last period (line), profit by category (bar), cash sessions with differences, top medicines, expense breakdown |
| Pharmacist | Expiring in 30 days, expired with stock, low stock, stock entries to review, orders due today | Expiry list with actions, low stock with "add to order", purchase orders by status, recent stock adjustments |
| Cashier (inside POS) | Session sales, cash in drawer, invoices today | Recent own invoices with reprint |
| Platform console (Developer) | Active pharmacies, suspended, subscriptions ending soon, failed jobs, last backup | Pharmacies table, reset requests, support sessions, job list with retry, error log, backups (section 4.7) |

Charts follow the chart guidelines: legends and tooltips, accessible colours, numbers available as a table toggle, no colour-only meaning.

### 4.5 Reports

One report shell: filter bar (date range presets: Today, Yesterday, This week, This month, Last month, Custom; grouping Daily or Monthly; supplier, category, cashier), result table, summary row, chart toggle, export (CSV, Excel, PDF via print). Reports required by the notes: daily and monthly sales, daily and monthly purchases, profit, net profit (P&L), stock in and out (stock card), expiry.

### 4.6 Receipts

| Format | Width | Content order |
|---|---|---|
| Thermal 80 mm | 72 mm printable | Logo (optional), pharmacy name, address, phone, licence no; invoice no, date, cashier; customer name and phone; lines (name, qty x price, amount, batch and expiry on a second small line); totals; payment and change; balance due if credit; footer; QR with invoice no |
| Thermal 58 mm | 48 mm printable | Same, names truncated, batch line omitted if the setting says so |
| A4 | full page | Current invoice layout plus customer details block and signature line |

### 4.7 Platform console (Developer)

**Overview**: count of pharmacies by status, pharmacies with subscriptions ending in 14 days, failed jobs, last backup, newest sign-ups, reset requests waiting.

**Pharmacies list**: table with logo, name, slug, city, status chip, plan, subscription end, staff count, invoices this month, last activity. Row actions: Open, Enter as support, Suspend or Reactivate, Copy login link.

**New pharmacy** (single page form, three sections):

```
+--------------------------------------------------------------------+
| New pharmacy                                                       |
|--------------------------------------------------------------------|
| Pharmacy     Name [ City Care Pharmacy ]   URL slug [ citycare  ]  |
|              City [ Rawalpindi ]  Phone [ ... ]  Licence [ ... ]   |
| Plan         Plan [ Standard v ]  Subscription ends [ 2027-10-12 ]|
|              Max staff [ 10 ]  Features [x] OCR limit [ 300 ]/month |
| First admin  Name [ ... ]  Username [ admin ]  Phone [ ... ]       |
|              Credentials ( ) Invite link  ( ) Temporary password   |
|--------------------------------------------------------------------|
|                                   [ Cancel ]  [ Create pharmacy ]  |
+--------------------------------------------------------------------+
```

After creation a result panel shows the login URL and the invite link (or temporary password) **once**, with "Copy", "Share on WhatsApp" and "Send email" buttons and a warning that it will not be shown again.

**Pharmacy detail** tabs: Profile (read and edit), Status and subscription (status change needs a reason and re-auth), Staff accounts, Feature flags, OCR usage, Usage, Audit, Danger zone (export data, permanently delete with typed confirmation).

**Accounts** (search across all pharmacies by name, username, phone): status toggle, "Generate reset link", "Force logout", "Unlock". Each action shows a confirmation naming the person and pharmacy.

**System**: health, queue and failed jobs with retry, error log, backups with restore, maintenance mode with message, platform announcement banner.

### 4.8 Pharmacy profile and branding (Pharmacy Admin)

Two-column page: form on the left, live preview on the right showing the app header, the login page card and an 80 mm receipt with the current values.

- Logo upload with crop to square, PNG or JPG up to 2 MB; preview in light and dark headers.
- Display name, address, phones, WhatsApp, email, licence number, tax number.
- Receipt header and footer text.
- Brand colour picker. The chosen colour replaces `--primary` for this pharmacy only. The picker rejects colours that fail 4.5:1 contrast with white text and suggests the nearest passing shade.

### 4.9 Staff and roles (Pharmacy Admin)

**Staff list**: name, username, role, status, last login, 2FA. Actions: Edit, Change role, Deactivate or Activate, Set temporary password, Generate reset link, Force logout. "Add staff" uses the same invite-or-temporary-password choice as the platform form. A seat counter shows "6 of 10 staff" from the plan limit.

**Roles**: list of templates (locked icon) and custom roles. Role editor groups permissions by area (Sell, Stock, Buy, People, Money, Admin) with a plain-language line under each checkbox ("Can see purchase cost and profit"). Sensitive permissions are marked. A "Compare with template" toggle shows differences. Saving a role that is in use asks for confirmation and logs out affected users.

**Forgot password requests** appear in the notification drawer for Pharmacy Admins with a one-click "Generate reset link".

### 4.10 Supplier catalog (Pharmacist)

On the supplier page, tab "Catalog": table of linked medicines with supplier code, pack, last price, bonus rule, lead time, preferred star. "Add medicines" opens a searchable picker with multi-select; "New medicine" opens an inline form and links the new medicine on save. "Import price list" accepts CSV or Excel, shows a preview with matched, new and error rows, and imports only after confirmation.

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
