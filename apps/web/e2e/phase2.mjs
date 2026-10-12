// Live end-to-end check of Phase 2 against a running API + web app.
// Usage: API_URL=http://localhost:4100 WEB_URL=http://localhost:3199 ADMIN_EMAIL=… ADMIN_PASSWORD=… CHROME=/path/to/chrome node e2e/phase2.mjs
// Requires `playwright` to be resolvable (set PLAYWRIGHT_PATH to its folder if installed globally).
import { createRequire } from "node:module";

const { chromium } = process.env.PLAYWRIGHT_PATH
  ? createRequire(`${process.env.PLAYWRIGHT_PATH}/`)("playwright")
  : await import("playwright");

const { API_URL, WEB_URL, ADMIN_EMAIL, ADMIN_PASSWORD, CHROME } = process.env;
const USER_PASSWORD = "Phase2-User-Password!";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`); };

async function api(path, { token, body, method } = {}) {
  const res = await fetch(`${API_URL}/api${path}`, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ---- arrange: stores and one user per role through the real admin API
const PRIMARY_ORG_SLUG = process.env.PRIMARY_ORG_SLUG;
const admin = (await api("/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, organizationSlug: PRIMARY_ORG_SLUG } })).body.accessToken;
const seed = (await api("/pos/v1/demo/seed", { token: admin, body: {} })).body;
const storeA = seed.storeId;
const storeB = (await api("/admin/stores", { token: admin, body: { code: "SECOND", name: "Second store" } })).body.id;
const roles = (await api("/admin/roles", { token: admin })).body.roles;
const roleId = (n) => roles.find((r) => r.name === n).id;
const users = { manager: ["manager@phase2.test", "Store Manager"], cashier: ["cashier@phase2.test", "Cashier"], inventory: ["inventory@phase2.test", "Inventory User"], locky: ["locky@phase2.test", "Cashier"] };
for (const [, [email, role]] of Object.entries(users)) {
  const r = await api("/admin/users", { token: admin, body: { email, password: USER_PASSWORD, firstName: role, storeIds: [storeA], roleAssignments: [{ roleId: roleId(role), scopeType: "STORE", scopeId: storeA }] } });
  if (r.status !== 201) throw new Error(`could not create ${email}: ${r.status} ${JSON.stringify(r.body)}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/401|403|409|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors };
}
async function signIn(page, email, password = USER_PASSWORD, org) {
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (org) {
    // The organisation picker only appears after the API reports the email is ambiguous.
    const picker = page.getByLabel("Organisation");
    await picker.waitFor({ timeout: 1000 }).catch(() => {});
    if (await picker.count()) {
      await picker.selectOption(org);
      await page.getByRole("button", { name: "Sign in" }).click();
    }
  }
}
// Pages stream, so a redirect issued by a page (not a layout) completes just after load: wait for it.
const settle = async (page, test, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test(new URL(page.url()))) return true; await page.waitForTimeout(100); } return test(new URL(page.url())); };
const formAlert = (page) => page.locator('form [role="alert"], main [role="alert"]').first();
const navLabels = (page) => page.locator('nav[aria-label="Main"] a').allTextContents();

// 1. unauthenticated users are sent to sign in
{
  const { page, context } = await fresh();
  for (const path of ["/org", `/s/${storeA}`, `/s/${storeA}/pos`]) {
    await page.goto(WEB_URL + path);
    check(`unauthenticated ${path} -> /login`, new URL(page.url()).pathname === "/login", page.url());
  }
  const res = await page.request.get(`${WEB_URL}/api/proxy/admin/users`);
  check("proxy refuses calls without a session (401)", res.status() === 401, String(res.status()));
  await context.close();
}

