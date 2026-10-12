# POS ↔ CRM Connection — Phase-wise Implementation Plan

This turns the full connection plan into ordered phases with a clear "done" line for each one. Work top to bottom — don't start a phase until the previous one's exit criteria are met, since each phase's output is what the next phase depends on.

---

## Phase 0 — Decisions & Alignment (no code)

**Goal:** remove every open ambiguity so nothing has to be redone later.

Tasks:
- Decide once and for all: self-contained manifest only (schema-v2, like HRMS), or does CRM's actual registry code also need a central list entry? Check CRM's real registration endpoint code, not just the docs, to settle this.
- Pick the exact Product_Contract version POS will build against (resolve the 2.2.0 / 2.1.0 / 2.0.1 mismatch).
- Lock the immutable identifiers: `productKey = POS`, `audience = pos-api`, `webPath = /{locale}/app/pos`, `apiPrefix = /api/pos/v1`.
- Confirm scope: retail vs. food-service (assume retail unless told otherwise).
- Confirm which capabilities are real for v1: `POS_CORE` (definite) + which of `POS_INVENTORY`, `POS_REFUNDS`, `POS_CUSTOMERS`, `POS_REPORTING_ADVANCED`, `POS_MULTI_LOCATION` ship now vs. later.

**Exit criteria:** one short written note (even a paragraph in this repo) stating all five decisions above. Nothing in Phase 1+ should require guessing.

---

## Phase 1 — Contract Package Wiring (POS side)

**Goal:** POS's repo can compile against the shared rulebook.

Tasks:
- Add `.npmrc` scope mapping for `@mariya-abdul`.
- `pnpm add @mariya-abdul/deltcrm-product-contracts@<locked version> --save-exact`.
- Commit `package.json` + lockfile.
- Confirm resolution: `pnpm why @mariya-abdul/deltcrm-product-contracts`, and the runtime version check (`node -e "console.log(require(...).PRODUCT_CONTRACT_VERSION)"`).
- Import the stable entry points (types, `createRemoteJwksProductTokenVerifier`, `ProductIntegrationClient`) somewhere trivial just to prove they resolve — no real logic yet.

**Exit criteria:** `pnpm install && pnpm typecheck && pnpm build` succeed in the POS repo with the package installed and imported.

---

## Phase 2 — POS Manifest

**Goal:** POS has one valid, versioned file describing itself.

Tasks:
- Write `product/manifest.v2.json` using the decisions locked in Phase 0.
- Fill in the full `permissions` and `capabilities` arrays (only the ones confirmed for v1 — leave the rest out rather than declaring something not yet approved).
- Add `lifecycle.consumes`/`publishes`, `health`, `localization`.
- Run `deltcrm-product validate product/manifest.v2.json` and fix every error/warning.

**Exit criteria:** the manifest validates cleanly and is checked into the POS repo (not Product_Contract, not CRM).

---

## Phase 3 — CRM-Side Readiness Check

**Goal:** confirm CRM can actually issue and verify a second product's tokens before POS code depends on it.

Tasks:
- Check CRM's token-issuance code: is the audience (`hrms-api` today) hardcoded anywhere, or does it read from the registered manifest generically? Same check for JWKS signing and the internal API's product-key routing (`X-Product-Key`).
- If it's generic already: no CRM code changes needed, skip to Phase 4.
- If it's HRMS-hardcoded anywhere: that's a small CRM-side fix to make first — generalize it to read the product key/audience from whichever manifest is registered, rather than a second hardcoded branch for POS.
- Confirm CRM exposes (or can expose) a working `/.well-known/jwks.json` and the internal routes POS will call (`.../products/:productKey/manifest`, `.../tenants/:tenantId/entitlements`, `.../lifecycle/acknowledgements`) generically by `productKey`, not specific to HRMS.

**Exit criteria:** written confirmation (a comment, a note, or a passing test) that CRM's token/registry code handles an arbitrary `productKey`/`audience`, not just HRMS's.

---

## Phase 4 — Trust Boundary (POS side) — build before any business feature

**Goal:** POS can verify a real CRM-issued token and call CRM back safely.

Tasks, in order:
1. `pos-product-token.guard.ts` — verify signature, issuer, audience (`pos-api`), expiry, `kid`, using `createRemoteJwksProductTokenVerifier`. Add the JWKS cache + single-refresh-on-unknown-kid behavior.
2. `pos-platform-contract.adapter.ts` — wrap `ProductIntegrationClient` behind `ProductPlatformPort`.
3. Permission/capability enforcement helpers (`requirePermission`, `requireCapability`) used on every protected route.
4. Tenant-scoped query pattern established as the only way POS's repositories are called (`where: { tenantId: claims.tenantId }` everywhere).
5. Contract-error handling that fails closed (`PLATFORM_CONTRACT_UNAVAILABLE` → service-unavailable, never a fallback tenant ID).

**Exit criteria:** unit tests pass for: valid token accepted, wrong audience rejected, expired token rejected, missing permission rejected, missing capability rejected, Platform-unreachable fails closed.

