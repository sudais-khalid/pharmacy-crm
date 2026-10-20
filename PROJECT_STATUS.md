# Project status

## Current phase
All roadmap phases (0 to 9) are complete. Tags `phase-3`, `phase-4` and `phase-5` mark those phases, `v1.6.0` is the release with Phases 3 to 6, and Phases 7 to 9 follow it on the branch. What comes next is the backlog after go-live in `docs/plan/05-roadmap.md`, section 5, and the real-pharmacy pilot.

## Phase 9 delivered (hardening and go-live)
- Production setup: Caddy with automatic HTTPS in front; the app and worker in a non-root image on read-only file systems, with resource limits and rotated logs. Tested end to end on this machine, restore included
- Nightly encrypted server backups, verified by decrypting them fully, with an offsite copy and retention (14 days, 12 months). Health and the console show the last good one; `deploy/restore.sh` restores into a new database and swaps it in only once complete. `npm run restore:drill` proves a restored backup passes the full smoke suite
- Subscriptions: ended ones move to grace, then to suspended after `SUBSCRIPTION_GRACE_DAYS`. Statuses set by the check return to active on renewal; a status the Developer set by hand is left alone
- Data export: a pharmacy's records as a ZIP of CSV files with an Excel summary, from the console (with an authenticator code) or by the Pharmacy Admin. No passwords or secrets are included
- Installable staff app (manifest, icons, a service worker that never stores pharmacy data, and an offline page)
- First-run setup in six steps, including opening balances of customers and suppliers. Only the Pharmacy Admin may enter balances from before the app
- Playwright journeys from creating a pharmacy to receiving an order, and axe on every screen in both themes with no serious or critical problems. The audit led to fixes in contrast, labels and lists, and in dialogs taking the cursor back while someone was typing
- Performance with 20 pharmacies (58,000 medicines, 72,000 sales): every target met. A 10-line sale is now a fixed number of database round trips (p95 51 ms, 82 ms with 20 busy pharmacies), and the pool holds 20 connections
- User guides per role, a printable shortcut card, and the Developer runbook
- Demo accounts never reach production: the seed refuses to run there
- 206 integration tests, 399 smoke and HTTP isolation checks, 9 browser tests

## Phase 8 delivered (finance and reports)
- Expenses with categories (the usual ones created on first use), an optional receipt photo, and an option to pay from the open cash drawer, which lowers its expected cash; never deleted, cancelled with a reason, and cancelled ones count nowhere
- Profit and loss: net sales after discounts and returns, cost of goods sold less restocked returns, gross profit, damage and expiry write-offs at cost, expenses, net profit
- One report registry behind the Reports screen: sales by day or month with the period before for comparison, by cashier, payment method and category, top medicines, gross profit, profit and loss, expenses, purchases (paid and unpaid) by supplier and by how they were entered, stock and balances; date presets, CSV, Excel with the pharmacy's name, and a printed letterhead
- Daily summaries kept by an hourly worker job and after a cancelled sale, with `ops rebuild-summaries` to rebuild them from the records
- Owner dashboard (today, month to date, 30 days against the 30 before, profit by category, expenses, drawer differences, balances) and a stock dashboard for pharmacists (expiry, low stock, entries to review, orders due, recent write-offs)
- Developer console: invoices this month and last, active staff, OCR pages and storage per pharmacy
- Expenses menu entry (Alt+X), hidden when the Developer switches expenses off
- 193 integration tests, 385 smoke and HTTP isolation checks

## Phase 7 delivered (suppliers, catalog and orders)
- Supplier catalogs: add an existing or brand-new medicine in one step, with the supplier's code, pack, price, bonus rule, lead time and a preferred supplier per medicine; import a supplier's price list from Excel or CSV
- Every posted bill refreshes the supplier's last price and bonus, and teaches the catalog the codes printed on it; bill lines then match by supplier code
- Supply orders: draft, approve and send, print on the pharmacy's letterhead or send by WhatsApp; receive against an order through stock entry (partial receipts leave the rest pending), close short or cancel
- Reorder suggestions from stock, sales over 30 days, supplier lead time and cover days, less what is on order; one draft order per supplier in one click
- Supplier returns from the batches set aside: stock out at cost with a return note, credited to the supplier's account
- Daily notifications for medicines to reorder and for orders past their expected date
- 187 integration tests, 352 smoke and HTTP isolation checks

