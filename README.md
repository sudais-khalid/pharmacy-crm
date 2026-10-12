# Pharmacy CRM & Management System

A working pharmacy management web app: dashboard, medicines, batch-wise inventory with expiry control, a barcode-ready POS with invoices, customers with credit (udhaar) ledgers, suppliers, purchases, reports and role-based users.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Next.js API routes · PostgreSQL · Prisma ORM · Recharts · Zod · JWT sessions (jose) · bcrypt.

## Features

| Area | What it does |
|---|---|
| Dashboard | Today's sales/profit, customers, medicines, low-stock, expiring, expired, receivables/payables, 14-day sales chart, top sellers – all from the database |
| Medicines | Add/edit/delete, search, filters, sort, pagination, categories, barcode/SKU, prescription flag, opening stock. Medicines with history are **archived**, never destroyed; archived ones can be restored |
| Inventory | Stock per **batch**, stock value, expiry screen (expired / 7 / 30 / 60 / 90 days / configured), low stock, full stock-movement log, adjustments (count correction, damaged, expired write-off) |
| POS | Search or scan a barcode, cart, quantities, discount (amount or %), cash / card / credit, partial payment, change calculation, prescription confirmation, printable invoice. Stock is deducted automatically |
| Invoices | List, search, reprint, print/save as PDF, cancel (restores the exact batches and reverses the customer ledger) |
| Customers | Profile, credit limit, running ledger, payments, purchase history, printable statement |
| Suppliers | Profile, ledger, payments, outstanding payable, printable statement |
| Purchases | Multi-line purchase invoices with batch number + expiry; creates or tops up batches, increases stock, updates the supplier ledger |
| Reports | Sales (daily/monthly), profit, purchases, low stock, expired, customer balances, supplier payables. CSV export and print |
| Users | Admin / Pharmacist / Cashier, activate/deactivate, password reset |
| UI | Sidebar + top bar, responsive, dark/light mode, tables, cards, charts, modals, toasts, skeleton loaders |

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

## Docker

```bash
cp .env.example .env        # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build   # app on http://localhost:3000, migrations run automatically
docker compose exec app npm run db:seed   # optional demo data
```

## Development accounts (seed data – development only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin@12345` |
| Pharmacist | `pharmacist@example.com` | `Pharmacist@12345` |
| Cashier | `cashier@example.com` | `Cashier@12345` |

**Never use these in production.** Run the app without seeding, then create a real admin: seed once, log in, add your own admin user in *Users*, and deactivate the demo accounts. Change the pharmacy name, address and phone in *Settings*; they appear on invoices.

The seed contains fictional data only: 25 medicines (some low-stock, some near expiry, one expired batch), 3 suppliers, 6 customers, purchases and about 70 sales across the last 14 days.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs session cookies. At least 32 random characters (`openssl rand -base64 48`) |
| `APP_TIMEZONE` | Timezone for "today", daily reports and the chart (default `Asia/Karachi`) |
| `POSTGRES_PASSWORD` | Docker Compose only |
| `LOG_LEVEL` | `info` by default (`debug`, `warn`, `error`, `silent`). Logs are JSON lines on stdout |
| `TRUST_PROXY` | `1` only behind a reverse proxy that sets `X-Forwarded-For` |
| `ALLOWED_ORIGINS` | Extra origins allowed to send write requests, comma separated |

Currency label and the expiry-warning period are configured in *Settings* (default `PKR`, 90 days).

## Roles and permissions

Every API route checks a named permission (`src/modules/identity/permissions.ts`); the UI hides what a role cannot use, but the server is the authority.

| | Admin | Pharmacist | Cashier |
|---|:-:|:-:|:-:|
| POS, invoices (view/print), customers, take customer payments | ✔ | ✔ | ✔ |
| View medicines & inventory | ✔ | ✔ | ✔ |
| Add/edit medicines, stock adjustments | ✔ | ✔ | – |
| Delete/archive medicines | ✔ | – | – |
| Cancel invoices | ✔ | ✔ | – |
| Sell above a customer's credit limit | ✔ | ✔ | – |
| Suppliers (view), purchases, reports | ✔ | ✔ | – |
| Manage suppliers & pay them | ✔ | – | – |
| Users, settings | ✔ | – | – |

## Business rules (enforced in code **and** by database constraints)

1. **Stock is per batch.** A medicine's stock = sum of its non-expired batches.
2. **FEFO:** a sale takes from the earliest-expiring valid batch first and continues into the next batch if needed. Each sale item records the exact batch.
3. **Expired batches are never sold.** An item expiring today is still sellable; from tomorrow it is not.
4. **Stock can't go negative** (application check + `CHECK` constraint). Concurrent sales lock batch rows so you cannot oversell.
5. **Every stock change writes a stock movement** (opening, purchase, sale, sale cancel, adjustment, damage, expiry).
6. **Sales, purchases, cancellations, payments and adjustments run in a single database transaction** – any failure rolls everything back.
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

npm test             # 18 integration tests (FEFO, expiry, rollback, concurrency, credit, cancel, purchases...)
npm run typecheck
npm run lint
```

With the app running and seeded: `npm run test:smoke` (59 HTTP checks: login, permissions, validation, sale → cancel flow, reports, page loads).

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