---

## Phase 5 — Environment & Secrets

**Goal:** POS has real, non-hardcoded connection details to a running CRM instance (local/dev first).

Tasks:
- Get/generate: `PLATFORM_INTERNAL_BASE_URL`, `PLATFORM_PUBLIC_BASE_URL`, `PLATFORM_JWKS_URL`, `PRODUCT_TOKEN_ISSUER`, `POS_PLATFORM_SERVICE_KEY`.
- Put them in POS's `.env` (local) and whatever secret store you'll use for real environments later — never commit real values, only `.env.example` placeholders.

**Exit criteria:** POS's API boots locally and can reach CRM's JWKS URL and internal base URL (a simple health check call succeeds).

---

## Phase 6 — Registration

**Goal:** CRM formally knows POS exists.

Tasks:
- Issue/confirm a registration-only credential (CI key or equivalent) — not your personal Platform login.
- Run `deltcrm-product register product/manifest.v2.json --activate` (or whatever the real equivalent command/endpoint is in this CRM's implementation) against the target CRM instance.
- Confirm the registry now lists POS (via CRM's admin/products screen or its internal manifest-lookup endpoint).
- Configure at least one plan/subscription to include `POS_CORE`, so a test tenant can actually be entitled.

**Exit criteria:** a request to CRM's `.../products/POS/manifest` returns POS's manifest; a test tenant with the plan shows a POS entitlement as active.

---

## Phase 7 — Lifecycle Events

**Goal:** turning POS on/off for a tenant actually does something in POS's own database.

Tasks:
- Build the event consumer for `platform.product.activation-requested.v1` / `.suspension-requested.v1` / `.reactivation-requested.v1` / `.deletion-requested.v1`, deduped by `eventId`.
- On activation: create the tenant's empty POS rows (default location/register scaffolding), publish `pos.product.activated.v1` back (or `.activation-failed.v1`).
- On suspension: block access, never delete data.
- Add dead-letter handling for events that repeatedly fail.

**Exit criteria:** activating POS for a test tenant results in that tenant's row appearing in POS's database, and the acknowledgement event is visible on CRM's side; duplicate delivery of the same event doesn't double-create anything.

---

## Phase 8 — End-to-End Verification

**Goal:** prove the whole chain works, not just each piece in isolation.

Run the full test matrix from the connection plan:
- Token/auth cases (valid, wrong audience, expired, wrong issuer, rotated key).
- Entitlement/authorization cases (inactive product, missing capability, missing permission, quota, reactivation).
- Tenant isolation cases (tenant A can never see/touch tenant B's data).
- Provisioning/event cases (duplicate delivery, retry, dead-letter, correlation IDs).
- Platform-unavailable cases (fails closed, doesn't fall back to browser-supplied tenant ID).
- Routing/localization cases (en/ar both reach POS, deep links survive refresh).

**Exit criteria:** every row in that matrix passes in a staging-like environment, not just "works on my machine."

---

## Phase 9 — Observability & Rollback Rehearsal

**Goal:** you can see problems and undo a bad deploy safely.

Tasks:
- Wire logging/metrics for token failures, entitlement denials, Platform-call latency, lifecycle lag, health.
- Propagate `X-Request-Id`/`X-Trace-Id`/`traceparent` through gateway → CRM → POS logs.
- Do one real rollback rehearsal: deploy a bad POS version, roll the gateway back to the previous one, confirm no tenant data was lost and events can safely replay.

**Exit criteria:** a dashboard/log view exists for the metrics above, and the rollback rehearsal is documented as having actually been run once.

---

## Phase 10 — Go-Live

**Goal:** flip POS on for real tenants.

Tasks:
- Activate one pilot tenant for real (not just a test tenant).
- Watch the observability from Phase 9 for the first real activation.
- Only after the pilot is stable, open POS's plan/capability config to more tenants.

**Exit criteria:** pilot tenant using POS successfully with no manual intervention; from here on, POS's team works entirely inside its own repo for new features.

---

## Quick phase summary

| Phase | What it produces | Where the work happens |
|---|---|---|
| 0 | Decisions written down | Neither repo — just a decision |
| 1 | Contract package installed | POS repo |
| 2 | `manifest.v2.json` written & validated | POS repo |
| 3 | Confirmed CRM handles any product generically | CRM repo (maybe a small fix) |
| 4 | Token guard + platform adapter + enforcement | POS repo |
| 5 | Real env vars/secrets wired | POS repo (+ CRM issues the key) |
| 6 | POS registered in CRM's registry | CRM (run against it) |
| 7 | Activation/suspension actually work | POS repo |
| 8 | Full test matrix passing | Both, tested together |
| 9 | Metrics + one rollback rehearsal | Both |
| 10 | Real pilot tenant live | Both, in production |

After Phase 10, every future POS feature (catalog, sales, inventory, etc.) is pure POS-repo work — no more CRM or Product_Contract changes needed for routine development.
