import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { fileResponse, readFile } from "@/lib/files";

/** A stored file of the signed-in pharmacy; row-level security hides every other pharmacy's files. */
export const GET = route(null, async ({ params, db }) => {
  const file = /^[0-9a-f-]{36}$/i.test(params.id) ? await readFile(db, params.id) : null;
  if (!file) throw new AppError(404, "File not found.");
  return fileResponse(file);
});

export const dynamic = "force-dynamic";
