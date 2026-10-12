/**
 * Runs once when the server starts. Creates the Developer account from server configuration on the very
 * first start (PLATFORM_OWNER_EMAIL with PLATFORM_OWNER_PASSWORD or PLATFORM_OWNER_PASSWORD_HASH).
 *
 * The Node-only work lives in instrumentation-node.ts and is imported inside the NEXT_RUNTIME check, which
 * the compiler resolves per runtime, so the database driver never enters the Edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("./instrumentation-node");
    await bootstrap();
  }
}
