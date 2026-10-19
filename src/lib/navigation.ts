import { BarChart3, Boxes, Building2, ClipboardList, LayoutDashboard, Monitor, Pill, Receipt, Settings, ShieldCheck, ShoppingCart, Truck, UserCog, Users } from "lucide-react";

/**
 * The menus and their Alt+letter shortcuts. Each key is a letter of the label (it is underlined there);
 * tests/shortcuts.test.ts checks the letters are unique, present and not reserved.
 */
export const STAFF_NAV = [
  { href: "/dashboard", label: "Dashboard", key: "B", icon: LayoutDashboard, perm: "dashboard.view" },
  { href: "/pos", label: "POS / Sales", key: "P", icon: ShoppingCart, perm: "pos.use" },
  { href: "/sales", label: "Invoices", key: "I", icon: Receipt, perm: "sales.view" },
  { href: "/medicines", label: "Medicines", key: "M", icon: Pill, perm: "medicines.view" },
  { href: "/inventory", label: "Inventory", key: "V", icon: Boxes, perm: "inventory.view" },
  { href: "/purchases", label: "Purchases", key: "H", icon: ClipboardList, perm: "purchases.view" },
  { href: "/suppliers", label: "Suppliers", key: "S", icon: Truck, perm: "suppliers.view" },
  { href: "/customers", label: "Customers", key: "C", icon: Users, perm: "customers.view" },
  { href: "/reports", label: "Reports", key: "R", icon: BarChart3, perm: "reports.view" },
  { href: "/users", label: "Users", key: "U", icon: UserCog, perm: "users.manage" },
  { href: "/roles", label: "Roles", key: "O", icon: ShieldCheck, perm: "roles.manage" },
  { href: "/settings", label: "Settings", key: "T", icon: Settings, perm: "settings.manage" },
] as const;

export const CONSOLE_NAV = [
  { href: "/platform", label: "Overview", key: "O", icon: LayoutDashboard, exact: true },
  { href: "/platform/pharmacies", label: "Pharmacies", key: "P", icon: Building2 },
  { href: "/platform/accounts", label: "Accounts", key: "A", icon: Users },
] as const;

/** Shown only inside the desktop app. */
export const CONSOLE_DESKTOP_NAV = { href: "/platform/desktop", label: "This computer", key: "T", icon: Monitor } as const;

export type NavItem = { href: string; label: string; key: string };
