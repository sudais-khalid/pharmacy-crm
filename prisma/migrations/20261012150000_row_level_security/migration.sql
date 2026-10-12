-- Hand-written: tenant isolation enforced by PostgreSQL (docs/plan/02-architecture.md, section 5.2).
--
-- The application's default database client runs as pcrm_app (set at connection start, or a dedicated
-- login role through APP_DATABASE_URL). pcrm_app owns nothing, so row-level security applies to it:
-- every business row is visible only when its "pharmacyId" equals the transaction's app.pharmacy_id.
-- With no tenant set the comparison fails and no rows match, so a forgotten scope fails closed.
-- The owning role (migrations, Developer console, worker, login lookups) is not subject to these policies.

-- 1. Restricted role -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcrm_app') THEN
    CREATE ROLE pcrm_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- the owning role must be a member to switch to it
  EXECUTE format('GRANT pcrm_app TO %I', current_user);
END
$$;

-- 2. Privileges ----------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO pcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pcrm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pcrm_app;
-- tables created by later migrations get the same privileges (each must also add its own policy)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pcrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pcrm_app;

-- platform-only tables: tenant code can never read Developer accounts or support sessions
REVOKE ALL ON "PlatformUser", "SupportSession" FROM pcrm_app;
DO $$
BEGIN
  -- absent in shadow databases used for drift checks
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM pcrm_app;
  END IF;
END
$$;
-- the audit log is append-only for the application
REVOKE UPDATE, DELETE ON "AuditLog" FROM pcrm_app;
-- feature flags are set by the Developer only
REVOKE INSERT, UPDATE, DELETE ON "FeatureFlag" FROM pcrm_app;
-- a pharmacy may edit its profile, never its status, plan, limits or slug
REVOKE INSERT, UPDATE, DELETE ON "Pharmacy" FROM pcrm_app;
GRANT UPDATE ("name", "legalName", "address", "city", "phone", "whatsapp", "email", "licenseNumber", "taxNumber", "currency", "updatedAt") ON "Pharmacy" TO pcrm_app;

-- 3. Row-level security --------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['User','Category','Medicine','Batch','StockMovement','Customer','CustomerLedger','Supplier',
                           'SupplierLedger','Purchase','PurchaseItem','Sale','SaleItem','AuditLog','OutboxEvent',
                           'PharmacySettings','TenantCounter','FeatureFlag','AuthToken',
                           -- no privileges for pcrm_app either; the policy is defence in depth
                           'SupportSession'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("pharmacyId" = current_setting(''app.pharmacy_id'', true)) '
      'WITH CHECK ("pharmacyId" = current_setting(''app.pharmacy_id'', true))', t);
  END LOOP;
END
$$;

ALTER TABLE "Pharmacy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Pharmacy"
  USING ("id" = current_setting('app.pharmacy_id', true))
  WITH CHECK ("id" = current_setting('app.pharmacy_id', true));
