# 03. Data Model Changes

The current schema (14 tables) stays the core. This document lists every addition, the reason for it, and how to migrate without losing data. All money stays `Decimal(12,2)`, all keys stay UUID, and every new table that holds history is append-only.

The biggest change is **multi-tenancy**: almost every table gains a `pharmacyId` column protected by PostgreSQL Row-Level Security (section 2.2). Model snippets in sections 3 to 5 omit that column for readability; it is present on every one of them.

## 1. Overview of new and changed entities

```mermaid
erDiagram
  Pharmacy ||--o{ User : employs
  Pharmacy ||--o{ Role : "custom roles"
  Pharmacy ||--o{ Customer : serves
  Pharmacy ||--|| PharmacySettings : configures
  PlatformUser ||--o{ Pharmacy : creates
  PlatformUser ||--o{ SupportSession : opens
  Role ||--o{ User : has
  User ||--o{ CashSession : opens
  CashSession ||--o{ Sale : contains
  Sale ||--o{ SaleReturn : "returned by"
  SaleReturn ||--|{ SaleReturnItem : lines
  SaleItem ||--o{ SaleReturnItem : "returned from"

  Supplier ||--o{ PurchaseOrder : receives
  PurchaseOrder ||--|{ PurchaseOrderItem : lines
  PurchaseOrder ||--o{ Purchase : "received as"
  Supplier ||--o{ SupplierProduct : supplies
  Medicine ||--o{ SupplierProduct : "supplied by"
  Supplier ||--o{ SupplierReturn : "sent back to"
  SupplierReturn ||--|{ SupplierReturnItem : lines

  StockIntake ||--|{ StockIntakePage : photos
  StoredFile ||--o| StockIntakePage : file
  StockIntake ||--|{ StockIntakeLine : lines
  StockIntake ||--o| Purchase : "posted as"
  SupplierItemAlias }o--|| Medicine : "maps to"

  ExpenseCategory ||--o{ Expense : groups
  StoredFile ||--o{ Expense : receipt
```

## 2. Tenancy and identity

### 2.1 Pharmacy (the tenant)

```prisma
model Pharmacy {
  id               String         @id @default(uuid())
  slug             String         @unique          // used in /p/<slug>/login
  name             String                          // display name, editable by Pharmacy Admin
  legalName        String?
  logoFileId       String?                         // StoredFile, resized 512 and 128 px
  brandColor       String?                         // hex, validated for contrast
  address          String         @default("")
  city             String?
  phone            String         @default("")
  whatsapp         String?
  email            String?
  licenseNumber    String?                         // drug sale licence, printed on bills
  taxNumber        String?
  status           PharmacyStatus @default(ACTIVE) // ACTIVE, GRACE, SUSPENDED, DEACTIVATED
  statusReason     String?
  plan             String         @default("STANDARD")
  subscriptionEndsAt DateTime?
  maxUsers         Int            @default(10)
  timezone         String         @default("Asia/Karachi")
  currency         String         @default("PKR")
  createdById      String                          // PlatformUser
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

Only Developer screens write `status`, `plan`, `subscriptionEndsAt`, `maxUsers` and `slug`. Pharmacy Admins edit the profile and branding fields.

### 2.2 Which tables are tenant tables

Every table below gets `pharmacyId String` (not null, FK to `Pharmacy`, indexed) and a Row-Level Security policy:

`User`, `Role` (custom roles only, see 2.4), `Category`, `Medicine`, `Batch`, `StockMovement`, `Customer`, `CustomerLedger`, `Supplier`, `SupplierLedger`, `SupplierProduct`, `SupplierItemAlias`, `Purchase`, `PurchaseItem`, `PurchaseOrder`, `PurchaseOrderItem`, `Sale`, `SaleItem`, `SaleReturn`, `SaleReturnItem`, `SupplierReturn`, `SupplierReturnItem`, `CashSession`, `CashMovement`, `StoredFile`, `StockIntake`, `StockIntakePage`, `StockIntakeLine`, `ExpenseCategory`, `Expense`, `DailySummary`, `Notification`, `NotificationRead`, `AuditLog`, `OutboxEvent`, `IdempotencyKey`, `PharmacySettings`, `TenantCounter`, `FeatureFlag`.

Child tables (for example `SaleItem`) carry `pharmacyId` too, even though the parent has it. That keeps every RLS policy a simple column comparison with no joins, which is both faster and harder to get wrong.

Unique keys that are global today become per pharmacy:

| Today | After |
|---|---|
| `Sale.invoiceNo @unique` | `@@unique([pharmacyId, invoiceNo])` |
| `Purchase.number @unique` | `@@unique([pharmacyId, number])` |
| `Medicine.barcode @unique`, `Medicine.sku @unique` | `@@unique([pharmacyId, barcode])`, `@@unique([pharmacyId, sku])` |
| `Category.name @unique` | `@@unique([pharmacyId, name])` |
| `User.email @unique` | `@@unique([pharmacyId, username])`, email optional |
| `Batch @@unique([medicineId, batchNumber])` | unchanged (medicine already belongs to one pharmacy) |

RLS template applied to each tenant table in the migration:

```sql
ALTER TABLE "Sale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Sale"
  USING ("pharmacyId" = current_setting('app.pharmacy_id', true)::uuid)
  WITH CHECK ("pharmacyId" = current_setting('app.pharmacy_id', true)::uuid);