## Phase 6 delivered (stock intelligence)
- Expiry alerts at the pharmacy's alert window (default 30 days), at 7 days and on expiry; low and out of stock alerts for medicines that have been stocked. Raised once per stage (not daily), resolved by themselves when the condition clears; the worker scans daily, every half hour, at start, and after each sale, return or stock entry
- Notification drawer with counts per kind (expiry, stock, other), mark read, and links to the fix
- Expiry write-off of whole batches, and batches set aside for return to the supplier (not sold meanwhile), with a printable list per supplier
- Stock card per medicine and date range: opening, in and out by type, running balance, closing (always equal to the stock on the shelf for a range ending today)
- Batch trace for recalls: purchases and stock entries that brought it in, invoices that sold it, and who still holds some, with phone numbers
- Global search and Ctrl+K palette across medicines, customers, suppliers, invoices, stock entries and batches, within each person's permissions (p95 37 ms on 20,000 medicines, `npm run bench:search`)
- Medicine page: batches with trace, stock card, sales, purchase prices, suppliers and history
- Fix: reports and the dashboard now date sales by the pharmacy's local day (a sale after midnight was counted on the day before)
- 177 integration tests, 298 smoke and HTTP isolation checks (run with `node scripts/smoke-local.mjs`)

## Phase 5 delivered (POS and billing)
- Full-screen counter with the keyboard map (F2, arrows and Enter, plus and minus, Delete, F5 to F7, F8, F9, Esc, Ctrl+P), idempotent completion and printing in place
- Walk-in name and phone on the bill; the account owning a phone number is suggested; save a walk-in as a customer
- Cash drawer sessions (feature switch): open with a float, pay-in and pay-out, count and close; expected cash is float plus cash taken minus cash refunds plus pay-ins minus pay-outs; a large difference needs a note and notifies managers
- Receipts in 80 mm, 58 mm and A4 with the pharmacy's branding and a QR code of the invoice number; optional batch and expiry lines; reprints keep the original format
- Sales returns by invoice number or QR scan: partial quantities, back to the original batch or written off as damaged, refund in cash, by card or as a credit note, return slip; never more than was sold or paid
- Cashiers see and reprint only their own invoices (new permission `sales.viewAll`); returns need `returns.create`
- Customer timeline (purchases, cancellations, returns, payments) and a medicine's sales history

## Phase 4 delivered (stock entry, manual and OCR)
- One stock entry workflow for typed bills, photos of bills and stock lists, and Excel or CSV import, posting through the existing purchase code or as opening stock
- Keyboard grid with autosave, inline new medicine, match tags, warnings and blocking checks; bonus, trade discount and tax with effective cost per unit
- Phone photo upload with crop, rotate and resize; local reading with Tesseract (offline, shipped with the app) or a cloud vision model when the Developer allows it and the pharmacy chooses it; monthly page limits and usage
- Matching by barcode, learned supplier aliases and trigram similarity; aliases learned on post
- Accuracy script on synthetic bills and lists (`npm run ocr:accuracy`); a real pilot sample set is still needed

## Phase 3 delivered (pharmacy accounts, roles and branding)
- Roles as data: three templates and custom roles from a permission catalog, with no-escalation and last-admin rules; cost prices and profit hidden from roles without `cost.view`
- Staff management with invites or temporary passwords, forced sign-out, staff two-factor sign-in, forgot-password requests as notifications
- Pharmacy profile and branding (logo, brand colour with contrast checks) on the app, sign-in page and receipts; activity history

