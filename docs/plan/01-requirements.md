# 01. Requirements and Gap Analysis

This document turns the handwritten requirement notes into numbered requirements, checks each one against the current system, and adds the extra requirements a production pharmacy system needs.

## 1. Source notes (transcribed)

Page 1, "Pharmacy CRM":

1. Expiry: alert 1 month before
2. How many in and out (stock in and stock out)
3. Profit
4. Bill entry manually, and by mobile picture upload using OCR
5. Batch number
6. Retail bill
7. Net profit
8. Print bill with customer name and contact number
9. History
10. Monthly / daily sales
11. Monthly / daily purchase

Page 2:

12. Suppliers: list of available orders, add an order for each supplier
13. Developer admin
14. Super admin: all access
15. Cashier: cash and print
16. Pharmacist: dashboard

## 2. Requirement register

Status key: **Done** (exists and works), **Partial** (exists but needs changes), **New** (not built).

| ID | Requirement | Current state | Status | Gap to close |
|---|---|---|---|---|
| R1 | Expiry alert 30 days before | Expiry screen with 7/30/60/90 filters, warning window setting defaults to 90 days | Partial | Default to 30 days, add proactive alerts (notification centre, dashboard banner, daily digest), alert per batch, not only a filter |
| R2 | Stock in and stock out | Every change writes a `StockMovement` row; movement log screen exists | Partial | Add an "In / Out" summary report per medicine and per period (opening, in, out, closing), plus a medicine stock card |
| R3 | Profit | Gross profit report (net sales minus cost of exact batches sold) | Done | Show profit per invoice and per medicine; margin percentage |
| R4 | Bill entry manually and by OCR | Manual multi-line purchase entry exists | Partial | New OCR pipeline: phone camera upload, text extraction, line parsing, medicine matching, review screen, then post as a purchase |
| R5 | Batch number | Stock is per batch, FEFO selling, batch on purchase lines | Done | Show batch and expiry on the retail bill; batch search; batch recall view (which customers bought batch X) |
| R6 | Retail bill | A4 printable invoice | Partial | Add 80 mm and 58 mm thermal receipt layouts, choice in settings, auto print after sale, reprint |
| R7 | Net profit | Not built | New | Expenses module (rent, salaries, utilities), returns, and a Profit and Loss report: gross profit minus expenses minus write-offs |
| R8 | Bill with customer name and contact | Customer can be linked, walk-in has no name | Partial | Quick capture of name and phone at POS without creating a full customer; optional auto-create; printed on bill |
| R9 | History | Customer purchase history, ledgers, movement log | Partial | Unified history: customer timeline, medicine timeline, batch trace, and an audit log of who changed what |
| R10 | Daily / monthly sales | Sales report with daily/monthly grouping | Done | Comparisons (vs previous period), by cashier, by payment method, by category; PDF and Excel export |
| R11 | Daily / monthly purchase | Purchases report | Partial | Daily/monthly grouping, by supplier, paid vs unpaid |
| R12 | Supplier orders | Not built (only received purchases) | New | Purchase Orders: draft, send, partially received, received, cancelled; per-supplier list of open orders; reorder suggestions; receive an order into a purchase |
| R13 | Developer admin | Not built | New | Hidden technical role: system health, logs, backups, feature flags, maintenance mode; cannot be deleted by other roles |
| R14 | Super admin, all access | `ADMIN` role has all permissions | Partial | Rename to Super Admin, add role and permission editor, user activity view |
| R15 | Cashier: cash and print | Cashier can use POS, print, and also view medicines, inventory, customers | Partial | Tighten to POS, print, own sales, customer quick add, cash drawer close; POS as landing page |
| R16 | Pharmacist: dashboard | Pharmacist has broad access | Partial | Pharmacist lands on an operational dashboard (expiry, low stock, orders to receive, prescriptions) |

## 3. Additional requirements (senior review)

These are not in the notes but a working pharmacy will hit them within weeks of going live.

| ID | Requirement | Why it matters |
|---|---|---|
| A1 | Customer returns and supplier returns | Returns are daily events. Without them stock and profit drift from reality |
| A2 | Cash register sessions (open, close, expected vs counted cash) | "Cashier: cash" means the cashier is accountable for a drawer. Shift close is the control |
| A3 | Audit log | Needed for any dispute: who cancelled an invoice, who changed a price, who adjusted stock |
| A4 | Notification centre | Single place for expiry, low stock, overdue supplier orders, OCR jobs finished |
| A5 | Global search and command palette (Ctrl+K) | Fastest way to reach a medicine, invoice or customer from anywhere |
| A6 | Reorder suggestions | Combines low stock and sales velocity so purchase orders are one click |
| A7 | Supplier price list (supplier to medicine link) | Lets the system pick the right supplier and last price when building an order |
| A8 | Prescriptions (optional upload, doctor name) | For Rx-flagged medicines; reuses the same file storage as OCR |
| A9 | Backups and restore | One lost disk must not lose the business. Scheduled `pg_dump` with retention |
| A10 | Security patching | Next.js 14.2.15 has a published security advisory; upgrade is required before go-live |
| A11 | PWA and tablet friendly POS | Counter devices are often tablets; camera capture for OCR runs on phones |
| A12 | Export to PDF and Excel | Accountants ask for Excel, owners ask for PDF |

## 4. Out of scope for this plan

- Multi-branch stock transfer. The data model will keep a single-branch assumption but avoid choices that make adding `branchId` painful later (see architecture, section 9).
- Online ordering or a customer-facing app.
- Integration with government drug registries. Can be added later as an adapter.

## 5. Definition of done (applies to every requirement)

- Business rule enforced in the service layer and, where possible, by a database constraint.
- Permission checked on the server; UI hides what the role cannot do.
- Integration test for the service, smoke check for the endpoint.
- Works in light and dark mode, keyboard reachable, usable at 375 px width.
- Audit log entry for every state change that affects money or stock.
