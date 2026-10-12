/**
 * The Developer account cannot be created, changed, demoted or removed through the application
 * (docs/plan/02-architecture.md, section 5.4). Only identity/platform-auth.ts may write PlatformUser
 * (first-boot bootstrap, the owner's own sign-in data, server-shell recovery), and no API route may
 * reach the recovery function.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(root, f).split(sep).join("/");
const source = files(join(root, "src"));
const WRITE = /platformUser\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;

describe("Developer account protection", () => {
  it("only identity/platform-auth.ts writes PlatformUser", () => {
    const writers = source.filter((f) => WRITE.test(readFileSync(f, "utf8"))).map(rel);
    expect(writers).toEqual(["src/modules/identity/platform-auth.ts"]);
  });

  it("no API route can recover, create or remove a Developer account", () => {
    const routes = source.filter((f) => rel(f).startsWith("src/app/api/") && f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(30);
    for (const f of routes) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toMatch(/recoverPlatformOwner|ensurePlatformOwner|platformUser\./);
    }
  });

  it("the platform-auth writes are limited to bootstrap, own sign-in data and recovery", () => {
    const text = readFileSync(join(root, "src/modules/identity/platform-auth.ts"), "utf8");
    const creates = text.match(/platformUser\.create\(/g) ?? [];
    expect(creates).toHaveLength(1); // first-boot bootstrap, guarded by an empty-table check
    expect(text).toMatch(/if \(\(await platformDb\.platformUser\.count\(\)\) > 0\) return "exists";/);
    expect(text).not.toMatch(/platformUser\.delete/);
  });
});
