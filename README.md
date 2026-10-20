# Pharmacy CRM

A multi-tenant management platform for retail pharmacies. One Developer runs it for many pharmacies; each pharmacy's staff (no customer logins) sell at the counter, bring stock in from photos of supplier bills, order from suppliers and see their real profit. It runs on a server for many pharmacies, or as a Windows desktop app with its own database and backups.

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, PostgreSQL 16 with row-level security, Prisma 6, Zod, pg-boss worker, Tesseract (local photo reading), Electron (desktop), Playwright and axe (browser tests).

## Features

| Area | What it does |
|---|---|
| Developer console | Create pharmacies with an invite for their admin, plans, feature switches, subscriptions with grace and suspension, support sessions, staff accounts, usage per pharmacy, data export, server backups |
| Counter | Full-screen POS with the keyboard map, barcode scanning, earliest expiry first, cash, card and credit (udhaar), cash drawer sessions, receipts in 80 mm, 58 mm and A4, returns from the receipt's QR code |
| Stock entry | Photos of supplier bills and stock lists read locally or by a cloud reader, Excel and CSV import, and a keyboard grid; every line is reviewed before stock changes |
| Stock | Batches with expiry alerts, write-offs, set-aside for supplier returns, stock card, batch trace for recalls, low and out of stock alerts |
| Buying | Supplier catalogs and price lists, supply orders received in part or in full, reorder suggestions, supplier returns, supplier accounts |
| Money | Expenses, profit and loss, owner and pharmacist dashboards, reports by day or month with the period before, Excel and printed letterhead |
| People | Customers with credit limits and accounts, staff with custom roles and two-factor sign-in, activity history |
| Setup | First-run checklist with opening stock and opening balances, user guides per role, printable shortcut card |
| Apps | Installable on tablets and phones; Windows desktop app with a local replica, backups and letter shortcuts |

## Quick start (local development)

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Install
npm install

# 2. Create a database and user
psql -U postgres -c "CREATE USER pharmacy WITH PASSWORD 'change_me' CREATEDB;"
psql -U postgres -c "CREATE DATABASE pharmacy_crm OWNER pharmacy;"

# 3. Configure
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET

# 4. Create tables (applies prisma/migrations)
npx prisma migrate deploy

# 5. Load demo data (optional but recommended)
npm run db:seed

