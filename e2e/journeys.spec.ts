import { test, expect, type Browser, type Page } from "@playwright/test";
import { Authenticator, OWNER, state, staffSignIn, toast } from "./helpers";
import { testPng } from "../tests/png";

/**
 * The end-to-end journeys of roadmap 9.6, in the order a real pharmacy lives them: the Developer creates it,
 * its admin accepts the invite and sets it up, stock comes in by photo and by a typed supplier bill, a
 * cashier sells and prints, a sale is returned, the drawer is closed, and a supply order is received.
 */
test.describe.configure({ mode: "serial" });

const auth = new Authenticator();
let dev: Page;
let admin: Page;
const fresh = async (browser: Browser) => (await browser.newContext()).newPage();

test("the Developer signs in with two-factor and creates a pharmacy with an invite", async ({ browser }) => {
  dev = await fresh(browser);
  await dev.goto("/platform/login");
  await dev.getByLabel("Email").fill(OWNER.email);
  await dev.getByLabel("Password").fill(OWNER.password);
  await dev.getByRole("button", { name: "Continue" }).click();
  // first sign-in: set up the authenticator from the key shown under the QR code
  const key = dev.locator("span.font-mono").first();
  await expect(key).toBeVisible();
  auth.set((await key.textContent()) ?? "");
  await dev.getByLabel("Code from the app").fill(await auth.code());
  await dev.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
  await dev.getByRole("button", { name: "I have saved them, continue" }).click();
  await expect(dev).toHaveURL(/\/platform$/);

  await dev.goto("/platform/pharmacies/new");
  await dev.getByLabel("Name *", { exact: true }).first().fill("E2E Care Pharmacy");
  await dev.getByLabel("URL name *").fill(state.slug);
  await dev.getByLabel("Phone", { exact: true }).fill("051-5550100");
  for (const feature of ["Cash drawer sessions", "Customer and supplier returns", "Purchase orders to suppliers", "OCR stock entry from photos", "Expenses and net profit"]) {
    await dev.getByLabel(feature).check();
  }
  await dev.getByLabel("Name *", { exact: true }).nth(1).fill("Amina Siddiqui");
  await dev.getByLabel("Username *").fill(state.adminUser);
  await dev.getByLabel("Email *").fill("amina@e2e-care.example");
  await dev.getByRole("button", { name: "Create pharmacy" }).click();
  const link = dev.locator("dd.font-mono.text-base");
  await expect(link).toContainText("/invite/");
  state.invitePath = new URL((await link.textContent())!.trim()).pathname;
});

test("the admin accepts the invite, signs in and sets the profile", async ({ browser }) => {
  admin = await fresh(browser);
  await admin.goto(state.invitePath);
  await admin.getByLabel("New password").fill(state.adminPassword);
  await admin.getByLabel("Repeat the password").fill(state.adminPassword);
  await admin.getByRole("button", { name: "Save password" }).click();
  await admin.getByRole("link", { name: "Go to sign in" }).click();
  await staffSignIn(admin, state.adminUser, state.adminPassword);
  await expect(admin.getByText("Finish setting up your pharmacy")).toBeVisible();

  await admin.goto("/branding");
  await admin.getByLabel("Address").fill("Shop 4, Jinnah Road, Rawalpindi");
  await admin.getByLabel("Footer line").fill("Thank you. Get well soon.");
  await admin.getByRole("button", { name: "Save profile" }).click();
  await toast(admin, /saved/i);
  await admin.goto("/setup");
  await expect(admin.getByRole("heading", { name: /1\. Profile and logo/ })).toContainText("(done)");
});

test("opening stock comes in from a photo of the stock list, read and then checked", async () => {
  for (const m of [{ name: "Panadol 500mg Tablet", genericName: "Paracetamol", salePrice: 30, purchasePrice: 22 }, { name: "Brufen 400mg Tablet", genericName: "Ibuprofen", salePrice: 45, purchasePrice: 34 }]) {
    expect((await admin.request.post("/api/medicines", { data: m })).ok()).toBeTruthy();
  }
  await admin.goto("/stock-entry/upload?kind=STOCK_LIST");
  await admin.locator("input[type=file][multiple]").setInputFiles({ name: "stock-list.png", mimeType: "image/png", buffer: testPng(900, "stock list") });
  await admin.getByRole("button", { name: /Upload 1 page/ }).click();
  await expect(admin).toHaveURL(/\/stock-entry\/[0-9a-f-]{36}$/);
  // the worker reads the photo (a fixed reading in this run) and matches the names
  await expect(admin.getByText("Needs review").first()).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByLabel("Batch, line 1")).toHaveValue("B-PAN1");
  await expect(admin.getByLabel("Qty, line 2")).toHaveValue("60");
  await expect(admin.getByRole("textbox", { name: "Medicine" }).first()).toHaveValue("Panadol 500mg Tablet");
  await admin.getByRole("button", { name: "Add to stock as opening balance" }).click();
  await toast(admin, /Posted as/);
});

test("a supplier bill is typed in on the keyboard grid and posted", async () => {
  expect((await admin.request.post("/api/suppliers", { data: { name: state.supplier, phone: "051-5550200" } })).ok()).toBeTruthy();
  await admin.goto("/stock-entry");
  await admin.getByRole("button", { name: "New stock entry" }).click();
  await admin.getByRole("button", { name: /Type in a supplier bill/ }).click();
  await expect(admin).toHaveURL(/\/stock-entry\/[0-9a-f-]{36}$/);
  await admin.getByLabel("Supplier").selectOption({ label: state.supplier });
  await admin.getByLabel("Invoice no.").fill("INV-7781");
  await admin.getByRole("textbox", { name: "Medicine" }).first().fill("Panadol");
  await admin.getByRole("option", { name: /Panadol 500mg Tablet/ }).click();
  await admin.getByLabel("Batch, line 1").fill("B-PAN2");
  await admin.getByLabel("Exp (MM/YY), line 1").fill("03/29");
  await admin.getByLabel("Qty, line 1").fill("50");
  await admin.getByLabel("Rate, line 1").fill("22");
  await admin.getByLabel("Sale price, line 1").fill("30");
  await admin.getByRole("button", { name: "Post stock" }).click();
  await toast(admin, /Posted as/);
  await expect(admin.getByText(/Posted as purchase/)).toBeVisible();
});

