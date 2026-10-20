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
  // File tracing misses Prisma's WebAssembly query compiler (loaded at run time), so include it explicitly.
  outputFileTracingIncludes: { "/**": ["./node_modules/.prisma/client/*.wasm"] },
};
export default nextConfig;
