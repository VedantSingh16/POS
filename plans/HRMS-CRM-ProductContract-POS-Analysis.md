# How HRMS, CRM (Platform), and Product_Contract Fit Together — and the Full POS Plan

Based on a full read of `b2/HRMS`, `b1/CRM`, `Product_Contract`, and the two POS planning docs in `Claude outputs`. No code was changed.

---

## Part 1 — The three repos and how they actually relate

Your Desktop\CRM folder holds **four related-but-separate things**, not one project:

```
CRM/
├── b1/CRM/            → "Platform" repo (deltcrm-crm) — the control plane
├── b2/HRMS/           → "HRMS" repo (deltcrm-hrms) — the first product built on the pattern
├── Product_Contract/  → the shared npm package (@mariya-abdul/deltcrm-product-contracts)
├── POS/               → (your cwd) the next product to be built the same way
└── Claude outputs/    → planning docs (POS-COMPLETE-PLAN.md, POS-FEATURES-DETAILED.md)
```

`b1/CRM` and `b2/HRMS` are **two checkouts of what is currently still one shared monorepo history** (same docs, same file timestamps, same `AGENTS.md`, same architecture folder duplicated in both). They are mid-way through a deliberate, staged split, not two finished independent products yet. `Product_Contract` is the actual, separate, publishable package that is meant to be the *only* thing a product imports from Platform.

### 1.1 What b1/CRM ("Platform") actually is

Platform is the **control plane**. Per the onboarding standard and the ADRs, it owns and only it owns:

- Tenants, immutable tenant IDs, workspace slugs/custom domains.
- Users, passwords, sessions, MFA, global roles and memberships.
- The **product registry** — the list of registered products and their manifests.
- Plans, subscriptions, product entitlements, capability/limit overrides, billing.
- **Product token issuance** (short-lived, audience-scoped JWTs) and the JWKS signing keys.
- Provisioning orchestration (activate/suspend/reactivate/delete a product for a tenant).
- Shared navigation/workspace shell and gateway product discovery.
- Localization governance and cross-product audit/notifications.

The live route snapshot (`b2/HRMS/contracts/platform-api-routes.snapshot.json`) shows this concretely: `/platform/tenants`, `/platform/products/:productKey`, `/platform/products/:productKey/revisions`, `/platform/tenants/:tenantId/product-entitlements`, `/product-integration/token`, `/internal/platform/v1/products/:productKey/manifest`, `/internal/platform/v1/products/:productKey/tenants/:tenantId/entitlements`, `/internal/.../lifecycle/acknowledgements`, `.well-known/jwks.json` — i.e. exactly the registry + entitlement + token-issuance + lifecycle-event surface the contract describes, already implemented and live in Platform.

### 1.2 What b2/HRMS actually is, and what CRM manages for it

HRMS is a **product data plane** — the first one built against this pattern, and it is the reference implementation your POS plan is explicitly modeled on. HRMS owns employees, organization/offices, attendance, leave, payroll, HR documents, biometrics and field tracking — its own business domain, own (eventually) database, own API/web/mobile apps.

What CRM (Platform) manages *for* HRMS, concretely:

- **Identity**: HRMS never authenticates a user itself. Platform issues a short-lived RS256 JWT audienced `hrms-api`; HRMS only verifies it against Platform's JWKS (issuer, audience, expiry, `kid`).
- **Entitlements/capabilities**: HRMS's manifest (`b2/HRMS/product/manifest.v2.json`) declares capabilities like `HRMS_PAYROLL`, `HRMS_BIOMETRICS`, `HRMS_FIELD_TRACKING` as `ADD_ON`s with `dependencyKeys`; Platform is the system of record for which tenant has which capability turned on, and HRMS must re-check it server-side on every request — a visible menu item is never authorization.
- **Permissions**: HRMS's manifest permissions (`hrms.payroll.manage`, `hrms.leave.approve`, etc.) map via `platformPermissionAliases`/`platformPermissionPrefixAliases` back to Platform-side role/permission grants — Platform still decides *who* has *which* HRMS permission, HRMS just declares the vocabulary and enforces it.
- **Provisioning lifecycle**: Platform publishes `platform.product.activation-requested.v1` (and suspension/reactivation/deletion variants); HRMS consumes these idempotently and publishes its own `hrms.tenant.activated.v1` / `.activation-failed.v1` / `.suspended.v1` back. Platform is the one that decides a tenant is entitled to HRMS; HRMS is the one that actually turns the lights on in its own database.
- **Navigation/routing**: Platform's shared shell renders `/{locale}/app/hrms` in the tenant's nav only if entitled; the gateway (per ADR-003) routes `/{locale}/app/hrms/*` and `/api/hrms/*` to the HRMS deployment while the browser stays on one tenant host.
- **Registration**: HRMS's manifest is registered into Platform's product registry through CI (`deltcrm-product register ... --activate`), not by hand-editing Platform code.