let cashier: Page;
test("a cashier gets an account, opens the drawer, sells and prints the receipt", async ({ browser }) => {
  await admin.goto("/users");
  await admin.getByRole("button", { name: "Add user" }).click();
  await admin.getByLabel("Name", { exact: true }).fill("Kashif Mehmood");
  await admin.getByLabel("Email").fill("kashif@e2e-care.example");
  await admin.getByLabel("Username").fill(state.cashierUser);
  await admin.getByLabel("Role").selectOption({ label: "Cashier" });
  await admin.getByText("Temporary password", { exact: true }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Add user" }).click();
  const temporary = (await admin.getByRole("dialog").locator("code").textContent())!.trim();
  await admin.getByRole("button", { name: "Done" }).click();

  cashier = await fresh(browser);
  await staffSignIn(cashier, state.cashierUser, temporary);
  await cashier.getByLabel("Current password").fill(temporary);
  await cashier.getByLabel("New password", { exact: true }).fill(state.cashierPassword);
  await cashier.getByLabel("Repeat the new password").fill(state.cashierPassword);
  await cashier.getByRole("button", { name: "Save password" }).click();
  await expect(cashier).toHaveURL(/\/pos/);
  await cashier.getByLabel("Opening cash").fill("1000");
  await cashier.getByRole("button", { name: "Open drawer" }).click();

  await cashier.getByLabel("Search medicine or scan barcode").fill("Brufen");
  await cashier.getByRole("option", { name: /Brufen 400mg Tablet/ }).click();
  await cashier.getByRole("button", { name: "Increase Brufen 400mg Tablet" }).click();
  await cashier.getByLabel("Cash received").fill("100");
  await expect(cashier.getByText("Change PKR 10.00")).toBeVisible();
  await cashier.keyboard.press("F9");
  const last = cashier.getByText(/^Last:/);
  await expect(last).toContainText("INV-");
  state.invoice = (await last.locator("b").textContent())!.trim();
  // the receipt printed in place: the same page, opened on its own
  const src = await cashier.locator("#receipt-frame").getAttribute("src");
  const receipt = await cashier.context().newPage();
  await receipt.goto(src!.replace("print=1&", ""));
  await expect(receipt.getByText(state.invoice).first()).toBeVisible();
  await expect(receipt.getByText("E2E Care Pharmacy").first()).toBeVisible();
  await expect(receipt.getByText("Thank you. Get well soon.")).toBeVisible();
  await receipt.close();
});

test("a pharmacist takes one back using the invoice number on the receipt", async () => {
  await admin.goto("/returns/new");
  await admin.getByLabel("Invoice number").fill(state.invoice);
  await admin.getByRole("button", { name: "Find" }).click();
  await admin.getByLabel("Returning Brufen 400mg Tablet").fill("1");
  await admin.getByRole("radio", { name: "Card" }).click();
  await admin.getByLabel("Reason").fill("Doctor changed the prescription");
  await admin.getByRole("button", { name: "Record return and print" }).click();
  await expect(admin).toHaveURL(/\/invoice\/returns\//);
  await expect(admin.getByText(state.invoice).first()).toBeVisible();
});

test("the cashier counts the drawer and closes it", async () => {
  await cashier.goto("/cash");
  await cashier.getByRole("button", { name: "Count and close" }).click();
  // float 1000 plus the cash sale of 90; the return was refunded by card
  await cashier.getByLabel("Cash counted in the drawer").fill("1090");
  await expect(cashier.getByText("The drawer balances.")).toBeVisible();
  await cashier.getByRole("button", { name: "Close drawer" }).click();
  await toast(cashier, /closed/i);
});

test("a supply order is sent and received through stock entry", async () => {
  await admin.goto("/orders/new");
  await admin.getByLabel("Supplier").selectOption({ label: state.supplier });
  await admin.getByLabel("Medicine").first().fill("Brufen");
  await admin.getByRole("button", { name: "Brufen 400mg Tablet" }).click();
  await admin.getByLabel("Quantity").first().fill("24");
  await admin.getByRole("button", { name: "Save draft order" }).click();
  await expect(admin).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await admin.getByRole("button", { name: "Approve and send" }).click();
  await admin.getByRole("button", { name: "Receive stock" }).click();
  await expect(admin).toHaveURL(/\/stock-entry\/[0-9a-f-]{36}$/);
  const banner = admin.getByText(/Receiving order PO-.*Enter what arrived/);
  await expect(banner).toBeVisible();
  await expect(admin.getByLabel("Qty, line 1")).toHaveValue("24");
  await admin.getByLabel("Batch, line 1").fill("B-BRU2");
  await admin.getByLabel("Exp (MM/YY), line 1").fill("09/28");
  await admin.getByLabel("Qty, line 1").fill("20");
  await admin.getByLabel("Rate, line 1").fill("34");
  await admin.getByLabel("Sale price, line 1").fill("45");
  await admin.getByRole("button", { name: "Post stock" }).click();
  await toast(admin, /Posted as/);
  await banner.getByRole("link").click();
  await expect(admin.getByText(/partly received/i).first()).toBeVisible();
});
