"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/components/ui";
import { api } from "@/lib/client";

const NAV = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/platform/pharmacies", label: "Pharmacies", icon: Building2 },
  { href: "/platform/accounts", label: "Accounts", icon: Users },
];

/** Developer console frame: dark header so it is never mistaken for a pharmacy's own app. */
export function ConsoleShell({ dev, children }: { dev: { name: string; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/platform/auth/logout", { body: {} }).catch(() => {});
    router.replace("/platform/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-slate-900 text-slate-100">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <span className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand-300" aria-hidden /> Developer console</span>
          <nav aria-label="Console" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((n) => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                  className={cn("flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", active ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800")}>
                  <n.icon className="h-4 w-4" aria-hidden /> {n.label}
                </Link>
              );
            })}
          </nav>
          <span className="hidden text-right text-xs sm:block"><span className="block font-medium text-slate-100">{dev.name}</span><span className="text-slate-400">{dev.email}</span></span>
          <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800" aria-label="Sign out">
            <LogOut className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