## Phase 2 delivered
- Windows installer (`desktop/`, `npm run package`): per-user NSIS setup with shortcuts; Electron supervises an embedded PostgreSQL 16 on loopback, the web server and the worker, with splash, tray and logs
- Data in `%PROGRAMDATA%\PharmacyCRM`, limited to the setup user, Administrators and SYSTEM; secrets protected with Windows DPAPI; a lost database password is reset locally
- Local replica: encrypted, verified snapshots at start, every 4 hours, on close, before migrations and updates, and on demand; retention of 24 plus one a day for 30 days; optional mirror folder; recovery key shown once
- First start: start fresh, or restore the newest backup or a chosen file (recovery key only when needed); restores go into a side database and are swapped in only when complete
- Uninstalling keeps the data; the uninstaller can delete the data and, separately, the backups; reinstalling restores everything with the recovery key
- Developer console "This computer": backups, mirror folder, restore (authenticator code, audited), shop network access with QR codes
- Owner bootstrap from the build's `owner.json` (email and bcrypt hash) and `PharmacyCRM.exe --recover-owner` for Windows administrators
- Letter shortcuts: Alt plus the underlined letter for every screen, Alt+N for new, / for search, ? for the list
- Client mode for a second counter PC; shop network access for tablets over the PC's network address
- Updates through electron-updater after a backup and a clean shutdown; release workflow for tagged versions; CI on Node 22 and 24 plus a Windows desktop job
- `ops.js`: migrate, backup, verify, restore, recover-owner
- 125 integration tests, 108 smoke checks, 58 isolation checks, 6 desktop unit tests, a desktop self-test (from source and packaged) and an installer round-trip test

## Phase 1 delivered
- Multi-pharmacy data: every business table carries `pharmacyId`; the original shop became pharmacy `main` (rehearsed on a copy, numbering continues)
- Isolation enforced by PostgreSQL row-level security: the app runs as the restricted `pcrm_app` role inside a tenant transaction, and without a pharmacy nothing is visible; checked by `tests/rls.test.ts` (catalog driven) and the HTTP suite `npm run test:isolation`
- Separate sign-in realms: staff, Developer and platform support, each with its own cookie and token audience; session versions revoke sessions at once
- Permanent Developer account from server configuration, mandatory TOTP (RFC 6238) with recovery codes, server-shell recovery
- Developer console: overview, pharmacies (create with first admin by invite or temporary password, profile, status with re-authentication, plan and limits, feature switches, activity), accounts across pharmacies (activate, deactivate, reset link, sign out everywhere, unlock), support sessions
- Invite and reset links (hashed, single use, expiring), forced password change for temporary passwords
- Staff sign-in by pharmacy code and username at `/p/<code>/login` or `/login`
- 108 integration tests, 105 smoke checks, 58 HTTP isolation checks

## Phase 0 delivered
- Next.js 15.5 and React 19 (14.x is end of life and affected by a critical Windows remote code execution advisory); production dependency audit clean
- CI workflow: audit, typecheck, lint, module boundaries, migration drift check, integration tests on PostgreSQL 16, build, HTTP smoke test
- Business logic in `src/modules/*` behind `index.ts`, boundaries enforced by dependency-cruiser; every service takes a context (actor, pharmacy, transaction)
- Append-only audit log and transactional outbox on every write path; idempotent money and stock writes (`Idempotency-Key`)
- Cross-site write protection, PostgreSQL-backed login rate limit, proxy-aware client IP
- Trigram search indexes; database time zone pinned to UTC
- Background worker (pg-boss and outbox dispatcher) in its own process and Docker service
- Design tokens, self-hosted Fira fonts, UI kit split per component
- Structured JSON logging and a public `/api/health`
- Desktop proof of concept: Electron with embedded PostgreSQL works on Windows (`docs/plan/06-desktop-poc.md`)
- 47 integration tests and 59 smoke checks

