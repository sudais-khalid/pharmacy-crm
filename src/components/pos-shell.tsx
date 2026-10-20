"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { LayoutDashboard, LogOut, Moon, Pill, Sun, Wallet } from "lucide-react";
import { AppContext, type AppCtx } from "./app-context";
import { ShortcutHelpButton, ShortcutProvider } from "./shortcuts";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { cn } from "./ui";
import { api } from "@/lib/client";
import { useServiceWorker } from "./pwa";
import { STAFF_NAV, navVisible } from "@/lib/navigation";

export type DrawerSummary = { openingFloat: number; cashSales: number; cardSales: number; creditSales: number; salesCount: number; cashRefunds: number; payIns: number; payOuts: number; expectedCash: number };
export type Drawer = { enabled: boolean; required: boolean; session: { id: string; openedAt: string; openingFloat: string; summary: DrawerSummary } | null };
type DrawerCtx = { drawer: Drawer | null; reload: () => Promise<void> };
const DrawerContext = createContext<DrawerCtx>({ drawer: null, reload: async () => {} });
/** The cashier's drawer as the counter shows it; reload() after a sale, a refund or a pay-in. */
export const useDrawer = () => useContext(DrawerContext);

function since(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Full-screen counter (UI plan, section 4.1): one header line, the drawer state, and the page. */
export function PosShell({ ctx, children }: { ctx: AppCtx; children: React.ReactNode }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  useEffect(() => setMounted(true), []);
  const reload = useCallback(async () => {
    setDrawer(await api<Drawer>("/api/cash").catch(() => null));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  useServiceWorker();
  const items = STAFF_NAV.filter((n) => navVisible(n, ctx.permissions, ctx.settings));
  const money = (n: number) => `${ctx.settings.currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const backOffice = items.find((n) => n.href === "/dashboard") ?? items.find((n) => n.href !== "/pos");

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <AppContext.Provider value={ctx}>
      <ShortcutProvider nav={items} palette>
        <CommandPalette nav={items} />
        <DrawerContext.Provider value={{ drawer, reload }}>
          <div className="flex min-h-screen flex-col bg-bg">
            <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
              {ctx.settings.logoIconFileId
                ? /* eslint-disable-next-line @next/next/no-img-element -- the pharmacy's own logo from our file route */
                  <img src={`/api/files/${ctx.settings.logoIconFileId}`} alt="" className="h-8 w-8 rounded-lg object-contain" />
                : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary"><Pill className="h-4 w-4" aria-hidden /></span>}
              <span className="hidden truncate font-semibold md:block">{ctx.settings.pharmacyName}</span>
              {drawer?.enabled && (
                <Link href="/cash" className={cn("ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm", drawer.session ? "bg-success/10 text-success" : "bg-warning/10 text-warning")} title="Cash drawer">
                  <Wallet className="h-4 w-4" aria-hidden />
                  {drawer.session ? <span>Drawer open {since(drawer.session.openedAt)}<span className="hidden sm:inline">, cash {money(drawer.session.summary.expectedCash)}</span></span> : <span>Drawer closed</span>}
                </Link>
              )}
              <nav aria-label="Counter" className="ml-auto hidden items-center gap-1 lg:flex">
                {items.filter((n) => n.group === "Sell" && n.href !== "/pos").map((n) => (
                  <Link key={n.href} href={n.href} aria-keyshortcuts={`Alt+${n.key}`} title={`Alt+${n.key}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted hover:bg-muted">
                    <n.icon className="h-4 w-4" aria-hidden /> {n.label}
                  </Link>
                ))}
                {backOffice && backOffice.group !== "Sell" && (
                  <Link href={backOffice.href} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted hover:bg-muted"><LayoutDashboard className="h-4 w-4" aria-hidden /> Back office</Link>
                )}
              </nav>
              <div className="ml-auto flex items-center gap-1 lg:ml-2">
                {!ctx.support && <NotificationBell className="rounded-lg p-2 text-fg-muted hover:bg-muted" />}
                <ShortcutHelpButton className="hidden rounded-lg p-2 text-fg-muted hover:bg-muted sm:block" />
                <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode" className="rounded-lg p-2 text-fg-muted hover:bg-muted">
                  {mounted && resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </button>
                <div className="hidden text-right leading-tight sm:block">
                  <p className="text-sm font-medium">{ctx.user.name}</p>
                  <p className="text-xs text-fg-muted">{ctx.user.role.name}</p>
                </div>
                {!ctx.support && (
                  <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted hover:bg-muted"><LogOut className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Logout</span></button>
                )}
              </div>
            </header>
            {ctx.support && (
              <div role="status" className="no-print border-b border-amber-400 bg-amber-300 px-4 py-2 text-center text-sm font-medium text-amber-950">
                Platform support session for {ctx.settings.pharmacyName} by {ctx.support.devName}. All actions are logged. <Link href="/dashboard" className="underline">Leave the counter</Link>
              </div>
            )}
            <main id="main" className="flex-1 p-3 sm:p-4">{children}</main>
          </div>
        </DrawerContext.Provider>
      </ShortcutProvider>
    </AppContext.Provider>
  );
}
