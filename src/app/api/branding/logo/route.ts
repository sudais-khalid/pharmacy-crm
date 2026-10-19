import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { removeLogo, setLogo } from "@/modules/platform";

/** Two PNGs prepared by the browser: "logo" (up to 512 px) and "icon" (up to 128 px). */
export const POST = route("branding.manage", async ({ req, svc }) => {
  const form = await req.formData().catch(() => null);
  const logo = form?.get("logo");
  const icon = form?.get("icon");
  if (!(logo instanceof Blob) || !(icon instanceof Blob)) throw new AppError(400, "Send the logo and its small version.");
  return setLogo(svc, { logo: Buffer.from(await logo.arrayBuffer()), icon: Buffer.from(await icon.arrayBuffer()) });
});

export const DELETE = route("branding.manage", async ({ svc }) => removeLogo(svc));

export const dynamic = "force-dynamic";