### 1.3 What Product_Contract actually is

`Product_Contract` (published as `@mariya-abdul/deltcrm-product-contracts`) is the **stable, versioned boundary package** — the only thing that is allowed to sit between Platform and any product. Concretely, in the folder you have:

- `src/contracts.ts` — shared identifiers/claims: `StableIdentifiers` (`tenantId`/`userId`/`membershipId`), `ProductTokenClaims`, `EffectiveEntitlements`, `ProductEntitlement`, `ProductProvisioningStatus`, `ProductLifecycleEvent`/`ProductEventEnvelope`, `ContractErrorEnvelope`.
- `src/token-verifier.ts` — `createRemoteJwksProductTokenVerifier(...)`, the **only** supported way for a product to verify a Platform-issued token (checks issuer, audience, algorithm, expiry, `kid` against JWKS).
- `src/manifest.ts` + `schemas/product-manifest-v2.schema.json` — the schema-v2 manifest shape every product (HRMS, Mail, POS) must publish (`productKey`, `audience`, `routes`, `navigation`, `permissions`, `capabilities`, `limits`, `lifecycle`, `health`, `localization`) plus `canonicalizeProductManifest`/`productManifestHash`/`verifyProductManifestSignature` used at registration time.
- `generated/product-integration-client.ts` — `ProductIntegrationClient`, the **only** supported HTTP client for a product to call back into Platform internally (identity status, entitlements, provisioning status, tenant-member directory lookups, usage reporting), authenticated with a product-scoped service credential (`X-Product-Key` / `X-Product-Service-Key`, never sent to a browser).
- `src/registry.ts`, `src/validation.ts`, `bin/product-registry.mjs` — the `deltcrm-product validate`/`register` CLI used in CI to validate and register a manifest.
- `src/hrms.ts`, `manifests/hrms.v1.json` — **explicitly marked deprecated v1 migration aliases**; the docs are emphatic that new products (Mail, POS) must not copy this pattern — they get a schema-v2 manifest in their *own* repo instead.
- `docs/HOW-IT-WORKS.md` / `ADD-A-PRODUCT.md` — the actual playbook: a new product installs the exact pinned SDK version, writes its own manifest, validates and registers it through CI, and implements the token guard + entitlement/permission enforcement. **No SDK release or Platform source change is required to add a product.**

The critical design point: this package must never contain Prisma clients, NestJS providers, database queries, or product business logic — and it must never contain another product's product key, permission, or manifest. It stays generic forever; HRMS, Mail and POS each own their own manifest in their own repo.

### 1.4 The five governing architecture decisions (ADRs), and current real status

`b2/HRMS/docs/architecture/decisions/ADR-001..005` are the actual binding rules right now:

