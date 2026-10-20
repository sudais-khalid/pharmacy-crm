import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { customerBalance, createCustomer, importCustomers, receiveCustomerPayment } from "@/modules/customers";
import { createSupplier, importSuppliers, paySupplier, supplierBalance } from "@/modules/procurement";
import { tenantTransaction } from "@/lib/db";
import { resetDb, makeUser, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const bal = (fn: typeof customerBalance | typeof supplierBalance, id: string) => tenantTransaction(pharmacyId, async (tx) => Number(await fn(tx, id)));

describe("opening balances (first-run setup)", () => {
  it("start a customer's account with what they owed, which payments then settle", async () => {
    const c = ctxOf(await makeUser("ADMIN"));
    const cust = await createCustomer(c, { name: "Haji Rafiq", phone: "0300-1112223", email: null, address: null, notes: null, creditLimit: 20000, active: true, openingBalance: 4500 });
    expect(await bal(customerBalance, cust.id)).toBe(4500);
    await receiveCustomerPayment(c, cust.id, { amount: 1500, method: "CASH" });
    expect(await bal(customerBalance, cust.id)).toBe(3000);
    const line = await platformDb.customerLedger.findFirstOrThrow({ where: { customerId: cust.id, kind: "ADJUSTMENT" } });
    expect(line.description).toMatch(/Opening balance/);
    expect(await platformDb.auditLog.count({ where: { action: "customer.create", entityId: cust.id } })).toBe(1);
  });

  it("add many customers at once and skip the ones already there", async () => {
    const c = ctxOf(await makeUser("ADMIN"));
    const first = await importCustomers(c, [{ name: "Bilal", phone: "0311", creditLimit: 0, openingBalance: 800 }, { name: "Sana", phone: null, creditLimit: 0, openingBalance: 0 }]);
    expect(first).toEqual({ created: 2, skipped: [] });
    const again = await importCustomers(c, [{ name: "bilal", phone: "0311", creditLimit: 0, openingBalance: 800 }, { name: "Bilal", phone: "0399", creditLimit: 0, openingBalance: 0 }]);
    expect(again).toEqual({ created: 1, skipped: ["bilal"] });
    const owed = await platformDb.customerLedger.aggregate({ where: { pharmacyId }, _sum: { debit: true } });
    expect(Number(owed._sum.debit)).toBe(800);
  });

  it("start a supplier's account with what the pharmacy owed", async () => {
    const c = ctxOf(await makeUser("ADMIN"));
    const r = await importSuppliers(c, [{ name: "Medi Distributors", phone: "091-555", openingBalance: 25000 }, { name: "medi distributors", phone: null, openingBalance: 1 }]);
    expect(r).toEqual({ created: 1, skipped: ["medi distributors"] });
    const s = await platformDb.supplier.findFirstOrThrow({ where: { pharmacyId, name: "Medi Distributors" } });
    expect(await bal(supplierBalance, s.id)).toBe(25000);
    await paySupplier(c, s.id, { amount: 25000, method: "CASH" });
    expect(await bal(supplierBalance, s.id)).toBe(0);
    const plain = await createSupplier(c, { name: "No Balance Pharma", contactPerson: null, phone: null, email: null, address: null, paymentTerms: null, notes: null, active: true, openingBalance: 0 });
    expect(await platformDb.supplierLedger.count({ where: { supplierId: plain.id } })).toBe(0);
  });
});

describe("opening balances and roles", () => {
  it("are only for the Pharmacy Admin: the counter can add customers but not their old debts", async () => {
    const cashier = ctxOf(await makeUser("CASHIER"));
    const walkIn = await createCustomer(cashier, { name: "Walk-in Saved", phone: null, email: null, address: null, notes: null, creditLimit: 0, active: true, openingBalance: 0 });
    expect(walkIn.name).toBe("Walk-in Saved");
    await expect(createCustomer(cashier, { name: "Made Up Debt", phone: null, email: null, address: null, notes: null, creditLimit: 0, active: true, openingBalance: 900 })).rejects.toThrow(/Pharmacy Admin/);
    expect(await platformDb.customer.count({ where: { pharmacyId, name: "Made Up Debt" } })).toBe(0);
  });
});
