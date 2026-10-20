import type { MetadataRoute } from "next";

/** Installable staff app (roadmap 9.5): counter tablets and pharmacists' phones add it to the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pharmacy CRM",
    short_name: "Pharmacy",
    description: "Sales, stock, bills and reports for your pharmacy",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1f7f78",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Counter", url: "/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Photo of a bill", url: "/stock-entry/upload", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
