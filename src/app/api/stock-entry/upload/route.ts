import { z } from "zod";
import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { MAX_PAGES, uploadPhotos } from "@/modules/stockentry";

const kindSchema = z.enum(["PURCHASE_BILL", "STOCK_LIST"]);

/** Photos of a supplier bill or stock list ("page" files, in order). Answers at once; reading happens in the worker. */
export const POST = route("stockEntry.create", async ({ req, svc }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError(400, "Send the photos as a form upload.");
  const kind = kindSchema.parse(form.get("kind"));
  const files = form.getAll("page").filter((f): f is File => typeof f !== "string").slice(0, MAX_PAGES + 1);
  return uploadPhotos(svc, { kind, pages: await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))) });
});

export const dynamic = "force-dynamic";
