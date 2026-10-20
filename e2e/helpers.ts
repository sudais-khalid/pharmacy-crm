import { expect, type Page } from "@playwright/test";
import { base32Decode, codeAt, timeStep } from "../src/lib/totp";

export const OWNER = { email: process.env.PLATFORM_OWNER_EMAIL ?? "owner@e2e.example", password: process.env.PLATFORM_OWNER_PASSWORD ?? "e2e-owner-password-12345" };

/** Authenticator codes for the Developer: each one later than the last, as the server refuses a code twice. */
export class Authenticator {
  private last = 0;
  constructor(private secret = "") {}
  set(secret: string) { this.secret = secret.replace(/\s/g, ""); }
  async code() {
    let step = Math.max(this.last + 1, timeStep());
    // the server takes codes up to one step ahead
    while (step > timeStep() + 1) await new Promise((r) => setTimeout(r, 1000));
    this.last = step;
    return codeAt(base32Decode(this.secret), step);
  }
}

/** Shared between the journeys, which build on each other. */
export const state: {
  slug: string; adminUser: string; adminPassword: string; invitePath: string;
  cashierUser: string; cashierPassword: string; invoice: string; supplier: string;
} = {
  slug: "e2e-care", adminUser: "amina", adminPassword: "Admin-e2e-pass-1", invitePath: "",
  cashierUser: "kashif", cashierPassword: "Cashier-e2e-pass-1", invoice: "", supplier: "Indus Distributors",
};

export async function staffSignIn(page: Page, username: string, password: string) {
  await page.goto(`/p/${state.slug}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
