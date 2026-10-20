import { BarChart3, Boxes, PackagePlus, Building2, ClipboardList, History, LayoutDashboard, Monitor, Palette, Pill, Receipt, Settings, ShieldCheck, ShoppingBasket, ShoppingCart, Truck, Undo2, UserCog, Users, Wallet } from "lucide-react";

/**
 * The menus and their Alt+letter shortcuts. Each key is a letter of the label (it is underlined there);
 * tests/shortcuts.test.ts checks the letters are unique, present and not reserved.
 */
/** Sidebar groups (task 3.11); entries without a group sit on top. */
export const NAV_GROUPS = ["Sell", "Stock", "Buy", "People", "Money", "Admin"] as const;

export const STAFF_NAV = [
  { href: "/dashboard", label: "Dashboard", key: "B", icon: LayoutDashboard, perm: "dashboard.view", group: null },
  { href: "/pos", label: "POS / Sales", key: "P", icon: ShoppingCart, perm: "pos.use", group: "Sell" },
  { href: "/sales", label: "Invoices", key: "I", icon: Receipt, perm: "sales.view", group: "Sell" },
  { href: "/returns", label: "Sales returns", key: "L", icon: Undo2, perm: "sales.view", group: "Sell" },
  { href: "/cash", label: "Cash drawer", key: "W", icon: Wallet, perm: "pos.use", group: "Sell" },
  { href: "/medicines", label: "Medicines", key: "M", icon: Pill, perm: "medicines.view", group: "Stock" },
  { href: "/inventory", label: "Inventory", key: "V", icon: Boxes, perm: "inventory.view", group: "Stock" },
  { href: "/stock-entry", label: "Stock entry", key: "K", icon: PackagePlus, perm: "stockEntry.create", group: "Stock" },
  { href: "/orders", label: "Supply orders", key: "Y", icon: ShoppingBasket, perm: "purchases.view", group: "Buy" },
  { href: "/purchases", label: "Purchases", key: "H", icon: ClipboardList, perm: "purchases.view", group: "Buy" },
  { href: "/suppliers", label: "Suppliers", key: "S", icon: Truck, perm: "suppliers.view", group: "Buy" },
  { href: "/customers", label: "Customers", key: "C", icon: Users, perm: "customers.view", group: "People" },
  { href: "/reports", label: "Reports", key: "R", icon: BarChart3, perm: "reports.view", group: "Money" },
  { href: "/users", label: "Users", key: "U", icon: UserCog, perm: "users.manage", group: "Admin" },
  { href: "/roles", label: "Roles", key: "O", icon: ShieldCheck, perm: "roles.manage", group: "Admin" },
  { href: "/branding", label: "Profile & branding", key: "G", icon: Palette, perm: "branding.manage", group: "Admin" },
  { href: "/activity", label: "Activity", key: "A", icon: History, perm: "audit.view", group: "Admin" },
  { href: "/settings", label: "Settings", key: "T", icon: Settings, perm: "settings.manage", group: "Admin" },
] as const;

export const CONSOLE_NAV = [
  { href: "/platform", label: "Overview", key: "O", icon: LayoutDashboard, exact: true },
  { href: "/platform/pharmacies", label: "Pharmacies", key: "P", icon: Building2 },
  { href: "/platform/accounts", label: "Accounts", key: "A", icon: Users },
] as const;

/** Shown only inside the desktop app. */
export const CONSOLE_DESKTOP_NAV = { href: "/platform/desktop", label: "This computer", key: "T", icon: Monitor } as const;

export type NavItem = { href: string; label: string; key: string };
