"use client";
import { createContext, useContext } from "react";

export type Settings = {
  pharmacyName: string; legalName: string; address: string; city: string; phone: string; whatsapp: string; email: string; licenseNumber: string; taxNumber: string;
  receiptHeader: string; invoiceFooter: string; brandColor: string | null; logoFileId: string | null; logoIconFileId: string | null; expiryWarningDays: number; currency: string;
  receiptFormat: "THERMAL_80" | "THERMAL_58" | "A4"; autoPrintReceipt: boolean; receiptBatchLines: boolean; requireCashSession: boolean; cashDiffThreshold: number; cashSessionsOn: boolean; returnsOn: boolean; expensesOn: boolean; setupDone: boolean;
};
export type AppCtx = { user: { id: string; name: string; email: string; role: { id: string; key: string; name: string } }; permissions: string[]; settings: Settings; pharmacyStatus?: string; subscription?: { endsAt: string; suspendsOn: string } | null; support?: { devName: string; reason: string } };

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

/** For pages outside the app shell (printed invoices) that still need the viewer's permissions and settings. */
export function AppProvider({ ctx, children }: { ctx: AppCtx; children: React.ReactNode }) {
  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>;
}
