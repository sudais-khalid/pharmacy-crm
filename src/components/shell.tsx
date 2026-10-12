"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { BarChart3, Boxes, ClipboardList, LayoutDashboard, LogOut, Menu, Moon, Pill, Receipt, Settings, ShoppingCart, Sun, Truck, UserCog, Users, X } from "lucide-react";
import { AppContext, type AppCtx } from "./app-context";
import { cn } from "./ui";
import { api } from "@/lib/client";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { href: "/pos", label: "POS / Sales", icon: ShoppingCart, perm: "pos.use" },
  { href: "/sales", label: "Invoices", icon: Receipt, perm: "sales.view" },
  { href: "/medicines", label: "Medicines", icon: Pill, perm: "medicines.view" },
  { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory.view" },
  { href: "/purchases", label: "Purchases", icon: ClipboardList, perm: "purchases.view" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, perm: "suppliers.view" },
  { href: "/customers", label: "Customers", icon: Users, perm: "customers.view" },
  { href: "/reports", label: "Reports", icon: BarChart3, perm: "reports.view" },
  { href: "/users", label: "Users", icon: UserCog, perm: "users.manage" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "settings.manage" },
];

export function Shell({ ctx, children }: { ctx: AppCtx; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);

  const items = NAV.filter((n) => ctx.permissions.includes(n.perm));

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  async function endSupport() {
    const r = await api<{ redirect: string }>("/api/platform/support/end", { body: {} }).catch(() => ({ redirect: "/platform/pharmacies" }));
    window.location.href = r.redirect;
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            <n.icon className="h-[18px] w-[18px]" aria-hidden /> {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <AppContext.Provider value={ctx}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><Pill className="h-4 w-4" aria-hidden /></span>
          <span className="truncate font-semibold">{ctx.settings.pharmacyName}</span>
        </div>
        {nav}
      </div>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white dark:bg-slate-900">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
              <span className="font-semibold">{ctx.settings.pharmacyName}</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            {nav}
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="hidden text-sm text-slate-500 lg:block">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {mounted && resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{ctx.user.name}</p>
              <p className="text-xs capitalize text-slate-500">{ctx.user.role.toLowerCase()}</p>
            </div>
            <button onClick={ctx.support ? endSupport : logout} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              <LogOut className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{ctx.support ? "End support" : "Logout"}</span>
            </button>
          </div>
        </header>
        {ctx.support && (
          <div role="status" className="no-print sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 border-b border-amber-400 bg-amber-300 px-4 py-2 text-sm font-medium text-amber-950">
            <span>Platform support session for {ctx.settings.pharmacyName} by {ctx.support.devName}. All actions are logged.</span>
            <button onClick={endSupport} className="rounded-md bg-amber-950 px-2.5 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900">End session</button>
          </div>
        )}
        {ctx.pharmacyStatus === "GRACE" && (
          <div role="status" className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            The subscription for this pharmacy has ended. Everything keeps working for now; please contact your software provider to renew.
          </div>
        )}
        <main id="main" className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </AppContext.Provider>
  );
}
