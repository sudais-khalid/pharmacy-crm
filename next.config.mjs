import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // the version health reports when no APP_VERSION is set (a Docker server starts node directly, not npm)
  env: { APP_BUILD_VERSION: version },
  // The desktop build runs a self-contained server (.next/standalone/server.js) inside Electron.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // Browser protections on every response, on servers and on the desktop alike: no framing by other sites
  // (receipts print through a frame of the app's own pages), no type sniffing, no referrer to other sites,
  // and no microphone, location or payment features (the camera is used for bill photos).
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
      ],
    }];
  },
  // File tracing misses Prisma's WebAssembly query compiler (loaded at run time), so include it explicitly.
  outputFileTracingIncludes: { "/**": ["./node_modules/.prisma/client/*.wasm"] },
};
export default nextConfig;
