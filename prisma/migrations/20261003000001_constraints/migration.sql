-- Business-rule constraints enforced by the database itself

ALTER TABLE "Batch" ADD CONSTRAINT "Batch_quantity_nonneg" CHECK ("quantity" >= 0);
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_prices_nonneg" CHECK ("purchasePrice" >= 0 AND "salePrice" >= 0);
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_prices_nonneg" CHECK ("purchasePrice" >= 0 AND "salePrice" >= 0 AND "minStock" >= 0);
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_credit_nonneg" CHECK ("creditLimit" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_pos" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "costPrice" >= 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_quantity_pos" CHECK ("quantity" > 0 AND "purchasePrice" >= 0 AND "salePrice" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_valid" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amounts_valid" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "total" >= 0 AND "paid" >= 0 AND "paid" <= "total");
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_amounts" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" > 0 OR "credit" > 0));
ALTER TABLE "SupplierLedger" ADD CONSTRAINT "SupplierLedger_amounts" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" > 0 OR "credit" > 0));
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_singleton" CHECK ("id" = 1);

-- Sequences for gap-free-ish, race-safe document numbers
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS purchase_seq START 1;
