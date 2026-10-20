"use client";
import { useEffect } from "react";

/**
 * Registers the service worker of the installable staff app (roadmap 9.5): production builds on a secure
 * origin only, and never inside the desktop app (it is a window of its own, often on plain http).
 */
export function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (/Electron/i.test(navigator.userAgent)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // the app works the same without it
    });
  }, []);
}
