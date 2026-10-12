import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPlatform = globalThis as unknown as { platformDb?: PrismaClient };

/**
 * Platform client: connects as the owning role, which row-level security does not restrict. It sees every
 * pharmacy. Only code that genuinely works across pharmacies may import it (Developer console, login and
 * session lookups before a tenant is known, the worker, health, maintenance); dependency-cruiser enforces
 * the list. Everything else uses the tenant client in ./prisma.
 */
export const platformDb =
  globalForPlatform.platformDb ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
if (process.env.NODE_ENV !== "production") globalForPlatform.platformDb = platformDb;