// 2. bad credentials and lockout
{
  const { page, context } = await fresh();
  await signIn(page, users.locky[0], "wrong-password");
  await formAlert(page).waitFor();
  check("wrong password shows an inline error and stays on /login", /Invalid email or password/.test(await formAlert(page).innerText()) && page.url().endsWith("/login"));
  for (let i = 0; i < 4; i++) { await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(150); }
  await page.getByLabel("Password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => /locked/i.test(document.querySelector('form [role="alert"]')?.textContent ?? ""));
  check("account locks after repeated failures, even with the right password", true);
  await context.close();
}

// 3. admin: lands on /org, httpOnly cookie, full navigation
{
  const { page, context, errors } = await fresh();
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, PRIMARY_ORG_SLUG);
  await page.waitForURL("**/org");
  check("admin lands on /org", true);
  const labels = await navLabels(page);
  check("admin sees organisation and store navigation", ["Users", "Roles", "Stores", "Audit log", "Point of sale"].every((l) => labels.includes(l)), labels.join(","));
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "pos_session");
  check("session cookie is httpOnly and SameSite=Lax", session?.httpOnly === true && session?.sameSite === "Lax", JSON.stringify(session));
  const leaked = await page.evaluate((tok) => ({ cookie: document.cookie.includes(tok), local: JSON.stringify({ ...localStorage }).includes(tok), session: JSON.stringify({ ...sessionStorage }).includes(tok) }), session.value);
  check("token is not readable from page JavaScript or web storage", !leaked.cookie && !leaked.local && !leaked.session, JSON.stringify(leaked));
  check("no console errors while signed in as admin", errors.length === 0, errors.join(" | "));
  const html = await page.content();
  check("token does not appear in the rendered page", !html.includes(session.value));
  // cross-site write is refused
  const evil = await page.request.post(`${WEB_URL}/api/auth/login`, { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check("cross-origin sign-in attempt is refused (403)", evil.status() === 403, String(evil.status()));
  // proxied admin call works for admin
  const ok = await page.request.get(`${WEB_URL}/api/proxy/admin/users`);
  check("admin can call the admin API through the proxy", ok.status() === 200, String(ok.status()));
  // logout
  await page.getByLabel("User menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  const after = await context.cookies();
  check("sign out clears the cookie", !after.some((c) => c.name === "pos_session"));
  await page.goto(`${WEB_URL}/org`);
  check("after sign out /org redirects to /login", new URL(page.url()).pathname === "/login");
  const stale = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${session.value}` } });
  check("signed-out token is rejected by the API (401)", stale.status === 401, String(stale.status));
  await context.close();
}

// 4. cashier: only POS + own store
{
  const { page, context, errors } = await fresh();
  await signIn(page, users.cashier[0]);
  await page.waitForURL(`**/s/${storeA}/pos`);
  check("cashier lands on the POS screen", true);
  check("POS shows the cashier's name from the session", (await page.locator("header").first().innerText()).includes("Cashier"));
  await page.goto(`${WEB_URL}/org`);
  check("cashier opening /org is redirected away from the organisation area", await settle(page, (u) => !u.pathname.startsWith("/org")), page.url());
  await page.goto(`${WEB_URL}/s/${storeB}/pos`);
  check("cashier opening another store is sent to /forbidden", new URL(page.url()).pathname === "/forbidden", page.url());
  await page.goto(`${WEB_URL}/s/${storeA}`);
  const labels = await navLabels(page);
  check("cashier navigation is limited", !labels.some((l) => ["Users", "Roles", "Stores", "Audit log", "Inventory", "Store reports", "Approvals"].includes(l)) && labels.includes("Point of sale"), labels.join(","));
  await page.goto(`${WEB_URL}/s/${storeA}/inventory`);
  check("cashier opening a page without permission is sent to /forbidden", await settle(page, (u) => u.pathname === "/forbidden"), page.url());
  const own = await page.request.get(`${WEB_URL}/api/proxy/pos/v1/sessions`, { headers: { "x-store-id": storeA } });
  const other = await page.request.get(`${WEB_URL}/api/proxy/pos/v1/sessions`, { headers: { "x-store-id": storeB } });
  const adminApi = await page.request.get(`${WEB_URL}/api/proxy/admin/users`);
  const notAllowed = await page.request.get(`${WEB_URL}/api/proxy/auth/login`);
  check("API allows the cashier's own store (200)", own.status() === 200, String(own.status()));
  check("API refuses the cashier on another store (403)", other.status() === 403, String(other.status()));
  check("API refuses the cashier on admin routes (403)", adminApi.status() === 403, String(adminApi.status()));
  check("proxy does not expose unlisted API paths (404)", notAllowed.status() === 404, String(notAllowed.status()));

  // PIN + lock
  await page.goto(`${WEB_URL}/s/${storeA}/pos`);
  const openTill = page.getByRole("dialog").getByRole("button", { name: "Open till" });
  if (await openTill.count()) {
    await openTill.click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await page.getByLabel("User menu").waitFor({ timeout: 10000 });
  await page.getByLabel("User menu").click();
  await page.getByRole("menuitem", { name: "Set PIN" }).click();
  await page.getByRole("textbox", { name: "PIN" }).fill("2468");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await page.getByLabel("User menu").waitFor();
  await page.waitForTimeout(500);
  await page.getByLabel("User menu").click();
  await page.getByRole("menuitem", { name: "Lock till" }).click();
  await page.waitForURL("**/lock");
  check("Lock till shows the lock screen", true);
  await page.goto(`${WEB_URL}/s/${storeA}/pos`);
  check("while locked, the POS redirects back to /lock (survives reload)", new URL(page.url()).pathname === "/lock", page.url());
  for (const d of "1111") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Unlock" }).click();
  await formAlert(page).or(page.locator('main [role="alert"]')).first().waitFor();
  check("wrong PIN is rejected with a message", /Invalid PIN/i.test(await page.locator('[role="alert"]', { hasText: /PIN/ }).first().innerText()));
  for (const d of "2468") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL(`**/s/${storeA}/pos`);
  check("correct PIN unlocks and returns to the POS", true);
  check("no console errors for the cashier flow", errors.length === 0, errors.join(" | "));

  // auto-lock after idle (fake clock)
  await page.clock.install();
  await page.goto(`${WEB_URL}/s/${storeA}/pos`);
  await page.clock.fastForward("16:00");
  await page.waitForURL("**/lock", { timeout: 5000 }).catch(() => {});
  check("the till locks itself after 15 minutes idle", new URL(page.url()).pathname === "/lock", page.url());
  await context.close();
}

// 5. manager: store dashboard, no organisation area
{
  const { page, context } = await fresh();
  await signIn(page, users.manager[0]);
  await page.waitForURL(`**/s/${storeA}`);
  check("manager lands on the store dashboard", true);
  const labels = await navLabels(page);
  check("manager sees store reports but not organisation admin", labels.includes("Store reports") && !labels.includes("Users") && !labels.includes("Roles"), labels.join(","));
  await page.goto(`${WEB_URL}/org/users`);
  check("manager opening /org/users is redirected away", await settle(page, (u) => !u.pathname.startsWith("/org")), page.url());
  await context.close();
}

// 6. inventory user: dashboard of own store, inventory but no POS
{
  const { page, context } = await fresh();
  await signIn(page, users.inventory[0]);
  await page.waitForURL(`**/s/${storeA}`);
  const labels = await navLabels(page);
  check("inventory user sees Inventory but not Point of sale", labels.includes("Inventory") && !labels.includes("Point of sale"), labels.join(","));
  await page.goto(`${WEB_URL}/s/${storeA}/pos`);
  check("inventory user opening the POS is sent to /forbidden", await settle(page, (u) => u.pathname === "/forbidden"), page.url());
  await context.close();
}

// 7. same email in two organisations -> organisation picker
if (process.env.SECOND_ORG_SLUG) {
  const { page, context } = await fresh();
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.getByLabel("Organisation").waitFor();
  const options = await page.getByLabel("Organisation").locator("option").allTextContents();
  check("ambiguous email shows an organisation picker", options.length === 3, options.join(","));
  await page.getByLabel("Organisation").selectOption(process.env.SECOND_ORG_SLUG);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/org");
  check("choosing an organisation signs in to that organisation", (await page.locator("header").first().innerText()).includes(process.env.SECOND_ORG_NAME));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
