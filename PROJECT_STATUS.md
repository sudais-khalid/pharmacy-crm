# Project status

## Current phase
Phase 2 (Windows desktop app and installer) is complete and tagged `v1.2.0`. Next: Phase 3, pharmacy accounts, roles and branding (see `docs/plan/05-roadmap.md`).

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

## Verification performed
- `npm run typecheck`, `npm run lint`, `npm run build`: clean
- `npm test`: 18 integration tests against real PostgreSQL (FEFO, expiry, rollback, concurrency, credit, cancel, purchases, adjustments, invariants)
- `npm run test:smoke`: 47 HTTP checks against the running app (auth, RBAC, validation, sale/cancel flow, reports, all pages return 200)

## Known limitations / not built
- Not built yet (later phases): customer and supplier returns, OCR stock entry, supplier orders, expenses, notifications centre, global search
- The installer is unsigned until a code-signing certificate is added to the release secrets. SmartScreen then warns on first run, and on Windows 11 PCs with Smart App Control on (as on the development PC) Windows can block the program outright: signing is required before installing at pharmacies
- Updates have not been tried end to end against a real release feed (no public releases location yet); the feed settings, latest.yml and app-update.yml are built and checked
- The installer was tested on the development PC only, not yet on clean Windows 10 and 11 machines
- Sale prices come from the batch being sold; a sale spanning batches with different prices is priced per batch

## Next tasks (suggested)
1. Click-through QA of every screen in a browser
2. Customer/supplier returns, expenses
3. Audit log, notifications
4. Prescriptions (needs file storage design)
