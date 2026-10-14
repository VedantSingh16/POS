// Route smoke audit for the Plan 3 shell and protected pages.
// Usage: API_URL=http://localhost:4100 WEB_URL=http://localhost:3100 ADMIN_EMAIL=... ADMIN_PASSWORD=... PRIMARY_ORG_SLUG=... CHROME=... node e2e/plan1-routes.mjs
import { createRequire } from "node:module";

const { chromium } = process.env.PLAYWRIGHT_PATH
  ? createRequire(`${process.env.PLAYWRIGHT_PATH}/`)("playwright")
  : await import("playwright");

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3100";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRIMARY_ORG_SLUG = process.env.PRIMARY_ORG_SLUG;
const CHROME = process.env.CHROME;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !PRIMARY_ORG_SLUG || !CHROME) throw new Error("ADMIN_EMAIL, ADMIN_PASSWORD, PRIMARY_ORG_SLUG and CHROME are required");

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const login = await api("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, organizationSlug: PRIMARY_ORG_SLUG } });
const stores = await api("/admin/stores", { token: login.accessToken });
if (!stores.stores?.[0]?.id) throw new Error("At least one store is required for the route audit");
const storeId = stores.stores[0].id;

const routes = [
  "/org", "/org/users", "/org/roles", "/org/stores", "/org/catalog/products", "/org/catalog/categories", "/org/catalog/brands", "/org/catalog/import", "/org/catalog/tax", "/org/customers", "/org/reports", "/org/settings/general", "/org/settings/tax", "/org/settings/billing", "/org/settings/receipts", "/org/settings/approvals", "/org/settings/security", "/org/audit",
  `/s/${storeId}`, `/s/${storeId}/sales`, `/s/${storeId}/returns`, `/s/${storeId}/returns/new`, `/s/${storeId}/inventory`, `/s/${storeId}/inventory/ledger`, `/s/${storeId}/inventory/adjust`, `/s/${storeId}/inventory/opening-stock`, `/s/${storeId}/registers`, `/s/${storeId}/approvals`, `/s/${storeId}/alerts`, `/s/${storeId}/staff`, `/s/${storeId}/reports`, `/s/${storeId}/pos`, `/s/${storeId}/settings`, `/s/${storeId}/settings/profile`, `/s/${storeId}/settings/billing`, `/s/${storeId}/settings/checkout`, `/s/${storeId}/settings/product-fields`,
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`${page.url()} :: ${error}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/401|403|404|409|Failed to load resource/.test(message.text())) errors.push(`${page.url()} :: ${message.text()}`);
});

await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
await page.getByLabel("Email").fill(ADMIN_EMAIL);
await page.getByLabel("Password").fill(ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
const picker = page.getByLabel("Organisation");
await picker.waitFor({ timeout: 1000 }).catch(() => {});
if (await picker.count()) {
  await picker.selectOption(PRIMARY_ORG_SLUG);
  await page.getByRole("button", { name: "Sign in" }).click();
}
await page.waitForURL("**/org");

const failures = [];
for (const route of routes) {
  await page.goto(`${WEB_URL}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  const pathname = new URL(page.url()).pathname;
  if (pathname === "/login" || pathname === "/forbidden") failures.push(`${route} redirected to ${pathname}`);
  console.log(`PASS  ${route} -> ${pathname}`);
}

if (errors.length) failures.push(...errors.map((error) => `browser error: ${error}`));
await context.close();
await browser.close();
console.log(`\n${routes.length - failures.filter((failure) => !failure.startsWith("browser error:")).length}/${routes.length} route navigations completed`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
