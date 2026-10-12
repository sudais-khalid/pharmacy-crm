"use client";
import { createContext, useContext } from "react";

export type Settings = { pharmacyName: string; address: string; phone: string; email: string; invoiceFooter: string; expiryWarningDays: number; currency: string };
export type AppCtx = { user: { id: string; name: string; email: string; role: string }; permissions: string[]; settings: Settings };

export const AppContext = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(AppContext);
  if (!c) throw new Error("AppContext missing");
  return c;
};
export const useCan = (perm: string) => useApp().permissions.includes(perm);
export const useMoney = () => {
  const { settings } = useApp();
  return (v: unknown) => `${settings.currency} ${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
