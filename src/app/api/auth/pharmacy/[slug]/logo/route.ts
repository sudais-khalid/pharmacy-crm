import { platformDb } from "@/lib/platform-db";
import { fileResponse } from "@/lib/files";

/** Public: a pharmacy's logo for its sign-in page (?size=icon for the small one). Nothing else is served. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const small = new URL(req.url).searchParams.get("size") === "icon";
  const p = await platformDb.pharmacy.findUnique({ where: { slug: (await params).slug.toLowerCase() }, select: { status: true, logo: small ? false : { select: { mime: true, data: true, sha256: true } }, logoIcon: small ? { select: { mime: true, data: true, sha256: true } } : false } });
  const file = small ? p?.logoIcon : p?.logo;
  if (!p || p.status === "DEACTIVATED" || !file) return new Response("Not found", { status: 404 });
  return fileResponse(file, { cache: "public" });
}

export const dynamic = "force-dynamic";
