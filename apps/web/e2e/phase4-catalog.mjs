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
  await page.getByRole("textbox", { name: "Password" }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const picker = page.getByLabel("Organisation", { exact: true });
  await picker.waitFor({ timeout: 1000 }).catch(() => {});
  if (await picker.count()) {
    await picker.selectOption(PRIMARY_ORG_SLUG);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL((url) => url.pathname === "/org" || url.pathname.startsWith("/onboarding/"), { timeout: 15000 });

  await page.goto(`${WEB_URL}/org`);
  assert.equal(new URL(page.url()).pathname, "/org", "admin must be able to open the organisation overview");
  const overviewTitle = page.locator(".app-ui main h1");
  if (await overviewTitle.count() === 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await overviewTitle.waitFor({ state: "attached", timeout: 15000 });
  }
  const visualStyle = await page.locator(".app-ui").evaluate((root) => {
    const title = root.querySelector("main h1");
    const sidebar = root.querySelector("aside");
    return {
      appFont: getComputedStyle(root).fontFamily,
      appTextSize: getComputedStyle(root).fontSize,
      titleTextSize: title ? getComputedStyle(title).fontSize : "missing",
      sidebarWidth: sidebar ? getComputedStyle(sidebar).width : "missing",
      sidebarColor: sidebar ? getComputedStyle(sidebar).backgroundColor : "missing",
      pageColor: getComputedStyle(document.body).backgroundColor,
    };
  });
  assert.match(visualStyle.appFont.toLowerCase(), /manrope/);
  assert.equal(visualStyle.appTextSize, "16px");
  assert.notEqual(visualStyle.titleTextSize, "missing", `organisation overview title missing: ${JSON.stringify(visualStyle)}`);
  assert.ok(Number.parseFloat(visualStyle.titleTextSize) >= 44, `organisation overview title too small: ${JSON.stringify(visualStyle)}`);
  assert.equal(visualStyle.sidebarWidth, "256px");
  assert.equal(visualStyle.sidebarColor, "rgb(4, 120, 87)");
  assert.equal(visualStyle.pageColor, "rgb(247, 245, 239)");
  console.log("PASS  organisation overview uses the Manrope hierarchy, larger base text, cream canvas and green rail");

  await page.goto(`${WEB_URL}/org/catalog/products`);
  assert.equal(new URL(page.url()).pathname, "/org/catalog/products", "admin must be able to open the catalogue");
  await page.getByRole("button", { name: "Filters" }).click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  for (const label of ["Filter by Category", "Filter by Brand", "Filter by Status"]) {
    assert.equal(await page.getByLabel(label).count(), 1, `${label} control should render once`);
  }
  await filters.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.getByLabel("Stock store").count(), 1, "Stock store control should render once");
  console.log("PASS  catalogue category/brand/status filters and store stock selector render");

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
  await page.getByLabel("Color: Blue / Size: S price in rupees").fill("125.00");
  const currencyMatch = (await page.getByRole("dialog", { name: "New product" }).locator("table thead").innerText()).match(/\(([A-Z]{3})\)/);
  assert.ok(currencyMatch, "variant price header should show the organization currency");
  const fractionDigits = await page.evaluate((currency) => new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits, currencyMatch[1]);
  const expectedMinor = Math.round(125 * 10 ** fractionDigits);
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
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ variants: [{ id: `browser-only-variant-${submittedVariants.length}` }] }) });
    if (submittedVariants.length === 4) resolveVariants();
  });
  await page.getByRole("button", { name: "Create 4 variants" }).click();
  await Promise.race([allVariantsSubmitted, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for generated variant requests")), 10000))]);
  assert.deepEqual(createdProduct, { name: "Browser-only variant builder check", description: "", brand: "", customFields: {} });
  assert.equal(submittedVariants.length, 4);
  assert.equal(new Set(submittedVariants.map((variant) => variant.sku)).size, 4);
  assert.deepEqual(submittedVariants.map((variant) => variant.name), [
    "Color: Blue / Size: S", "Color: Blue / Size: M", "Color: Red / Size: S", "Color: Red / Size: M",
  ]);
  assert.deepEqual(submittedVariants[0], {
    name: "Color: Blue / Size: S", sku: "BROWSER-CHECK-BLUE-S", barcode: "890000000001",
    amountCents: expectedMinor, includesTax: true, customFields: {},
  });
  console.log("PASS  submit sends the product and four unique variant payloads; browser API writes were stubbed");

  assert.deepEqual(errors, [], `unexpected browser errors: ${errors.join(" | ")}`);
  console.log("PASS  no browser page or console errors");
} finally {
  await browser.close();
}
