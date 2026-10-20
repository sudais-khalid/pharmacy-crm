import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { sans, mono } from "./fonts";

export const metadata: Metadata = {
  title: "Pharmacy CRM",
  description: "Pharmacy management system",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Pharmacy", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#1f7f78" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
