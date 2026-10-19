import { readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { reauthenticateDeveloper } from "@/modules/identity";
import { desktopActionSchema, isDesktopInstall, recordDesktopAction } from "@/modules/platform";
import { platformRoute } from "../../_lib/platform-route";

/**
 * Called by the desktop app's main process with the window's own Developer session, before it backs up,
 * changes the mirror folder or restores. Restore also needs a fresh authenticator code.
 */
export const POST = platformRoute(async ({ req, dev, meta }) => {
  if (!isDesktopInstall()) throw new AppError(404, "Not found.");
  const input = desktopActionSchema.parse(await readJson(req));
  if (input.action === "restore") await reauthenticateDeveloper(dev.id, input.code);
  await recordDesktopAction({ devId: dev.id, meta }, input);
  return { devId: dev.id };
});

export const dynamic = "force-dynamic";
