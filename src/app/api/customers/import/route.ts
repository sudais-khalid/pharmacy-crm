import { route, readJson } from "@/lib/api";
import { customerImportSchema, importCustomers } from "@/modules/customers";

/** Customers with what they already owe, many at once (first-run setup). */
export const POST = route("settings.manage", async ({ req, svc }) => importCustomers(svc, customerImportSchema.parse(await readJson(req)).rows));

export const dynamic = "force-dynamic";
