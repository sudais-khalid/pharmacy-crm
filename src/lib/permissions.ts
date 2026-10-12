export type Role = "ADMIN" | "PHARMACIST" | "CASHIER";

export const ALL_PERMISSIONS = [
  "dashboard.view",
  "medicines.view",
  "medicines.manage",
  "medicines.delete",
  "inventory.view",
  "inventory.adjust",
  "pos.use",
  "sales.view",
  "sales.cancel",
  "sales.overrideCredit",
  "customers.view",
  "customers.manage",
  "customers.payments",
  "suppliers.view",
  "suppliers.manage",
  "purchases.view",
  "purchases.create",
  "reports.view",
  "users.manage",
  "settings.manage",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const cashier: Permission[] = [
  "dashboard.view",
  "medicines.view",
  "inventory.view",
  "pos.use",
  "sales.view",
  "customers.view",
  "customers.manage",
  "customers.payments",
];

const pharmacist: Permission[] = [
  ...cashier,
  "medicines.manage",
  "inventory.adjust",
  "sales.cancel",
  "sales.overrideCredit",
  "suppliers.view",
  "purchases.view",
  "purchases.create",
  "reports.view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  PHARMACIST: pharmacist,
  CASHIER: cashier,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
