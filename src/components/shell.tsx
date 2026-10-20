"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { LogOut, Menu, Moon, Pill, Search, Sun, X } from "lucide-react";
import { AppContext, type AppCtx } from "./app-context";
import { MnemonicLabel, ShortcutHelpButton, ShortcutProvider } from "./shortcuts";
import { NotificationBell } from "./notification-bell";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { cn } from "./ui";
import { api, formatDate } from "@/lib/client";
import { useServiceWorker } from "./pwa";
import { NAV_GROUPS, STAFF_NAV, navVisible } from "@/lib/navigation";

export function Shell({ ctx, children }: { ctx: AppCtx; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);

  useServiceWorker();
  const items = STAFF_NAV.filter((n) => navVisible(n, ctx.permissions, ctx.settings));

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  async function endSupport() {
    const r = await api<{ redirect: string }>("/api/platform/support/end", { body: {} }).catch(() => ({ redirect: "/platform/pharmacies" }));
    window.location.href = r.redirect;
  }

  const link = (n: (typeof items)[number]) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} aria-keyshortcuts={`Alt+${n.key}`} title={`Alt+${n.key}`}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            <n.icon className="h-[18px] w-[18px]" aria-hidden /> <MnemonicLabel label={n.label} k={n.key} />
          </Link>
        );
  };
  // grouped by task (Sell, Stock, Buy, People, Money, Admin); a group only shows when it has entries
  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
      <div className="space-y-0.5">{items.filter((n) => !n.group).map(link)}</div>
      {NAV_GROUPS.map((g) => {
        const entries = items.filter((n) => n.group === g);
        if (!entries.length) return null;
        return (
          <div key={g} className="mt-3" role="group" aria-labelledby={`nav-${g}`}>
            <p id={`nav-${g}`} className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{g}</p>
            <div className="space-y-0.5">{entries.map(link)}</div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <AppContext.Provider value={ctx}>
    <ShortcutProvider nav={items} palette>
      <CommandPalette nav={items} />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
          {ctx.settings.logoIconFileId
            ? /* eslint-disable-next-line @next/next/no-img-element -- the pharmacy's own logo from our file route */
              <img src={`/api/files/${ctx.settings.logoIconFileId}`} alt="" className="h-8 w-8 rounded-lg object-contain" />
            : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-on-primary"><Pill className="h-4 w-4" aria-hidden /></span>}
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
          <div className="hidden items-center gap-4 lg:flex">
            <button onClick={openCommandPalette} className="inline-flex w-72 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg-muted hover:bg-muted" aria-keyshortcuts="Control+K">
              <Search className="h-4 w-4" aria-hidden /> <span className="flex-1 text-left">Search or go to</span><kbd className="text-[11px]">Ctrl+K</kbd>
            </button>
            <span className="text-sm text-fg-muted">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
          <div className="flex items-center gap-2">
            {!ctx.support && <NotificationBell className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" />}
            <ShortcutHelpButton className="hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:block" />
            <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {mounted && resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{ctx.support ? ctx.user.name : <Link href="/account/two-factor" className="hover:underline" title="Your sign-in security">{ctx.user.name}</Link>}</p>
              <p className="text-xs text-fg-muted">{ctx.user.role.name}</p>
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
            The subscription for this pharmacy has ended{ctx.subscription ? ` on ${formatDate(ctx.subscription.endsAt)}` : ""}. Everything keeps working{ctx.subscription ? ` until ${formatDate(ctx.subscription.suspendsOn)}` : " for now"}; please contact your software provider to renew. Your records are kept either way.
          </div>
        )}
        <main id="main" className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </ShortcutProvider>
    </AppContext.Provider>
  );
}