1. **ADR-001 (Repository boundary)**: Platform and HRMS *currently still live in one monorepo*, separated only by composition roots + the contract package. A separate `deltcrm-hrms` repo is only created after "extraction-readiness" review — which is exactly the state you're in: `b2/HRMS` is a staged **extraction baseline**, explicitly marked "not yet approved for an independent production cutover" (`docs/EXTRACTION-STATUS.md`).
2. **ADR-002 (Database boundary)**: Platform owns identity/subscription/entitlement data; HRMS owns employee/attendance/leave/payroll data. Phase 1 has **not** split the database yet — same-DB reads are wrapped in a temporary adapter with a named removal owner. No product may query another's tables, ever, even during this transition.
3. **ADR-003 (Gateway/routing)**: one tenant host, locale-aware paths (`/{locale}/app/hrms`, `/api/hrms/*`), navigation driven by the Platform contract, not hardcoded.
4. **ADR-004 (Identity/SSO)**: Platform is the only auth authority; products only ever see short-lived audience-scoped RS256 tokens verified via JWKS; header hints like `X-Tenant-Id` are never trusted as authorization.
5. **ADR-005 (Event boundary)**: cross-product lifecycle changes go through versioned event envelopes + transactional outbox, idempotent by `eventId`; synchronous reads use versioned internal APIs with service auth, request IDs, and timeouts.

`CURRENT-PLATFORM-HRMS-COUPLING-INVENTORY.md` is the honest "what's still coupled and being unwound" ledger — e.g. a shared HMAC secret without product audience, HRMS reading tenant modules from the shared DB, signup provisioning tenant+HRMS+Attendance in one DB transaction. These are named, frozen (no *new* coupling allowed), and owned jointly for removal — this is the real, current state behind the idealized contract, and it matters for POS: **POS is being planned to skip this transitional coupling entirely** and go straight to the clean pattern (separate repo, separate DB, contract-only integration from day one), per the POS plan's Section 3.

---

## Part 2 — The complete POS plan, tied back to CRM and Product_Contract

This merges `POS-COMPLETE-PLAN.md` (architecture/build plan) and `POS-FEATURES-DETAILED.md` (plain-language feature list) that are already sitting in `Claude outputs`, cross-checked against the onboarding standard and the live HRMS implementation.

### 2.1 What POS is

An independently deployed product — own repo (`deltcrm-pos`), own database, own deployment, own team — that plugs into the exact same tenant workspace HRMS already plugs into. Not a module inside Platform, not a fork of HRMS. Platform continues to own identity/subscriptions/entitlements/navigation; POS owns catalog, inventory, registers, sales, payments, refunds, receipts, reporting. The two sides only ever talk through the versioned contract (`@mariya-abdul/deltcrm-product-contracts`).

A customer signs in once; if POS is entitled for their tenant, `/en/app/pos` (or `/ar/app/pos`) simply appears in navigation — same mechanism as HRMS.

### 2.2 The sign-in / access sequence (identical mechanism to HRMS)

1. User signs in once, through Platform.
2. Platform resolves tenant + membership from trusted server-side session state.
3. Platform loads the tenant's subscription and product entitlements.
4. Shared navigation shows POS only if the tenant/user is entitled.
5. Opening POS → Platform issues a short-lived JWT audienced `pos-api`.
6. The gateway routes the request to the POS deployment.
7. POS verifies the token against Platform's JWKS (signature, issuer, audience, expiry, `kid`).
8. POS re-checks capability + permission + tenant scope from verified claims — never from the request body.
9. POS reads/writes only its own database.

### 2.3 What POS may depend on, and what it must never do

**Allowed, from the contract package (exact pinned version, `--save-exact`, never `workspace:*`/`latest`):**
- `createRemoteJwksProductTokenVerifier({ issuer, audience: 'pos-api', jwksUrl, productKey: 'POS' })`.
- Types: `ProductManifestV2`, `ProductTokenClaims`, `StableIdentifiers`, `EffectiveEntitlements`, `ProductEntitlement`, `ProductProvisioningStatus`, `ProductLifecycleEvent`/`ProductEventEnvelope`, `ContractErrorEnvelope`.
- `ProductIntegrationClient` (generated subpath) for identity status, entitlements, provisioning status, tenant-member directory lookups, usage reporting.
- `canonicalizeProductManifest`/`productManifestHash`/`verifyProductManifestSignature` (used by CI at registration).
- The `deltcrm-product` CLI (`validate`, `register`).

