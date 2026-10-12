"use client";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import React, { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<{ push: (kind: Toast["kind"], text: string) => void }>({ push: () => {} });

export const useToast = () => {
  const { push } = useContext(ToastCtx);
  return { success: (t: string) => push("success", t), error: (t: string) => push("error", t), info: (t: string) => push("info", t) };
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border bg-surface p-3 text-sm shadow-lg", t.kind === "success" && "border-emerald-300", t.kind === "error" && "border-red-300", t.kind === "info" && "border-sky-300")}>
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />}
            {t.kind === "error" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />}
            {t.kind === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
