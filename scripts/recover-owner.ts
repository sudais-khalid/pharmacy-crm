/**
 * Recovers the Developer account when its password or authenticator is lost. Needs shell access to the
 * server, which is the point: nobody with only a browser can take the account over.
 *
 *   npm run platform:recover-owner -- --email you@example.com [--password 'new password']
 *
 * Without --password a strong one is generated and printed once. Two-factor sign-in is removed and must
 * be set up again at the next sign-in; every existing Developer session ends.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = get("--email");
  if (!email) {
    console.error("Usage: npm run platform:recover-owner -- --email you@example.com [--password 'new password']");
    process.exit(2);
  }
  const { recoverPlatformOwner } = await import("../src/modules/identity/platform-auth");
  const r = await recoverPlatformOwner(email, get("--password"));
  console.log(`Developer account ${r.email} recovered.`);
  if (!get("--password")) console.log(`New password (shown once): ${r.password}`);
  console.log("Sign in at /platform/login and set up two-factor sign-in again.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