# 6. Run
npm run dev                 # http://localhost:3000
```

For production: `npm run build && npm start`, plus the background worker in a second process: `npm run worker`.

The worker (`src/worker.ts`, bundled to `dist/worker.js`) delivers outbox events and runs scheduled maintenance through pg-boss, which keeps its queue in the same PostgreSQL database (schema `pgboss`). It stops gracefully on SIGTERM, SIGINT or an IPC `"shutdown"` message.

## Developer console

The Developer (platform owner) signs in at `/platform/login` with email, password and a code from an authenticator app. Two-factor sign-in is mandatory and is set up at the first sign-in; ten single-use recovery codes are shown once.

The account is created only from server configuration (`PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD`) on the first start. No screen or API can create, demote or delete it. If the password or phone is lost, recover it from the server shell:

```bash
npm run platform:recover-owner -- --email you@example.com
```

This prints a new password and removes two-factor sign-in so it is set up again.

## Desktop (Windows) proof of concept

`npm run build:desktop`, then `cd desktop && npm install && npm run poc`. Electron starts an embedded PostgreSQL, the server and the worker, captures the login page and writes `desktop/poc-report.json`. The full installer is roadmap Phase 2; see `docs/plan/06-desktop-poc.md`.

## Docker

```bash
cp .env.example .env        # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build   # app on http://localhost:3000, migrations run automatically
```

For a real server use `docker-compose.prod.yml`: Caddy with automatic HTTPS in front, the app and the worker as a non-root user on read-only file systems with resource limits, and nightly encrypted backups with an offsite copy. Setup, backups, restore and the monthly restore drill are in [docs/runbook.md](docs/runbook.md).

## Development accounts (seed data, development only)

The seed creates the pharmacy **Demo Pharmacy** with the code `demo`. Sign in at `/p/demo/login` (or `/login`, then enter the code `demo`).

| Role | Username | Password |
|---|---|---|
| Pharmacy Admin | `admin` | `Admin@12345` |
| Pharmacist | `pharmacist` | `Pharmacist@12345` |
| Cashier | `cashier` | `Cashier@12345` |

Staff sign in with their pharmacy code and username (the email also works). Usernames and emails are unique within a pharmacy, so two pharmacies can each have an `admin`.

**Never use these in production.** A production installation is never seeded: the seed refuses to run when `NODE_ENV=production` (only throwaway test databases set `ALLOW_DEMO_SEED=1`). The Developer creates each real pharmacy and its first admin from the console, and the admin sets the name, address and phone that appear on invoices.

The seed contains fictional data only: 25 medicines (some low-stock, some near expiry, one expired batch), 3 suppliers, 6 customers, purchases and about 70 sales across the last 14 days.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string of the owning role (runs migrations; used by the Developer console, login, worker) |
| `APP_DATABASE_URL` | Optional dedicated login that is a member of `pcrm_app`, used for all pharmacy data. Without it the app switches to `pcrm_app` on each connection |
| `JWT_SECRET` | Signs session cookies. At least 32 random characters (`openssl rand -base64 48`) |
| `APP_TIMEZONE` | Timezone for "today", daily reports and the chart (default `Asia/Karachi`) |
| `POSTGRES_PASSWORD` | Docker Compose only |
| `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD` | Create the Developer account on the very first start (or `PLATFORM_OWNER_PASSWORD_HASH`, bcrypt). Ignored once it exists |
| `TOTP_ENCRYPTION_KEY` | Encrypts two-factor secrets at rest; falls back to `JWT_SECRET` |
| `LOG_LEVEL` | `info` by default (`debug`, `warn`, `error`, `silent`). Logs are JSON lines on stdout |
| `TRUST_PROXY` | `1` only behind a reverse proxy that sets `X-Forwarded-For` |
| `ALLOWED_ORIGINS` | Extra origins allowed to send write requests, comma separated |

Currency label and the expiry-warning period are configured in *Settings* (default `PKR`, 90 days).

## Roles and permissions

Every API route checks a named permission (`src/modules/identity/permissions.ts`); the UI hides what a role cannot use, but the server is the authority.

| | Pharmacy Admin | Pharmacist | Cashier |
|---|:-:|:-:|:-:|
| POS, own invoices, customers, take customer payments | Yes | Yes | Yes |
| View medicines and inventory | Yes | Yes | Yes |
| All invoices, cancel invoices, returns, sell above a credit limit | Yes | Yes | No |
| Medicines, stock adjustments, stock entry, purchases, supply orders | Yes | Yes | No |
| Cost prices, gross profit and reports | Yes | Yes | No |
| Expenses and net profit | Yes | No | No |
| Manage suppliers and pay them | Yes | No | No |
| Users, roles, branding, settings, setup, data export | Yes | No | No |

Custom roles can combine any of these permissions.

## Business rules (enforced in code **and** by database constraints)

1. **Stock is per batch.** A medicine's stock = sum of its non-expired batches.
2. **FEFO:** a sale takes from the earliest-expiring valid batch first and continues into the next batch if needed. Each sale item records the exact batch.
3. **Expired batches are never sold.** An item expiring today is still sellable; from tomorrow it is not.
4. **Stock can't go negative** (application check + `CHECK` constraint). Concurrent sales lock batch rows so you cannot oversell.
5. **Every stock change writes a stock movement** (opening, purchase, sale, sale cancel, adjustment, damage, expiry).
6. **Sales, purchases, cancellations, payments and adjustments run in a single database transaction**: any failure rolls everything back.
7. **Money is `DECIMAL(12,2)`**, never floating point.
8. **Credit (udhaar):** ledger `debit` = customer owes, `credit` = customer paid. A sale leaving a balance requires a customer and respects the credit limit (`0` = no credit). Pharmacists/admins can override the limit. Payments can't exceed the outstanding balance.
9. **Supplier ledger:** `debit` = purchase invoiced (we owe), `credit` = payment made.
10. **Profit** = net sales (after discounts, completed sales only) − cost of goods sold, where cost uses the purchase price of the exact batches sold. Cancelled sales are excluded everywhere.
11. Invoice and purchase numbers come from PostgreSQL sequences (unique even under concurrency).
12. Deleting a medicine with any transaction history archives it instead.

## Project structure

```
prisma/            schema.prisma, migrations/, seed.ts
src/app/api/       REST endpoints (route handlers)
src/app/(app)/     authenticated pages (dashboard, pos, medicines, ...)
src/app/invoice/   printable invoice
src/modules/       business modules: identity, catalog, inventory, sales, customers, procurement, platform
                   (each exposes only index.ts; service.ts, schema.ts, queries.ts inside)
src/lib/           shared infrastructure: Prisma client, API route wrapper, dates, money, validation rules
src/components/    UI kit and shell
tests/             integration tests (real PostgreSQL)
scripts/smoke.sh   HTTP smoke test for a running app
```

## Testing

```bash
# one-time: create a separate test database and apply migrations
psql -U postgres -c "CREATE DATABASE pharmacy_crm_test OWNER pharmacy;"
cp .env.test.example .env.test   # edit it to point at the test database, then:
DATABASE_URL="postgresql://pharmacy:change_me@localhost:5432/pharmacy_crm_test" npx prisma migrate deploy