```

### 2.3 Accounts in two realms

```prisma
model PlatformUser {                       // Developer accounts, no pharmacyId
  id             String   @id @default(uuid())
  name           String
  email          String   @unique
  passwordHash   String
  totpSecret     String?                   // encrypted at rest; required before first use
  recoveryCodes  String[]                  // hashed
  sessionVersion Int      @default(1)
  lastLoginAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model User {                               // pharmacy staff
  id                 String   @id @default(uuid())
  pharmacyId         String
  roleId             String
  name               String
  username           String                // unique inside the pharmacy
  email              String?
  phone              String?
  passwordHash       String?               // null until an invite is accepted
  mustChangePassword Boolean  @default(false)
  totpSecret         String?
  active             Boolean  @default(true)
  sessionVersion     Int      @default(1)
  failedLogins       Int      @default(0)
  lockedUntil        DateTime?
  lastLoginAt        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@unique([pharmacyId, username])
}
```

There is deliberately **no API that writes `PlatformUser`** except the owner changing their own password and 2FA. The first row comes from `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD` on boot; recovery is the `platform:recover-owner` server command.

### 2.4 Roles

```prisma
model Role {
  id          String   @id @default(uuid())
  pharmacyId  String?                      // null = global system template
  key         String                       // PHARMACY_ADMIN, PHARMACIST, CASHIER, or custom slug
  name        String
  description String?
  system      Boolean  @default(false)     // templates are read-only
  permissions String[]                     // tenant permission catalog values only
  landingPath String   @default("/dashboard")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([pharmacyId, key])
}
```

System templates are readable by every pharmacy (RLS policy allows `pharmacyId IS NULL` for SELECT only). A trigger blocks removing or deactivating the last active user holding `PHARMACY_ADMIN` in a pharmacy.

### 2.5 Tokens, 2FA and sessions

```prisma
model AuthToken {
  id          String    @id @default(uuid())
  realm       Realm                        // PLATFORM, STAFF
  subjectId   String                       // PlatformUser or User id
  pharmacyId  String?
  purpose     TokenPurpose                 // INVITE, RESET
  tokenHash   String    @unique            // sha256 of the random token; the token itself is never stored
  expiresAt   DateTime
  usedAt      DateTime?
  revokedAt   DateTime?
  createdByRealm Realm
  createdById String
  createdAt   DateTime  @default(now())
  @@index([subjectId, purpose])
}

model SupportSession {                     // Developer entering a pharmacy
  id          String    @id @default(uuid())
  platformUserId String
  pharmacyId  String
  reason      String
  startedAt   DateTime  @default(now())
  endedAt     DateTime?
}
```

`AuditLog` gains `realm` and `supportSessionId`, so every action in a support session is traceable and shown to the pharmacy as "Platform support".

### 2.6 Per-pharmacy settings, counters and flags

The single-row `Setting` table becomes `PharmacySettings` with `pharmacyId` as its primary key. Branding fields move to `Pharmacy`; operational settings stay here (see section 6.1).

```prisma
model TenantCounter {                      // replaces global sequences
  pharmacyId String
  key        String                        // INVOICE, PURCHASE, PO, RETURN, SUPPLIER_RETURN, EXPENSE, ORDER
  value      BigInt  @default(0)
  @@id([pharmacyId, key])
}

model FeatureFlag {
  pharmacyId String?                       // null = platform default
  key        String                        // ocr, purchaseOrders, cashSessions, returns, expenses
  enabled    Boolean @default(false)
  updatedAt  DateTime @updatedAt
  @@id([pharmacyId, key])
}
```

Effective flag = pharmacy row if present, otherwise the platform default. Only the Developer edits flags.

### 2.7 Supporting tables

```prisma
model IdempotencyKey {
  key        String   @id
  pharmacyId String
  actorId    String
  route      String
  status     Int
  response   Json
  createdAt  DateTime @default(now())    // purged after 24 h
}

model RateLimitHit {                     // not tenant scoped: login happens before a tenant is known
  bucket    String                       // e.g. "login:staff:<slug>:<username>", "login:ip:<ip>"
  at        DateTime @default(now())
  @@index([bucket, at])
}
```

## 3. Sales

### 3.1 Sale additions

| Field | Purpose |
|---|---|
| `customerName String?` | Walk-in name printed on the bill (R8) |
| `customerPhone String?` | Walk-in contact printed on the bill (R8), indexed for lookup |
| `cashSessionId String?` | Links cash and card sales to the cashier's drawer session |
| `cashTendered Decimal?` | Cash handed over by the customer (cash sales) |
| `changeGiven Decimal` | Cash tendered minus the amount paid, printed on the receipt |
| `receiptFormat String?` | Format used at print time, for identical reprints |

### 3.2 Cash sessions

```prisma
model CashSession {
  id            String    @id @default(uuid())
  userId        String
  status        CashSessionStatus @default(OPEN)   // OPEN, CLOSED
  openedAt      DateTime  @default(now())
  openingFloat  Decimal   @db.Decimal(12, 2)
  closedAt      DateTime?
  expectedCash  Decimal?  @db.Decimal(12, 2)       // computed at close
  countedCash   Decimal?  @db.Decimal(12, 2)
  difference    Decimal?  @db.Decimal(12, 2)
  note          String?
  closedById    String?
  sales         Sale[]
  movements     CashMovement[]
  @@index([userId, status])
}

model CashMovement {                 // pay-in and pay-out during a shift (e.g. petty cash)
  id         String   @id @default(uuid())
  sessionId  String
  type       CashMovementType      // PAY_IN, PAY_OUT (cash refunds are returns linked to the session)
  amount     Decimal  @db.Decimal(12, 2)
  reason     String
  userId     String
  createdAt  DateTime @default(now())
}
```

Expected cash at close = opening float + amount paid on completed cash and credit sales in the session - cash refunds (`SaleReturn.cashSessionId`, `refundMethod = CASH`) + pay-ins - pay-outs. Card sales never reach the drawer. A difference above `cashDiffThreshold` needs a note and raises a `CASH_DIFFERENCE` notification for `cash.manage`.

Constraint: a partial unique index allows only one `OPEN` session per user:
`CREATE UNIQUE INDEX one_open_session ON "CashSession"("userId") WHERE status = 'OPEN';`

### 3.3 Customer returns

```prisma
model SaleReturn {
  id          String   @id @default(uuid())
  number      String   @unique             // RET-YYYYMMDD-00001 from a sequence
  saleId      String
  userId      String
  approvedById String?
  refundMethod PaymentMethod                // CASH, CARD, CREDIT (credit note to ledger)
  total       Decimal  @db.Decimal(12, 2)
  reason      String
  cashSessionId String?                     // the drawer a cash refund came out of
  createdAt   DateTime @default(now())
  items       SaleReturnItem[]
}

model SaleReturnItem {
  id          String  @id @default(uuid())
  returnId    String
  saleItemId  String                        // exact line, so price and batch are known
  batchId     String
  quantity    Int
  unitPrice   Decimal @db.Decimal(12, 2)
  costPrice   Decimal @db.Decimal(12, 2)
  restock     Boolean @default(true)        // false = damaged, goes to DAMAGE movement
  lineTotal   Decimal @db.Decimal(12, 2)
}
```

Rules enforced in the service, with the sale row locked: total returned quantity per `saleItemId` cannot exceed the sold quantity; a line's refund is its share of what was paid (unit price x quantity, less the invoice discount in proportion); cash and card refunds together cannot exceed the amount paid on the invoice (the rest goes as a credit note, which needs a customer account); an invoice with returns cannot be cancelled. Restocked items go back to their original batch with a `SALE_RETURN` movement; damaged ones get `SALE_RETURN` then `DAMAGE`. `CustomerLedger` gains `returnId` and the `RETURN` kind.

`MovementType` gains `SALE_RETURN` and `SUPPLIER_RETURN`.

`Batch` gains `setAsideAt` and `setAsideNote` (Phase 6): a batch set aside for return to the supplier stays in stock but is skipped by FEFO selling, POS search and stock counts until it is written off, returned or put back.

## 4. Procurement

### 4.1 Supplier catalog (price list maintained by pharmacists)

```prisma
model SupplierProduct {
  supplierId    String
  medicineId    String
  supplierCode  String?
  lastPrice     Decimal? @db.Decimal(12, 2)
  lastBonusRule String?                    // e.g. "10+1"
  leadTimeDays  Int      @default(2)
  preferred     Boolean  @default(false)
  updatedAt     DateTime @updatedAt
  @@id([supplierId, medicineId])
}
```

Updated automatically whenever a purchase is posted, so it stays current without manual work. A partial unique index keeps one `preferred` supplier per medicine, and another keeps a `supplierCode` used once per supplier. As built, the row also has its own `id`, `pharmacyId` and `packSize`. Matching a bill line tries the supplier's code (after the barcode, before learned aliases), and posting a bill fills in codes the catalog did not have yet.

### 4.2 Purchase orders

```prisma
model PurchaseOrder {
  id            String   @id @default(uuid())
  number        String   @unique             // PO-YYYYMMDD-00001
  supplierId    String
  status        PurchaseOrderStatus          // DRAFT, SENT, PARTIALLY_RECEIVED, RECEIVED, CLOSED, CANCELLED
  source        String   @default("MANUAL")  // MANUAL or SUGGESTED
  expectedDate  DateTime? @db.Date
  note          String?
  estimatedTotal Decimal @db.Decimal(12, 2)
  createdById   String
  approvedById  String?
  sentAt        DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  items         PurchaseOrderItem[]
  purchases     Purchase[]
  @@index([supplierId, status])
}

model PurchaseOrderItem {
  id           String  @id @default(uuid())
  orderId      String
  medicineId   String
  orderedQty   Int
  receivedQty  Int     @default(0)
  expectedPrice Decimal? @db.Decimal(12, 2)
  @@unique([orderId, medicineId])
}
```

Check constraint: `receivedQty >= 0 AND receivedQty <= orderedQty * 2` (over-receipt allowed for bonus stock but bounded).

As built: `PurchaseOrder` also has `closedAt` and `closeReason`; `receivedQty` counts paid units only (bonus units do not count against an order). A draft is approved and sent with `po.approve`; receiving opens a stock entry draft with the pending lines (`StockIntake.purchaseOrderId`), and the posted purchase (`Purchase.purchaseOrderId`) moves the order to `PARTIALLY_RECEIVED` or `RECEIVED`. An order with nothing received is `CANCELLED`, one with part received is `CLOSED` short.

### 4.3 Purchase and purchase item additions

Pharmaceutical distributor bills in Pakistan usually show **bonus (free) quantity, trade discount and sales tax** per line. The current model has none of these, which makes OCR results impossible to post faithfully and makes cost price wrong when bonus stock arrives.

| Table | New field | Purpose |
|---|---|---|
| `Purchase` | `purchaseOrderId String?` | Link to the order it fulfils |
| `Purchase` | `intakeId String?` | Link to the stock entry draft it was posted from |
| `Purchase` | `taxTotal Decimal` | Sales tax on the bill |
| `PurchaseItem` | `bonusQty Int @default(0)` | Free units, added to batch stock |
| `PurchaseItem` | `discountPercent Decimal` | Trade discount on the line |
| `PurchaseItem` | `taxAmount Decimal` | Line tax |
| `PurchaseItem` | `effectiveCost Decimal` | `lineTotal / (quantity + bonusQty)`, used as batch cost for profit |

Unique index `(supplierId, supplierInvoice)` where `supplierInvoice` is not null, to stop the same bill being entered twice.

### 4.4 Supplier returns

`SupplierReturn` and `SupplierReturnItem` mirror customer returns: they reference a batch, reduce stock with a `SUPPLIER_RETURN` movement and credit the supplier ledger. Main use: sending near-expiry stock back. Lines are valued at the batch cost; the ledger entry (kind `RETURN`, `SupplierLedger.supplierReturnId`) lowers what the pharmacy owes, and an emptied batch is no longer set aside.

### 4.5 Stock entry drafts (manual, OCR and import)

One draft model serves every way of entering stock (architecture, section 6.1).

```prisma
model StoredFile {
  id           String   @id @default(uuid())
  key          String   @unique              // storage key, random, under pharmacies/<id>/
  purpose      String                        // BILL, STOCK_LIST, LOGO, EXPENSE_RECEIPT, PRESCRIPTION
  mime         String
  size         Int
  sha256       String
  uploadedById String
  createdAt    DateTime @default(now())
  @@index([pharmacyId, sha256])
}

model StockIntake {
  id              String      @id @default(uuid())
  number          String                     // SE-YYYYMMDD-00001 from TenantCounter
  kind            IntakeKind                 // PURCHASE_BILL, STOCK_LIST
  source          IntakeSource               // MANUAL, OCR, IMPORT
  status          IntakeStatus               // DRAFT, UPLOADED, PROCESSING, NEEDS_REVIEW, POSTED, FAILED, DISCARDED
  supplierId      String?                    // required to post a PURCHASE_BILL
  supplierInvoice String?
  billDate        DateTime?  @db.Date
  billTotal       Decimal?   @db.Decimal(12, 2)
  purchaseOrderId String?                    // receive against an order
  provider        String?                    // OCR adapter used
  rawResult       Json?                      // normalised provider output, kept for re-parsing and accuracy checks
  header          Json?                      // OCR header fields with confidence
  error           String?
  attempts        Int        @default(0)
  purchaseId      String?    @unique         // set when posted as a purchase
  postedAt        DateTime?
  createdById     String
  updatedById     String?
  reviewedById    String?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  pages           StockIntakePage[]
  lines           StockIntakeLine[]
  @@unique([pharmacyId, number])
  @@index([pharmacyId, status, createdAt])
}

model StockIntakePage {                      // one photo or PDF page
  intakeId  String
  pageNo    Int
  fileId    String   @unique
  @@id([intakeId, pageNo])
}

model StockIntakeLine {
  id              String    @id @default(uuid())
  intakeId        String
  lineNo          Int
  rawText         String?                    // OCR text of the row, null for manual lines
  name            String?
  medicineId      String?
  batchNumber     String?
  expiryDate      DateTime? @db.Date
  quantity        Int?
  bonusQty        Int?
  rate            Decimal?  @db.Decimal(12, 2)
  discountPercent Decimal?  @db.Decimal(5, 2)
  taxAmount       Decimal?  @db.Decimal(12, 2)
  amount          Decimal?  @db.Decimal(12, 2)
  salePrice       Decimal?  @db.Decimal(12, 2)  // defaults to medicine sale price, editable
  matchMethod     String?                    // BARCODE, SUPPLIER_CODE, ALIAS, TRIGRAM, MANUAL
  confidence      Float?                     // 0..1, lowest of the field confidences
  boxes           Json?                      // page number and bounding boxes for highlight on the photo
  ignored         Boolean   @default(false)  // reviewer removed the line
  @@unique([intakeId, lineNo])
}

model SupplierItemAlias {
  id          String   @id @default(uuid())
  supplierId  String?                        // null = alias for the whole pharmacy
  text        String                         // normalised: lower case, single spaces, no punctuation
  medicineId  String
  hits        Int      @default(1)
  updatedAt   DateTime @updatedAt
  @@unique([pharmacyId, supplierId, text])
}
```

Posting rules:

- `PURCHASE_BILL` posts through `createPurchase` with every line (including bonus, discount and tax from section 4.3) and sets `purchaseId`. Unique `(pharmacyId, supplierId, supplierInvoice)` blocks double posting.
- `STOCK_LIST` posts opening batches: each line creates or tops up a batch and writes an `OPENING` movement with `reference = intake number`. No supplier ledger entry.
- Posting and marking the draft `POSTED` happen in one transaction, and confirmed OCR matches are written to `SupplierItemAlias` in the same transaction.
- Drafts are never deleted; discarding sets `DISCARDED` and the `files.cleanup` job removes photos after the retention period.

## 5. Finance

```prisma
model ExpenseCategory {
  id     String  @id @default(uuid())
  name   String                            // Rent, Salaries, Electricity, ... (created on first use)
  active Boolean @default(true)            // never deleted; a category no longer used is switched off
  @@unique([pharmacyId, name])
}

model Expense {
  id            String   @id @default(uuid())
  number        String                     // EXP-YYYYMMDD-00001, unique per pharmacy
  categoryId    String
  amount        Decimal  @db.Decimal(12, 2) // CHECK amount > 0
  date          DateTime @db.Date          // not in the future
  method        PaymentMethod              // CASH or CARD (a bank transfer counts as CARD)
  description   String
  receiptFileId String?                    // optional photo of the receipt
  cashSessionId String?                    // when paid from the drawer: lowers its expected cash
  userId        String
  cancelledAt   DateTime?                  // soft cancel with a reason, never deleted
  cancelReason  String?
  createdAt     DateTime @default(now())
  @@index([pharmacyId, date])
}

model DailySummary {                       // maintained by report.rollup, rebuildable from source tables
  date          DateTime @db.Date          // the pharmacy's local day
  grossSales    Decimal  @db.Decimal(14, 2) // before invoice discounts
  discounts     Decimal  @db.Decimal(14, 2)
  returns       Decimal  @db.Decimal(14, 2) // refunds on customer returns
  netSales      Decimal  @db.Decimal(14, 2) // gross - discounts - returns
  cogs          Decimal  @db.Decimal(14, 2) // cost sold, less cost of returns put back on the shelf
  stockLosses   Decimal  @db.Decimal(14, 2) // damage and expiry write-offs at batch cost
  expenses      Decimal  @db.Decimal(14, 2)
  purchases     Decimal  @db.Decimal(14, 2)
  invoiceCount  Int
  updatedAt     DateTime @updatedAt
  @@id([pharmacyId, date])
}
```

## 6. Platform

Every model in this section carries `pharmacyId` as described in section 2.2. `AuditLog.pharmacyId` is nullable for Developer actions that are not inside a pharmacy (for example creating a pharmacy).

```prisma
model AuditLog {
  id               BigInt   @id @default(autoincrement())
  pharmacyId       String?
  at               DateTime @default(now())
  realm            Realm                     // PLATFORM, STAFF
  actorId          String?
  supportSessionId String?                   // set when the Developer acts inside a pharmacy
  action           String                    // e.g. sale.cancel, medicine.price.update, role.update, pharmacy.suspend
  entity           String
  entityId         String
  before           Json?
  after            Json?
  ip               String?
  userAgent        String?
  @@index([pharmacyId, entity, entityId])
  @@index([pharmacyId, at])
  @@index([actorId, at])
}

model OutboxEvent {
  id          BigInt    @id @default(autoincrement())
  pharmacyId  String?
  type        String
  payload     Json
  createdAt   DateTime  @default(now())
  processedAt DateTime?
  attempts    Int       @default(0)
  lastError   String?
  @@index([processedAt, id])
}

model Notification {
  id                 String   @id @default(uuid())
  pharmacyId         String?                 // null = platform notification for the Developer
  type               String                  // EXPIRY_30, EXPIRY_7, EXPIRED, LOW_STOCK, INTAKE_READY, PO_OVERDUE, CASH_DIFF, RESET_REQUEST, SUBSCRIPTION
  severity           String                  // INFO, WARNING, CRITICAL
  title              String
  body               String
  link               String?
  audiencePermission String
  dedupeKey          String
  createdAt          DateTime @default(now())
  resolvedAt         DateTime?
  reads              NotificationRead[]
  @@unique([pharmacyId, dedupeKey])
}

model NotificationRead {
  notificationId String
  userId         String
  readAt         DateTime @default(now())
  @@id([notificationId, userId])
}
```

`AuditLog` hardening: `app_user` is granted `INSERT, SELECT` only on this table.

### 6.1 Pharmacy settings (operational)

`PharmacySettings` (one row per pharmacy) keeps the current settings fields that are not branding, plus:

| Field | Default | Notes |
|---|---|---|
| `expiryAlertDays` | 30 | From the notes; the existing `expiryWarningDays` (90) stays for the planning screen |
| `receiptFormat` | `THERMAL_80` | `THERMAL_80`, `THERMAL_58`, `A4` |
| `receiptHeader`, `invoiceFooter` | pharmacy name, existing footer | Editable by Pharmacy Admin |
| `autoPrintReceipt` | true | Print dialog opens after a sale |
| `cashDiffThreshold` | 100 | Difference that requires a note at shift close |
| `requireCashSession` | true | Cash sales blocked without an open session |
| `ocrProvider` | `LOCAL` | `LOCAL` or a cloud adapter key (allowed values controlled by the Developer) |
| `reorderCoverDays` | 7 | Used by reorder suggestions |
| `stockEntryPriceWarnPercent` | 10 | Warn when a line rate differs from the last purchase price by more than this |
| `ocrMonthlyLimit` | per plan | Set by the Developer; uploads beyond it fall back to manual entry |

## 7. Indexes and search

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX medicine_name_trgm    ON "Medicine" USING gin (lower(name) gin_trgm_ops);
CREATE INDEX medicine_generic_trgm ON "Medicine" USING gin (lower("genericName") gin_trgm_ops);
CREATE INDEX customer_name_trgm    ON "Customer" USING gin (lower(name) gin_trgm_ops);
CREATE INDEX customer_phone_idx    ON "Customer" ("pharmacyId", phone);
CREATE INDEX sale_phone_idx        ON "Sale" ("pharmacyId", "customerPhone");
CREATE INDEX alias_text_trgm       ON "SupplierItemAlias" USING gin (text gin_trgm_ops);
CREATE INDEX batch_expiring        ON "Batch" ("pharmacyId", "expiryDate") WHERE quantity > 0;
```

Trigram indexes are not tenant-prefixed (GIN cannot lead with a uuid column efficiently without `btree_gin`). RLS filters the matches; with `btree_gin` installed, the indexes can become `(pharmacyId, lower(name))` when a single pharmacy grows beyond about 100k medicines.

## 8. Numbering

Global PostgreSQL sequences (`invoice_seq`, `purchase_seq`) are replaced by `TenantCounter` so each pharmacy has its own series starting at 1:

```sql
UPDATE "TenantCounter" SET value = value + 1
WHERE "pharmacyId" = $1 AND key = 'INVOICE'
RETURNING value;
```

Runs inside the sale transaction. The row lock serialises numbering only within one pharmacy. Number formats stay as today (`INV-YYYYMMDD-00001`), with new keys for `PO`, `RET`, `SRET`, `EXP` and `SE` (stock entry).

## 9. Migration rules

1. One Prisma migration per phase feature, never edit an applied migration.
2. Additive first (new nullable columns, new tables), backfill in the same migration with SQL, then tighten constraints in a follow-up migration.
3. Every migration is tested on a copy of production data before release (`pg_dump` then restore into a staging database, run `prisma migrate deploy`, run the smoke script and the tenant isolation suite).
4. Raw SQL that Prisma cannot express (RLS policies, partial indexes, check constraints, trigram indexes, grants) lives in the migration file with a comment explaining it, as the existing constraints migration already does.
5. Every new tenant table must ship with its `pharmacyId`, index and RLS policy in the same migration. A CI check queries `pg_tables` and fails if any table with a `pharmacyId` column has RLS disabled.

### 9.1 Moving the current single-shop data to multi-tenant

The existing installation becomes the first pharmacy. Done in Phase 1 in this order:

1. Create `Pharmacy`, `PlatformUser`, `TenantCounter`, `PharmacySettings`, `AuthToken`, `SupportSession`.
2. Insert one `Pharmacy` from the current `Setting` row (name, address, phone, email, currency) with a slug chosen at migration time.
3. Add nullable `pharmacyId` to every tenant table and backfill it with that pharmacy's id.
4. Seed `TenantCounter` from the current `invoice_seq` and `purchase_seq` values so numbering continues without gaps or duplicates.
5. Create role templates; map users: `ADMIN -> PHARMACY_ADMIN`, `PHARMACIST -> PHARMACIST`, `CASHIER -> CASHIER`; derive `username` from the email's local part.
6. Make `pharmacyId` not null, replace global unique keys with the per-pharmacy keys in section 2.2, drop the old `Role` enum, sequences and `Setting` table.
7. Enable RLS and create policies; create `app_user` and `platform_user` roles with their grants; switch `DATABASE_URL` to `app_user`.
8. Run the full test suite, the smoke script and the isolation suite against a restored copy before running it on the live database.