## Original features (built, tested, working end to end)
- Auth: login/logout, bcrypt hashing, signed httpOnly session cookie, login rate limiting, route protection (middleware + server-side checks)
- Roles & permissions: Admin / Pharmacist / Cashier, 20 granular permissions enforced in every API route
- Dashboard (live DB): today's sales/profit, customers, medicines, low stock, expiring, expired, receivables/payables, 14-day sales chart, top sellers, tables
- Medicines: CRUD, search/filter/sort/pagination, categories, barcode/SKU, Rx flag, archive-instead-of-delete, restore, opening stock
- Inventory: batch-level stock, stock value, expiry screen (expired / 7 / 30 / 60 / 90 days / configured), low stock, stock movements log, adjustments (add/remove/damage/expired)
- FEFO selling with row locking, expired batches never sold, transactional rollback
- POS: search, USB barcode scanner (Enter), cart, discount (amount / %), cash / card / credit, partial payment, change, Rx confirmation, invoice print
- Invoices: list, reprint, print-to-PDF, cancel (restores exact batches, reverses ledger)
- Customers: profile, credit limit, ledger (running balance), payments, purchase history, printable statement
- Suppliers: profile, ledger, payments, outstanding payable, printable statement
- Purchases: multi-line, creates/tops-up batches, stock movements, supplier ledger, partial payment
- Reports: sales, profit, purchases, low stock, expired, customer balances, supplier payables; CSV export; print
- Users & settings pages; dark/light mode; responsive layout
- Database: 14 tables, UUID keys, DECIMAL money, FKs, indexes, CHECK constraints (no negative stock, positive quantities, valid amounts)

## Verification performed (20 October 2026, end of Phase 9)
- `npm run typecheck`, `npm run lint`, `npm run lint:deps`, `npm run build`, `npm audit --omit=dev`: clean
- `npm test`: 206 integration tests against PostgreSQL 16
- `node scripts/smoke-local.mjs`: 399 smoke and HTTP tenant isolation checks
- `npm run e2e`: 9 browser tests (8 journeys, plus axe on 52 screens in both themes)
- `npm run perf`: every architecture target met with 20 pharmacies of data
- `npm run restore:drill`: a restored backup passes all 399 smoke and isolation checks
- `docker-compose.prod.yml` run on this machine: HTTPS through Caddy, non-root read-only containers, startup backup with offsite copy, and a restore with `deploy/restore.sh`
- Desktop selftest (`desktop/scripts/selftest.mjs`)

## Known limitations / not built
- The repository has no remote yet, so the GitHub Actions workflow (including the browser tests) has not run there; every suite passes locally
- Invites and password resets are shared as links (copy or WhatsApp); there is no email sending adapter yet (`MAIL_*` in the plan)
- Files (logos, bill photos, receipts) are stored in PostgreSQL. S3-compatible storage for large hosted installs (`STORAGE_DRIVER`, `S3_*` in the plan) is not built
- On a server, restore runs from the shell (`deploy/restore.sh`) rather than from the console, so the app is stopped while the data is replaced; the desktop app restores from its console page
- "From New pharmacy to the first sale in under 30 minutes" is shown by the browser journey (under a minute, automated); it has not been timed with a real pharmacy
- Local photo reading on 15 real bill photos (11 distributors, 98 lines): lines found 74%, quantity 59%, expiry 57%, rate 45%, batch 27%, invoice number 53%, bill total 69%. Every line still goes through the review grid. Not readable locally: a handwritten Urdu bill, a sideways photo, a dot-matrix print and a thermal slip; these need the cloud reader, which has not yet been scored on the real bills (needs an API key)
- The installer is unsigned until a code-signing certificate is added to the release secrets. SmartScreen then warns on first run, and on Windows 11 PCs with Smart App Control on (as on the development PC) Windows can block the program outright: signing is required before installing at pharmacies
- Updates have not been tried end to end against a real release feed (no public releases location yet); the feed settings, latest.yml and app-update.yml are built and checked
- The installer was tested on the development PC only, not yet on clean Windows 10 and 11 machines
- Sale prices come from the batch being sold; a sale spanning batches with different prices is priced per batch

## Next tasks (suggested)
1. Pilot with one real pharmacy: onboarding time, counter speed, and OCR on its own supplier bills
2. Score the cloud photo reader on the real bills in `Supplier Bills/` once an API key is available
3. Code-sign the installer, and test it and an update on clean Windows 10 and 11 machines
4. Push to a remote so CI runs, then the backlog after go-live (roadmap, section 5)
