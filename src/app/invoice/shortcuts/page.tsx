"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { STAFF_NAV, navVisible } from "@/lib/navigation";
import { ANYWHERE_KEYS, POS_KEYS, STOCK_ENTRY_KEYS, type KeyHelp } from "@/lib/shortcut-cards";

/** A printable keyboard card for the counter and stock entry (roadmap 9.10): one A4 page, cut in two. */
export default function ShortcutCard() {
  const { settings, permissions } = useApp();
  const menu = STAFF_NAV.filter((n) => navVisible(n, permissions, settings));
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-6 text-black print:p-0">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-sm">Print this page, cut it along the dotted line, and keep one half at the counter and one by the stock entry computer.</p>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
      </div>
      <Card title="At the counter" shop={settings.pharmacyName} groups={[["Selling", POS_KEYS], ["Anywhere", ANYWHERE_KEYS]]} />
      <div className="my-5 border-t-2 border-dashed border-slate-400" aria-hidden />
      <Card title="Stock entry and menus" shop={settings.pharmacyName} groups={[["Stock entry grid", STOCK_ENTRY_KEYS], ["Open a screen", menu.map((n) => ({ keys: `Alt+${n.key}`, label: n.label }))]]} />
    </div>
  );
}

function Card({ title, shop, groups }: { title: string; shop: string; groups: [string, KeyHelp[]][] }) {
  return (
    <section className="break-inside-avoid rounded-lg border-2 border-black p-4">
      <div className="mb-3 flex items-baseline justify-between border-b border-black pb-2">
        <h1 className="text-lg font-bold">Keyboard: {title}</h1>
        <span className="text-xs">{shop}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {groups.map(([name, keys]) => (
          <div key={name}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide">{name}</h2>
            <table className="w-full text-[13px]">
              <tbody>{keys.map((k) => (
                <tr key={k.keys + k.label} className="align-top">
                  <td className="whitespace-nowrap py-0.5 pr-3"><kbd className="rounded border border-black px-1 font-mono text-[12px]">{k.keys}</kbd></td>
                  <td className="py-0.5">{k.label}</td>
                </tr>))}</tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
