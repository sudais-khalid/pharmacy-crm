import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { sans, mono } from "./fonts";

export const metadata: Metadata = { title: "Pharmacy CRM", description: "Pharmacy management system" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
