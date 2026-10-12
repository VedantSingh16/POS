// Non-mutating browser walkthrough of the Phase 4 product builder and catalogue controls.
// Usage: API_URL=http://localhost:4100 WEB_URL=http://localhost:3100 ADMIN_EMAIL=… ADMIN_PASSWORD=… PRIMARY_ORG_SLUG=… CHROME=… node e2e/phase4-catalog.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = process.env.PLAYWRIGHT_PATH
  ? createRequire(`${process.env.PLAYWRIGHT_PATH}/`)("playwright")
  : await import("playwright");

const { API_URL, WEB_URL, ADMIN_EMAIL, ADMIN_PASSWORD, PRIMARY_ORG_SLUG, CHROME } = process.env;
for (const [key, value] of Object.entries({ API_URL, WEB_URL, ADMIN_EMAIL, ADMIN_PASSWORD, PRIMARY_ORG_SLUG, CHROME })) {
  if (!value) throw new Error(`${key} is required`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !/401|403|404|409|Failed to load resource/.test(message.text())) errors.push(message.text());
});

try {
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const picker = page.getByLabel("Organisation");
  await picker.waitFor({ timeout: 1000 }).catch(() => {});
  if (await picker.count()) {
    await picker.selectOption(PRIMARY_ORG_SLUG);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL((url) => url.pathname === "/org" || url.pathname.startsWith("/onboarding/"), { timeout: 15000 });

  await page.goto(`${WEB_URL}/org/catalog/products`);
  assert.equal(new URL(page.url()).pathname, "/org/catalog/products", "admin must be able to open the catalogue");
  for (const label of ["Filter by category", "Filter by brand", "Filter by status", "Filter by tax group", "Stock store"]) {
    assert.equal(await page.getByLabel(label).count(), 1, `${label} control should render once`);
  }
  console.log("PASS  catalogue category/brand/status/tax filters and store stock selector render");

  await page.getByRole("button", { name: "New product" }).click();
  await page.getByLabel("Product name").fill("Browser-only variant builder check");
  await page.getByLabel("SKU prefix").fill("BROWSER-CHECK");
  await page.getByLabel("Attribute name").first().fill("Color");
  await page.getByLabel("Color values").fill("Blue, Red");
  await page.getByRole("button", { name: "Add attribute" }).click();
  await page.getByLabel("Attribute name").nth(1).fill("Size");
  await page.getByLabel("Size values").fill("S, M");

  const table = page.getByRole("table");
  await assert.doesNotReject(() => table.getByRole("row").nth(4).waitFor());
  assert.equal(await table.getByRole("row").count(), 5, "2×2 attributes should generate 4 editable variants");
  const skuInput = page.getByLabel("Color: Blue / Size: S SKU");
  await skuInput.fill("BROWSER-CHECK-BLUE-S");
  assert.equal(await skuInput.inputValue(), "BROWSER-CHECK-BLUE-S");
  await page.getByLabel("Color: Blue / Size: S barcode").fill("890000000001");
  await page.getByLabel("Color: Blue / Size: S price in paise").fill("12500");
  assert.equal(await page.getByRole("button", { name: "Create 4 variants" }).isEnabled(), true);
  console.log("PASS  2×2 attribute combinations render four rows with editable SKU, barcode and price");

  // Stub writes so this browser walkthrough verifies the submitted payload without
  // creating persistent catalogue records in the configured operator database.
  let createdProduct;
  const submittedVariants = [];
  let resolveVariants;
  const allVariantsSubmitted = new Promise((resolve) => { resolveVariants = resolve; });
  await page.route("**/api/proxy/admin/catalog/products", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createdProduct = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "browser-only-product" }) });
  });
  await page.route("**/api/proxy/admin/catalog/products/*/variants", async (route) => {
    submittedVariants.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({}) });
    if (submittedVariants.length === 4) resolveVariants();
  });
  await page.getByRole("button", { name: "Create 4 variants" }).click();
  await Promise.race([allVariantsSubmitted, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for generated variant requests")), 10000))]);
  assert.deepEqual(createdProduct, { name: "Browser-only variant builder check", brand: "" });
  assert.equal(submittedVariants.length, 4);
  assert.equal(new Set(submittedVariants.map((variant) => variant.sku)).size, 4);
  assert.deepEqual(submittedVariants.map((variant) => variant.name), [
    "Color: Blue / Size: S", "Color: Blue / Size: M", "Color: Red / Size: S", "Color: Red / Size: M",
  ]);
  assert.deepEqual(submittedVariants[0], {
    name: "Color: Blue / Size: S", sku: "BROWSER-CHECK-BLUE-S", barcode: "890000000001",
    amountCents: 12500, includesTax: true,
  });
  console.log("PASS  submit sends the product and four unique variant payloads; browser API writes were stubbed");

  assert.deepEqual(errors, [], `unexpected browser errors: ${errors.join(" | ")}`);
  console.log("PASS  no browser page or console errors");
} finally {
  await context.close();
  await browser.close();
}
