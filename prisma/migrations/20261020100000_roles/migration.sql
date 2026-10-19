-- Hand-written: roles become data (docs/plan/02-architecture.md, sections 5.4 and 5.5; data model 2.4).
-- Every user gets a role row: one of three shared templates (no pharmacy, read-only for pharmacies) or a
-- custom role of their own pharmacy. The old enum values map to the templates. The templates' permission
-- lists are also kept in code (src/modules/identity/permissions.ts), which the app treats as the source.

-- 1. Users point at a role id instead of the enum. The enum goes first: a table named "Role" would clash
--    with the type of the same name.
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
UPDATE "User" SET "roleId" = CASE "role"::text
  WHEN 'ADMIN' THEN '00000000-0000-4000-a000-000000000001'
  WHEN 'PHARMACIST' THEN '00000000-0000-4000-a000-000000000002'
  ELSE '00000000-0000-4000-a000-000000000003'
END;
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";

-- 2. Roles
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT DEFAULT current_setting('app.pharmacy_id'::text, true),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "landingPath" TEXT NOT NULL DEFAULT '/dashboard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Role_pharmacyId_idx" ON "Role"("pharmacyId");
CREATE UNIQUE INDEX "Role_pharmacyId_key_key" ON "Role"("pharmacyId", "key");
ALTER TABLE "Role" ADD CONSTRAINT "Role_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Role" ("id", "pharmacyId", "key", "name", "description", "system", "permissions", "landingPath", "updatedAt") VALUES
  ('00000000-0000-4000-a000-000000000001', NULL, 'PHARMACY_ADMIN', 'Pharmacy Admin', 'Everything in the pharmacy: staff, roles, branding, prices, reports and settings.', true, ARRAY['dashboard.view', 'pos.use', 'sales.view', 'sales.reprint.any', 'sales.cancel', 'sales.overrideCredit', 'cash.manage', 'medicines.view', 'medicines.manage', 'medicines.delete', 'inventory.view', 'inventory.adjust', 'stockEntry.create', 'stockEntry.post', 'suppliers.view', 'suppliers.manage', 'supplierCatalog.manage', 'purchases.view', 'purchases.create', 'po.approve', 'customers.view', 'customers.manage', 'customers.payments', 'cost.view', 'reports.view', 'finance.view', 'users.manage', 'roles.manage', 'branding.manage', 'settings.manage', 'audit.view']::TEXT[], '/dashboard', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-a000-000000000002', NULL, 'PHARMACIST', 'Pharmacist', 'Medicines, stock and expiry, purchases and suppliers, cancellations and the counter.', true, ARRAY['dashboard.view', 'pos.use', 'sales.view', 'medicines.view', 'inventory.view', 'customers.view', 'customers.manage', 'customers.payments', 'sales.reprint.any', 'sales.cancel', 'sales.overrideCredit', 'medicines.manage', 'inventory.adjust', 'stockEntry.create', 'stockEntry.post', 'suppliers.view', 'supplierCatalog.manage', 'purchases.view', 'purchases.create', 'po.approve', 'cost.view', 'reports.view']::TEXT[], '/dashboard', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-a000-000000000003', NULL, 'CASHIER', 'Cashier', 'The counter: sales, receipts and customers. No cost prices or profit.', true, ARRAY['dashboard.view', 'pos.use', 'sales.view', 'medicines.view', 'inventory.view', 'customers.view', 'customers.manage', 'customers.payments']::TEXT[], '/pos', CURRENT_TIMESTAMP);

CREATE INDEX "User_roleId_idx" ON "User"("roleId");
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Row-level security: a pharmacy reads the templates and its own roles, and writes only its own.
--    Policies of the same command are combined with OR, so templates are readable but never writable.
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "Role" FOR SELECT
  USING ("pharmacyId" IS NULL OR "pharmacyId" = current_setting('app.pharmacy_id', true));
CREATE POLICY tenant_isolation ON "Role"
  USING ("pharmacyId" = current_setting('app.pharmacy_id', true))
  WITH CHECK ("pharmacyId" = current_setting('app.pharmacy_id', true));

-- 4. A pharmacy always keeps one active Pharmacy Admin (besides the hidden support account). The services
--    check this first with a clear message; the trigger makes sure no code path can get around it.
CREATE FUNCTION pcrm_keep_one_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isSystem" OR NOT OLD."active" OR OLD."roleId" <> '00000000-0000-4000-a000-000000000001' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."active" AND NEW."roleId" = OLD."roleId" THEN
    RETURN NULL;
  END IF;
  -- the whole pharmacy is being removed
  IF NOT EXISTS (SELECT 1 FROM "Pharmacy" WHERE "id" = OLD."pharmacyId") THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "pharmacyId" = OLD."pharmacyId" AND "active" AND NOT "isSystem" AND "roleId" = '00000000-0000-4000-a000-000000000001'
  ) THEN
    RAISE EXCEPTION 'A pharmacy needs at least one active Pharmacy Admin.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER "User_keep_one_admin" AFTER UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION pcrm_keep_one_admin();
