import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/origin";
import { isLimited, recordHit, clearBucket, purgeRateLimitHits } from "@/lib/rate-limit";
import { resetDb } from "./helpers";

const req = (method: string, headers: Record<string, string>) =>
  new NextRequest("http://shop.local:3000/api/sales", { method, headers: { host: "shop.local:3000", ...headers } });

describe("same-origin check", () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it("allows safe methods from anywhere", () => {
    expect(() => assertSameOrigin(req("GET", { origin: "https://evil.example" }))).not.toThrow();
  });

  it("allows writes from the same origin", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "http://shop.local:3000" }))).not.toThrow();
  });

  it("blocks writes from another origin", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example" }))).toThrow(/Cross-site/);
    expect(() => assertSameOrigin(req("DELETE", { origin: "http://shop.local:4000" }))).toThrow(/Cross-site/);
    expect(() => assertSameOrigin(req("PUT", { origin: "null" }))).toThrow(/Cross-site/);
  });

  it("blocks cross-site fetch metadata when Origin is missing, allows non-browser clients", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "cross-site" }))).toThrow(/Cross-site/);
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", {}))).not.toThrow();
  });

  it("honours extra allowed origins (desktop client mode, LAN address)", () => {
    process.env.ALLOWED_ORIGINS = "http://192.168.1.20:3000, app://pharmacy";
    expect(() => assertSameOrigin(req("POST", { origin: "http://192.168.1.20:3000" }))).not.toThrow();
  });
});

describe("rate limiter", () => {
  beforeEach(resetDb);

  it("limits after max hits inside the window and resets when cleared", async () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) await recordHit("login:test", now);
    expect(await isLimited("login:test", 3, 60_000, now)).toBe(true);
    expect(await isLimited("login:other", 3, 60_000, now)).toBe(false);
    await clearBucket("login:test");
    expect(await isLimited("login:test", 3, 60_000, now)).toBe(false);
  });

  it("forgets hits outside the window and purges old rows", async () => {
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    for (let i = 0; i < 5; i++) await recordHit("login:test", old);
    expect(await isLimited("login:test", 3, 60 * 60 * 1000)).toBe(false);
    expect(await purgeRateLimitHits(60 * 60 * 1000)).toBe(5);
  });
});

describe("client IP", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("ignores X-Forwarded-For unless a trusted proxy is configured", async () => {
    const { clientIp } = await import("@/lib/request");
    const r = req("POST", { "x-forwarded-for": "6.6.6.6, 10.0.0.5" });
    expect(clientIp(r)).toBeNull();
    process.env.TRUST_PROXY = "1";
    expect(clientIp(r)).toBe("10.0.0.5"); // the address the proxy itself appended
  });
});
