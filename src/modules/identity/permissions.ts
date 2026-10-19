/**
 * The tenant permission catalog and the three role templates (docs/plan/02-architecture.md, sections 5.4
 * and 5.5). Roles are data: every user has a role row, either one of the templates (shared by all
 * pharmacies, read-only) or a custom role of their own pharmacy. A template's permissions always come
 * from this file, so adding a permission here reaches every pharmacy without a data change.
 *
 * Some permissions belong to screens of later phases (cash sessions, stock entry, purchase orders,
 * supplier catalogs, finance); they are in the catalog now so custom roles can be set up once.
 */
export const PERMISSION_GROUPS = ["General", "Sell", "Stock", "Buy", "People", "Money", "Admin"] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSION_CATALOG = [
  { key: "dashboard.view", group: "General", label: "See the dashboard" },
  { key: "pos.use", group: "Sell", label: "Sell at the counter (POS)" },
  { key: "sales.view", group: "Sell", label: "See invoices" },
  { key: "sales.reprint.any", group: "Sell", label: "Reprint anyone's invoices" },
  { key: "sales.cancel", group: "Sell", label: "Cancel invoices" },
  { key: "sales.overrideCredit", group: "Sell", label: "Sell on credit above a customer's limit" },
  { key: "cash.manage", group: "Sell", label: "Manage every cashier's cash session" },
  { key: "medicines.view", group: "Stock", label: "See medicines" },
  { key: "medicines.manage", group: "Stock", label: "Add and edit medicines and prices" },
  { key: "medicines.delete", group: "Stock", label: "Archive medicines" },
  { key: "inventory.view", group: "Stock", label: "See stock, batches and expiry" },
  { key: "inventory.adjust", group: "Stock", label: "Adjust stock (damage, expiry, corrections)" },
  { key: "stockEntry.create", group: "Stock", label: "Enter stock and upload bill photos" },
  { key: "stockEntry.post", group: "Stock", label: "Review and post stock entries" },
  { key: "suppliers.view", group: "Buy", label: "See suppliers" },
  { key: "suppliers.manage", group: "Buy", label: "Add and edit suppliers, record payments" },
  { key: "supplierCatalog.manage", group: "Buy", label: "Add medicines to supplier catalogs" },
  { key: "purchases.view", group: "Buy", label: "See purchases" },
  { key: "purchases.create", group: "Buy", label: "Record purchases" },
  { key: "po.approve", group: "Buy", label: "Approve supplier orders" },
  { key: "customers.view", group: "People", label: "See customers" },
  { key: "customers.manage", group: "People", label: "Add and edit customers" },
  { key: "customers.payments", group: "People", label: "Receive customer payments" },
  { key: "cost.view", group: "Money", label: "See cost prices and profit" },
  { key: "reports.view", group: "Money", label: "See reports" },
  { key: "finance.view", group: "Money", label: "See expenses and net profit" },
  { key: "users.manage", group: "Admin", label: "Manage staff accounts" },
  { key: "roles.manage", group: "Admin", label: "Create and edit roles" },
  { key: "branding.manage", group: "Admin", label: "Edit the pharmacy profile and branding" },
  { key: "settings.manage", group: "Admin", label: "Change settings" },
  { key: "audit.view", group: "Admin", label: "See the activity history" },
] as const satisfies readonly { key: string; group: PermissionGroup; label: string }[];

export type Permission = (typeof PERMISSION_CATALOG)[number]["key"];
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_CATALOG.map((p) => p.key);
const KNOWN = new Set<string>(ALL_PERMISSIONS);
export const isPermission = (p: string): p is Permission => KNOWN.has(p);

const cashier: Permission[] = ["dashboard.view", "pos.use", "sales.view", "medicines.view", "inventory.view", "customers.view", "customers.manage", "customers.payments"];
const pharmacist: Permission[] = [
  ...cashier,
  "sales.reprint.any", "sales.cancel", "sales.overrideCredit",
  "medicines.manage", "inventory.adjust", "stockEntry.create", "stockEntry.post",
  "suppliers.view", "supplierCatalog.manage", "purchases.view", "purchases.create", "po.approve",
  "cost.view", "reports.view",
];

export type SystemRoleKey = "PHARMACY_ADMIN" | "PHARMACIST" | "CASHIER";

/** The templates. Their ids are fixed so migrations and code agree on them. */
export const SYSTEM_ROLES: Record<SystemRoleKey, { id: string; name: string; description: string; permissions: readonly Permission[]; landingPath: string }> = {
  PHARMACY_ADMIN: {
    id: "00000000-0000-4000-a000-000000000001",
    name: "Pharmacy Admin",
    description: "Everything in the pharmacy: staff, roles, branding, prices, reports and settings.",
    permissions: ALL_PERMISSIONS,
    landingPath: "/dashboard",
  },
  PHARMACIST: {
    id: "00000000-0000-4000-a000-000000000002",
    name: "Pharmacist",
    description: "Medicines, stock and expiry, purchases and suppliers, cancellations and the counter.",
    permissions: pharmacist,
    landingPath: "/dashboard",
  },
  CASHIER: {
    id: "00000000-0000-4000-a000-000000000003",
    name: "Cashier",
    description: "The counter: sales, receipts and customers. No cost prices or profit.",
    permissions: cashier,
    landingPath: "/pos",
  },
};
export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];
export const ADMIN_ROLE_ID = SYSTEM_ROLES.PHARMACY_ADMIN.id;

/** A role's permissions: a template's from this file, a custom role's as stored (unknown values dropped). */
export function rolePermissions(role: { key: string; system: boolean; permissions: readonly string[] }): Permission[] {
  if (role.system && role.key in SYSTEM_ROLES) return [...SYSTEM_ROLES[role.key as SystemRoleKey].permissions];
  return role.permissions.filter(isPermission);
}

/** Anyone or anything that carries a permission list: a session user, a service actor. */
export type PermissionHolder = { permissions: readonly string[] };

export function can(holder: PermissionHolder, permission: Permission): boolean {
  return holder.permissions.includes(permission);
}

/** Permissions in `wanted` that `holder` does not have (the no-escalation rule). */
export function missingPermissions(holder: PermissionHolder, wanted: readonly string[]): string[] {
  return wanted.filter((p) => !holder.permissions.includes(p));
}

/** Screens a role can land on after sign-in, with the permission each needs. */
export const LANDING_PATHS: { path: string; label: string; permission: Permission }[] = [
  { path: "/dashboard", label: "Dashboard", permission: "dashboard.view" },
  { path: "/pos", label: "POS / Sales", permission: "pos.use" },
  { path: "/sales", label: "Invoices", permission: "sales.view" },
  { path: "/medicines", label: "Medicines", permission: "medicines.view" },
  { path: "/inventory", label: "Inventory", permission: "inventory.view" },
  { path: "/purchases", label: "Purchases", permission: "purchases.view" },
  { path: "/reports", label: "Reports", permission: "reports.view" },
];

/** Where a user goes after signing in: the role's landing screen if they may open it, else the first they may. */
export function landingFor(role: { landingPath: string }, permissions: readonly string[]): string {
  const allowed = LANDING_PATHS.filter((l) => permissions.includes(l.permission));
  return allowed.find((l) => l.path === role.landingPath)?.path ?? allowed[0]?.path ?? "/no-access";
}