npm test             # 206 integration tests against the test database
npm run typecheck
npm run lint
npm run lint:deps    # module boundaries
```

After `npm run build`, these use their own throwaway databases next to the test database:

| Command | What it checks |
|---|---|
| `node scripts/smoke-local.mjs` | 399 HTTP smoke and tenant isolation checks. The isolation suite calls every API that takes a record id with another pharmacy's ids (all must answer 404), and fails if a new id route is not listed in `scripts/isolation-check.mjs` |
| `npm run e2e` | The Playwright journeys, from creating a pharmacy to receiving an order, then axe on every screen in the light and dark themes |
| `npm run perf` | Performance with 20 pharmacies of data, against the targets in the architecture document |
| `npm run restore:drill` | Backs up, restores into a new database and runs the smoke suite on the restored data |

The desktop app has its own selftest: `npm run build:desktop`, then `node scripts/selftest.mjs` in `desktop/`.

> `npm test` truncates the tables of the database in `.env.test`. Never point it at real data.

## API overview

All endpoints return JSON; errors look like `{ "error": "message", "fields": { ... } }`. Authentication is a cookie set by `POST /api/auth/login`.

Writes that move money or stock (`POST /api/sales`, `/api/purchases`, `/api/inventory/adjust`, customer and supplier payments) accept an `Idempotency-Key` header (8 to 200 letters, digits, `-` or `_`). Retrying with the same key returns the first response with `Idempotent-Replayed: true` instead of writing again; reusing a key with a different body returns 422.

Every state change writes an append-only `AuditLog` row and an `OutboxEvent` in the same transaction.

| Endpoint | Notes |
|---|---|
| `POST /api/auth/login`, `/logout`, `GET /api/auth/me` | session |
| `GET/POST /api/medicines`, `GET/PUT/DELETE /api/medicines/:id` | `?q=&categoryId=&status=&stock=low\|out&page=` |
| `GET/POST /api/categories` | |
| `GET /api/pos/search?q=` | name / generic / SKU / exact barcode |
| `GET /api/inventory/batches`, `/movements`, `POST /api/inventory/adjust` | |
| `GET/POST /api/sales`, `GET /api/sales/:id`, `POST /api/sales/:id/cancel` | |
| `GET/POST /api/customers`, `GET/PUT /api/customers/:id`, `POST /api/customers/:id/payments` | |
| `GET/POST /api/suppliers`, `GET/PUT /api/suppliers/:id`, `POST /api/suppliers/:id/payments` | |
| `GET/POST /api/purchases`, `GET /api/purchases/:id` | |
| `GET /api/reports?type=&from=&to=&group=` | `sales, profit, purchases, lowStock, expired, customerBalances, supplierBalances` |
| `GET/POST /api/users`, `PUT /api/users/:id` | admin only |
| `GET/PUT /api/settings` | PUT admin only |
| `GET /api/dashboard` | |
| `GET /api/health` | public; `status` is `ok`, `degraded` (worker behind or low disk) or `down` (503, database unreachable) |

## Security notes

- **Tenant isolation is enforced by PostgreSQL.** Business code runs as the restricted `pcrm_app` role inside a transaction that sets the pharmacy; row-level security policies on every table with a `pharmacyId` hide and refuse other pharmacies' rows, and without a pharmacy nothing is visible. Only an allow-listed set of modules may use the unrestricted platform client (`src/lib/platform-db.ts`), enforced by dependency-cruiser. `tests/rls.test.ts` discovers tenant tables from the catalog and checks every one.
- Passwords hashed with bcrypt; sessions are signed JWTs in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). Deactivating a user locks them out immediately (checked against the database on every request).
- All input validated with Zod; all queries go through Prisma (parameterised).
- Login is rate-limited in PostgreSQL (failed attempts: 8 per IP and email, 30 per IP, per 15 minutes), so limits survive restarts and hold across server processes. The client IP is taken from `X-Forwarded-For` only when `TRUST_PROXY=1`.
- CSV export neutralises spreadsheet formula injection.
- Put the app behind HTTPS in production (the session cookie is `Secure` when `NODE_ENV=production`).
- State-changing endpoints require a JSON body and a `SameSite=Lax` cookie, which blocks cross-site form posts.
- State-changing requests from a browser on another origin are rejected (`Origin` / `Sec-Fetch-Site` check). Extra trusted origins go in `ALLOWED_ORIGINS`.

## Not included

Customer/supplier **returns**, **prescriptions/doctors** with file upload, **expenses**, a **notification centre**, an **audit log**, **multi-branch**, and a global search box. The schema and services are structured so these can be added, but they are not built. See `PROJECT_STATUS.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `JWT_SECRET must be set...` | Set a 32+ character `JWT_SECRET` in `.env` |
| `Can't reach database server` | Check PostgreSQL is running and `DATABASE_URL` is right |
| `relation "Medicine" does not exist` | Run `npx prisma migrate deploy` |
| Login says too many attempts | Wait 15 minutes, or clear the `RateLimitHit` rows for that login |
| Seed says data already exists | Seed only runs on an empty database. For a clean start: `npx prisma migrate reset` then `npm run db:seed` |
| Barcode scanner types but nothing happens | Click the POS search box (or press F2) first; the scanner must send Enter |

## POS shortcuts

`F2` (or `/`) focus search · `Enter` in search adds an exact barcode match · `F9` complete sale.
