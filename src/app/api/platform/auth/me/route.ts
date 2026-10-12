import { platformRoute } from "../../_lib/platform-route";

/** Where the Developer is in sign-in: "enrol" (set up 2FA), "verify" (enter code) or "done". */
export const GET = platformRoute(async ({ dev }) => ({
  dev: { id: dev.id, name: dev.name, email: dev.email },
  step: dev.mfa ? "done" : dev.totpEnabled ? "verify" : "enrol",
}), { allowWithoutMfa: true });

export const dynamic = "force-dynamic";
