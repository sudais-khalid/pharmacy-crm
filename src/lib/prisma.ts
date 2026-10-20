import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Restricted role the tenant client runs as (created by the row_level_security migration). */
export const APP_DB_ROLE = "pcrm_app";

/**
 * Tenant client: the default for all business code. It connects as the restricted pcrm_app role, so
 * PostgreSQL row-level security applies and only rows of the pharmacy set by tenantTransaction() are
 * visible. Outside a tenant transaction it sees no business rows at all.
 *
 * With APP_DATABASE_URL (a dedicated login role that is a member of pcrm_app) the role cannot be changed
 * from the connection at all; otherwise the owner URL is used with the role set at connection start.
 */
/**
 * Connections the tenant client may hold. Every sale or stock entry keeps one for its whole transaction, so
 * the pg default of 10 made the eleventh counter wait (roadmap 9.8). DB_POOL_MAX raises or lowers it.
 */
export const POOL_MAX = Math.max(2, Number(process.env.DB_POOL_MAX) || 20);

function create() {
  const dedicated = process.env.APP_DATABASE_URL;
  const adapter = new PrismaPg(
    dedicated ? { connectionString: dedicated, max: POOL_MAX } : { connectionString: process.env.DATABASE_URL, options: `-c role=${APP_DB_ROLE}`, max: POOL_MAX },
  );
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