**Allowed, from Platform at runtime — three channels only:**
- Verified `pos-api` JWTs via JWKS.
- Internal HTTP via `ProductIntegrationClient`, authenticated with a POS-scoped service credential (`X-Product-Key: POS`, `X-Product-Service-Key: <secret>`).
- Versioned lifecycle events (`platform.product.activation-requested.v1` etc.), consumed idempotently, with POS's own acknowledgement events published back.

**Forbidden, unconditionally:**
- Direct DB queries against Platform's, HRMS's, or any other product's database.
- Importing Platform/HRMS controllers, services, repositories, or Prisma clients.
- Copying the contracts SDK source, or depending on it via `workspace:*`/git branch/`latest`.
- Trusting `tenantId`/`userId`/roles/permissions/capabilities from a request payload instead of verified claims.
- Adding POS's product key/audience/permissions/manifest into the `Product_Contract` repo itself — that package must stay generic.
- Sending the POS service credential to any browser, mobile client, log, or URL.

**Open item to resolve before locking `minimumContractVersion`:** the contract package's own `package.json` currently says `2.2.0` while the runtime constant `PRODUCT_CONTRACT_VERSION` in `src/contracts.ts` still says `2.1.0`, and HRMS's own `apps/api/package.json` pins `2.0.1`. This mismatch has to be resolved with the contract owner and verified at runtime (`node -e "console.log(require('@mariya-abdul/deltcrm-product-contracts').PRODUCT_CONTRACT_VERSION)"`) before POS locks its manifest's `minimumContractVersion`.

### 2.4 The POS manifest (draft, schema-v2 — lives in POS's own repo, never in Product_Contract)

```json
{
  "schemaVersion": 2,
  "productKey": "POS",
  "manifestVersion": "0.1.0",
  "minimumContractVersion": "2.1.0",
  "displayName": "DeltCRM POS",
  "audience": "pos-api",
  "routes": { "webPath": "/{locale}/app/pos", "apiPrefix": "/api/pos/v1" },
  "navigation": { "key": "pos", "labelKey": "products.pos.name", "iconKey": "store",
                  "order": 30, "requiredPermission": "pos.sales.read", "requiredCapability": "POS_CORE" },
  "permissions": [ "pos.catalog.read/manage", "pos.inventory.read/manage (needs POS_INVENTORY)",
                   "pos.registers.read/manage", "pos.sales.read/create",
                   "pos.sales.refund (needs POS_REFUNDS)",
                   "pos.customers.read/manage (needs POS_CUSTOMERS)",
                   "pos.reports.read", "pos.reports.advanced.read (needs POS_REPORTING_ADVANCED)" ],
  "capabilities": [
    "POS_CORE (required, CORE)",
    "POS_INVENTORY (ADD_ON, depends on POS_CORE)",
    "POS_REFUNDS (ADD_ON, depends on POS_CORE)",
    "POS_CUSTOMERS (ADD_ON, depends on POS_CORE) — new, not yet confirmed",
    "POS_REPORTING_ADVANCED (ADD_ON, depends on POS_CORE) — new, not yet confirmed",
    "POS_MULTI_LOCATION (ADD_ON, depends on POS_CORE + POS_INVENTORY) — new, not yet confirmed"
  ],
  "limits": [ "POS_LOCATIONS (HARD)", "POS_REGISTERS (HARD)", "POS_SALES_PER_MONTH (METERED)" ],
  "lifecycle": {
    "mode": "EVENT",
    "consumes": ["platform.product.activation-requested.v1", ".suspension-requested.v1",
                 ".reactivation-requested.v1", ".deletion-requested.v1"],
    "publishes": ["pos.product.activated.v1", ".suspended.v1", ".reactivated.v1", ".deleted.v1"]
  },
  "health": { "livenessPath": "/healthz", "readinessPath": "/readyz" },
  "localization": { "supportedLocales": ["en", "ar"], "namespaces": ["pos"] }
}
```

