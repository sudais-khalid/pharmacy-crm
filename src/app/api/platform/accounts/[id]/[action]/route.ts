import { z } from "zod";
import { readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { forceLogoutAccount, issueAccountReset, setAccountActive, unlockAccount } from "@/modules/tenancy";
import { platformRoute } from "../../../_lib/platform-route";

const activeSchema = z.object({ active: z.boolean() });

/** Account actions: active, logout, reset, unlock. */
export const POST = platformRoute(async ({ req, params, dev, meta }) => {
  const c = { devId: dev.id, meta };
  switch (params.action) {
    case "active":
      return setAccountActive(c, params.id, activeSchema.parse(await readJson(req)).active);
    case "logout":
      return forceLogoutAccount(c, params.id);
    case "reset":
      return issueAccountReset(c, params.id);
    case "unlock":
      return unlockAccount(c, params.id);
    default:
      throw new AppError(404, "Unknown action.");
  }
});

export const dynamic = "force-dynamic";
