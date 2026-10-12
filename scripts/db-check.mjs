// Fails when prisma/migrations and prisma/schema.prisma disagree. Needs an empty shadow database.
// Cross-platform replacement for an inline "$SHADOW_DATABASE_URL" (cmd.exe does not expand it).
import { spawnSync } from "node:child_process";

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("Set SHADOW_DATABASE_URL to an empty database the check may reset.");
  process.exit(2);
}
const args = ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", shadow, "--exit-code"];
const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
if (r.status === 2) console.error("Migrations do not match schema.prisma. Create a migration with `npx prisma migrate dev`.");
process.exit(r.status ?? 1);
