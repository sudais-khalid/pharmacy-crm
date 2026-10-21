import { logger } from "@/lib/logger";
import { ensurePlatformOwner } from "@/modules/identity";

/** Server start-up tasks for the Node.js runtime. */
export async function bootstrap() {
  try {
    const result = await ensurePlatformOwner();
    if (result === "created") logger.info("Developer account created from PLATFORM_OWNER_EMAIL");
    if (result === "updated") logger.info("Developer password updated from this build");
    if (result === "not-configured") logger.warn("No Developer account yet: set PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD, then restart");
  } catch (err) {
    logger.error({ err }, "Developer account bootstrap failed");
  }
}
