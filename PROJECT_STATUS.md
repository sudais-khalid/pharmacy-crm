# Project status

## Completed (built, tested, working end-to-end)
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
- Not in the simplified scope you gave: customer & supplier returns, prescriptions/doctors/file uploads, expenses, notifications centre, audit log, multi-branch, global search
- UI was not opened in a real browser in my environment (no browser available): please click through each screen once
- Docker files are written but were not run (no Docker in my environment)
- Migration SQL was generated from the schema by script because Prisma's engine download was blocked; apply with `prisma migrate deploy`
- Login rate limit is in-memory (per server process)
- Sale prices come from the batch being sold; a sale spanning batches with different prices is priced per batch

## Next tasks (suggested)
1. Click-through QA of every screen in a browser
2. Customer/supplier returns, expenses
3. Audit log, notifications
4. Prescriptions (needs file storage design)