This mirrors HRMS's real, live `manifest.v2.json` structure almost field-for-field (compare `hrms.payroll.manage` needing `HRMS_PAYROLL` to `pos.sales.refund` needing `POS_REFUNDS` — same dependency-gated permission pattern).

### 2.5 Feature scope (from POS-FEATURES-DETAILED.md, organized by priority)

**Must have from day one:** sales & checkout (item search/scan, cart, park/resume sale, custom items, split tender, discounts, tips, tax, offline queuing), product catalog (variants, categories, bundles, modifiers, barcodes, flexible units, pricing rules, bulk import), basic inventory (real-time stock, low-stock alerts, reorder points, POs, receiving, transfers, counts), registers (open/close cash reconciliation, cash drawer tracking, shift handover, multi-register), payments (cash/card/contactless/wallet, gift cards, store credit, split/partial, auto-reconciliation, secure handling), receipts (print/email/SMS, gift receipts, branding, reprint/lookup).

**Add soon after:** returns & refunds (full/partial, refund-to-original vs store credit, void vs refund, manager-approval threshold, reason tracking), staff & permissions (PIN/login per cashier, role-based gating, manager approvals, performance tracking), basic reporting (daily summary, per-register/cashier).

**Add once basics are proven:** customer management & loyalty (profiles, purchase history, points/tiers, consent), advanced reporting (margin/staff/inventory-valuation/promo-effectiveness/COGS), multi-location support (centralized catalog + local overrides, location reporting, cross-location stock visibility, transfers).

**Add based on demand:** notifications/alerts (low-stock, EOD summary, unusual-activity flags), accounting sync, e-commerce sync/pickup, food-service-specific features (table management, kitchen display, modifiers, delivery aggregation).

**Explicitly deferred/flagged, not v1:** restaurant/food-service vertical features and omnichannel/appointment/social-selling patterns — the plan assumes **retail** scope; this must be confirmed before scaffolding since it changes the domain model.

**Cross-cutting engineering requirements (not commercial features but required):** staff PIN clock-in independent of Platform roles for POS-specific action gating; offline resilience (queue writes locally, sync on reconnect); hardware adapters as a pluggable layer (barcode scanner, receipt printer, cash drawer, card reader, customer display) — never hardcoded; full audit/outbox trail on every mutation (tenant, actor, correlation id).

### 2.6 Folder structure (modeled directly on the live HRMS repo shape)

```
deltcrm-pos/
├── apps/
│   ├── api/ (NestJS)
│   │   └── src/products/pos/        ← ALL POS domain code lives here
│   │       ├── pos-product-token.guard.ts        (build FIRST — the trust boundary)
│   │       ├── pos-platform-contract.adapter.ts  (build FIRST — talks to Platform via SDK)
│   │       ├── platform/ authorization/ bootstrap/ database/
│   │       ├── catalog/ inventory/ registers/ sales/ payments/ refunds/
│   │       ├── receipts/ customers/ reports/ worker/
│   │   └── src/shared/  (http, config, observability, storage — copied near-verbatim from HRMS)
│   ├── web/ (Next.js, App Router, [lang] routing → /{locale}/app/pos)
│   └── worker/ (optional standalone)
├── packages/contracts/  packages/ui/
├── product/manifest.v2.json
├── docs/, .env.example, .npmrc, AGENTS.md, package.json, pnpm-workspace.yaml, turbo.json, docker-compose.yml
```

### 2.7 Tech stack (matched to what CRM/HRMS already run, for operational consistency)

