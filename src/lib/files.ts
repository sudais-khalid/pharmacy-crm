import { createHash } from "node:crypto";
import type { Tx } from "./prisma";

/**
 * Files kept in the database (StoredFile). Always used inside a tenant transaction, so row-level security
 * decides who can read a file. The same bytes uploaded twice by one pharmacy are stored once.
 */
export type NewFile = { purpose: string; mime: string; data: Buffer; width?: number | null; height?: number | null; uploadedById?: string | null };

export async function storeFile(tx: Tx, file: NewFile) {
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  const same = await tx.storedFile.findFirst({ where: { sha256, purpose: file.purpose, size: file.data.length }, select: { id: true } });
  if (same) return same;
  return tx.storedFile.create({
    data: { purpose: file.purpose, mime: file.mime, size: file.data.length, sha256, width: file.width ?? null, height: file.height ?? null, data: new Uint8Array(file.data), uploadedById: file.uploadedById ?? null },
    select: { id: true },
  });
}

export async function readFile(tx: Tx, id: string) {
  return tx.storedFile.findUnique({ where: { id }, select: { id: true, mime: true, size: true, sha256: true, data: true, purpose: true } });
}

/** An HTTP response for a stored file. Ids are random and files never change, so it can be cached. */
export function fileResponse(file: { mime: string; data: Uint8Array; sha256: string }, opts: { cache?: "private" | "public" } = {}) {
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mime,
      "cache-control": `${opts.cache ?? "private"}, max-age=31536000, immutable`,
      etag: `"${file.sha256}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