- **Monorepo**: pnpm workspaces + Turborepo, Node 22.
- **API**: NestJS 11 (+cqrs/jwt/passport/swagger), Prisma 7 + `@prisma/adapter-pg` on its own Postgres (never shared), Redis/`ioredis` + `bullmq` for jobs, `@aws-sdk/client-s3` for private tenant-prefixed storage, `@casl/ability`+`@casl/prisma` for fine-grained authorization (mirrors HRMS's permission-guard pattern), OpenTelemetry + Sentry + pino for observability, `class-validator`/`class-transformer`, `luxon` for timezone-safe shift/register dates, Jest+Supertest.
- **Web**: Next.js 16 + React 19, Tailwind 4 + shadcn/ui, `next-intl` for en/ar + RTL, `zustand` for cart/register state, `axios` to the POS API only (never direct to Platform), Playwright e2e.
- **Infra**: Docker Compose (Postgres/Redis/minio/api/web) matching `docker-compose.hrms-local.yml`'s shape; separate DB credential and service key per product, rotated via secret manager; `/healthz` + `/readyz` wired for Platform's health aggregation.

### 2.8 Decisions that must be closed before scaffolding

| Decision | Suggested default | Why |
|---|---|---|
| Retail vs. food-service scope | Retail | Changes the domain model materially |
| Product key / audience | `POS` / `pos-api` | Immutable after first production registration |
| Web path / API prefix | `/{locale}/app/pos` / `/api/pos/v1` | Immutable after first registration |
| Locales | `en`, `ar` | Matches every other product |
| Repo name | `deltcrm-pos` | Convention |
| SDK version to pin | Resolve 2.1.0 vs 2.2.0 mismatch first | Blocks `minimumContractVersion` |
| Database | Separate Postgres, POS-owned | Non-negotiable per contract's tenant-isolation model |
| Deployment | Independent API + web services | Independent scaling/rollback |
| Owning team / on-call | TBD | Needed before release checklist sign-off |

### 2.9 Suggested build order

1. Close the decisions above with the product owner.
2. Scaffold the repo from 2.6, copying HRMS's `apps/api`/`apps/web` shape, stripping HRMS domain code to nothing.
3. Install the pinned SDK version; confirm with the runtime check in 2.3.
4. Write and validate `product/manifest.v2.json` with `deltcrm-product validate`.
5. Build the trust boundary first: token guard → platform adapter → permission guard — before any business feature.
6. Build POS_CORE modules in order: catalog → registers → sales → payments → receipts.
7. Wire lifecycle event consumption (idempotent activation/suspension/reactivation/deletion) + `/healthz`/`/readyz`.
8. Build add-ons in priority order: inventory → refunds → customers → advanced reporting → multi-location.
9. Run the full test matrix (token security, entitlement/capability/permission layering, tenant isolation, lifecycle idempotency, SSO/routing, ops) from the handoff doc's test-plan section.
10. Register the manifest through CI, hand deployment/commercial config to Platform ops, activate a pilot tenant.

### 2.10 Open items still needing an answer

- Confirm retail-vs-food-service scope — this plan assumes retail.
- Confirm the three new proposed capabilities (`POS_CUSTOMERS`, `POS_REPORTING_ADVANCED`, `POS_MULTI_LOCATION`) with the product owner — they aren't in the original handoff draft.
- Confirm payment-processor vendor — the stack deliberately keeps this as a pluggable adapter.
- Resolve the SDK version mismatch (2.1.0 / 2.2.0 / HRMS's pinned 2.0.1) before locking `minimumContractVersion`.

---

## Bottom line

- **b1/CRM (Platform)** is the control plane: identity, subscriptions, entitlements, navigation, product registry, token issuance, provisioning orchestration. It is currently still one monorepo with HRMS, mid-extraction, with named/frozen temporary coupling.
- **Product_Contract** is the generic, versioned npm package that is the *only* legal channel between Platform and any product — manifest schema, token verifier, typed HTTP client, event envelope types. It must never contain a specific product's business logic or identifiers.
- **b2/HRMS** is the first product built against this pattern — a live, working example of exactly the mechanism POS is meant to copy: its own manifest, its own token guard, its own database (in progress), entitlement-gated permissions and capabilities, event-driven lifecycle.
- **POS**, per the plan already drafted in `Claude outputs`, should be built as a fully independent product from day one (skipping the transitional monorepo coupling HRMS is still unwinding), using the identical contract mechanism — same token flow, same manifest shape, same capability/permission/limit model, same folder layout — with retail scope, its own Postgres database, and a small list of decisions (SDK version, new capability names, payment processor, scope confirmation) that need to be closed before scaffolding begins.
