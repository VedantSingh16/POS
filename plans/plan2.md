# Plan 2: From Foundation to Pilot and Full Approved Scope

Prepared: 6 October 2026
Follows: `plan1.md` (Organisation Administrator Foundation)
Scope source: `completefeaturelist.md` (138 approved features. Anything not listed there is out of scope)
Integration source: `POS-CRM-Product_Contract-Connection-Plan.md`, `POS-CRM-Connection-Phased-Implementation-Plan.md`, `HRMS-CRM-ProductContract-POS-Analysis.md`, `product/manifest.v2.json`

---

## 1. How Plan 1 and Plan 2 fit together

```text
Plan 1 — Organisation Administrator Foundation   (Phases 0–8, implemented; close-out gaps listed in plan1.md)
   │
Plan 2 — this document
   ├── Stage A  Correct and platform-aligned foundation      Phases 0–1
   ├── Stage B  POS_CORE: catalogue → registers → sales      Phases 2–6
   ├── Stage C  Core add-ons: inventory → refunds → reports  Phases 7–9
   ├── Stage D  Pilot go-live                                Phase 10    ◄── Milestone 1: all 26 Essential features
   ├── Stage E  Remaining Recommended features               Phases 11–13 ◄── Milestone 2: all Recommended features
   ├── Stage F  Advanced features                            Phases 14–20 ◄── Milestone 3
   └── Stage G  Optional features                            Phase 21    ◄── Milestone 4: all 138 features
```

Plan 1's phases are numbered 0–8 and are finished. Plan 2's phases are numbered 0–21 and refer only to this document. Each Plan 2 phase starts only when the previous phase's exit criteria pass.

## 2. Ordering rules (why each phase sits where it does)

The order below is derived from four rules, applied in this priority:

| Rule | Source | Effect |
|---|---|---|
| **R1. Dependencies first** | `Dependencies` column of the feature list, plus data dependencies (for example, a return needs a completed sale) | A feature is never planned before what it depends on |
| **R2. Trust boundary before business features** | Connection Plan §6 ("build before any business feature"); Analysis §2.9 step 5 | Platform alignment (Phase 1) precedes all new modules |
| **R3. Priority order** | Feature-list priorities: Essential → Recommended → Advanced → Optional | An Advanced feature is pulled earlier only when an Essential or Recommended feature depends on it (one case: 12.6) |
| **R4. Documented module order** | Analysis §2.9 steps 6–8: catalogue → registers → sales → payments → receipts → lifecycle → inventory → refunds → customers → advanced reporting → multi-location | Decides the order between modules of the same priority |

Consequences of these rules:
- **Inventory comes after checkout, not before.** The manifest draft makes `POS_INVENTORY` an add-on to `POS_CORE`, so a sale must work for tenants without inventory (R4). Checkout therefore publishes a `sale.completed` event from day one, and the inventory phase consumes it.
- **Approvals come before returns.** Returns need high-value approval (8.12), and discounts need manager approval (3.5). Both depend on the approval state (12.5) and thresholds (12.6) (R1).
- **Store credit (8.5) moves to the customer phase.** A wallet needs a customer (R1).
- **The pilot covers Essentials plus the Recommended features of `POS_CORE`, `POS_INVENTORY` and `POS_REFUNDS`.** The customer, multi-location and promotion features follow in Stage E (R3, R4).

## 3. Verified current state (6 October 2026)

Code reviewed: `apps/api/src/**`, `apps/api/test/**`, `apps/web/app/**`, `product/manifest.v2.json`, `docker-compose.yaml`, `.env.example`.

| Status | Count | Features |
|---|---|---|
| Done | 3 | 4.1, 12.1, 12.2 |
| Partial | 11 | 2.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.6, 7.1, 12.3, 12.4 |
| Schema only | 3 | 2.2, 5.5, 5.13 |
| Not started | 121 | everything else |

Of the 26 Essential features, 3 are done, 7 are partial and 16 are not started. The 16 include checkout, the stock ledger, register open/close and returns.

Platform integration: the contract package `2.2.0` is installed and the manifest is drafted. The manifest has only `POS_CORE`, seven `pos.*` permissions and the `POS_REGISTERS` limit. **No integration code exists.**

The test suite (3 e2e specs) could not be executed during this review (Windows `node_modules`). Re-run it locally as the first task of Phase 0.

## 4. Decisions required, and the phase each one blocks

| # | Decision | Recommended default (with source) | Blocks |
|---|---|---|---|
| D1 | Identity model: POS-native login (Plan 1) vs Platform-issued tokens | Platform token for all users in production. POS keeps a **staff PIN for till action gating** and native login only for local development (Analysis §2.1, §2.5 cross-cutting) | Phase 1 |
| D2 | Registration model (self-contained manifest vs central registry) and contract version (2.2.0 / 2.1.0 / 2.0.1 mismatch) | Self-contained schema-v2, as HRMS runs today; version confirmed by the contract owner (Connection Plan §0, §2) | Phase 1 |
| D3 | v1 capabilities: `POS_CORE`, `POS_INVENTORY`, `POS_REFUNDS` confirmed; `POS_CUSTOMERS`, `POS_REPORTING_ADVANCED`, `POS_MULTI_LOCATION` unconfirmed | Declare only what the pilot ships: CORE, INVENTORY, REFUNDS (Phased Plan Phase 0) | Phase 1 |
| D4 | Business scope | Retail (Analysis §2.8) | Phase 2 |
| D5 | Tax jurisdiction for 4.8 | India GST: GSTIN, HSN/SAC, CGST/SGST/IGST (organisation currency is INR) | Phase 4 |
| D6 | Tenders. Payments are not a numbered feature, but 8.4, 11.3 and 14.6 require them | Cash, card and UPI **recorded** (no terminal integration), plus split tender | Phase 4 |
| D7 | Receipt output | Browser print of an A4/80 mm tax invoice; ESC/POS later | Phase 4 |
| D8 | Customer ownership: POS-owned vs synced from Platform/CRM | Decide before Phase 11 | Phase 11 |

**Out of scope by the approved list.** These are not listed, so they are not planned. Raise them with the product owner if wanted:
- Offline selling
- Gift cards (the module title mentions them, but no feature is listed)
- Purchase orders and supplier receiving (6.4 and 14.7 mention them)
- Physical stock counts
- Card-terminal integration
- E-commerce sync
- Food-service features

---

## 5. Stage A — Correct and platform-aligned foundation

### Phase 0 — Plan 1 close-out and production persistence

**Why first:** every later phase builds on these components, and some of the gaps are security defects.

| # | Gap | Where | Fix |
|---|---|---|---|
| 0.1 | Store-scoped role grants never match: the guard passes no `storeId` | `auth/permissions.guard.ts` | Add a `@StoreScope(source)` decorator (route param, body or `X-Store-Id`); the guard calls `assertPermissions(user, perms, storeId)` and `assertStoreAccess` |
| 0.2 | Store and register lists ignore the user's store access | `admin.service.ts` `listStores`, `listRegisters` | Filter by `context.storeIds` unless the grant is organisation-scoped |
| 0.3 | No failed-login lockout (Plan 1 Phase 2) | `auth.service.ts` `login` | `failed_attempts` and `locked_until` on users, login throttling, stricter for PIN |
| 0.4 | Login is ambiguous when an email exists in two organisations | `auth.service.ts` lines 28–39 | Require `organizationSlug`, or reject when more than one row matches |
| 0.5 | Admin cannot reset another user's password or PIN (Plan 1 Phase 6) | no endpoint | `POST /users/:id/reset-credentials` that forces a change at next login, audited |
| 0.6 | Custom roles cannot be disabled (Plan 1 "disable unused custom roles") | `updateRole` | Accept `status`; block disabling a role that is still assigned, or require reassignment |
| 0.7 | No effective-access review for another user (Plan 1 Phase 6) | no endpoint | `GET /users/:id/effective-access` (permission, source role, scope) |
| 0.8 | User lifecycle has no `INVITED` state; sessions have no idle timeout | users, sessions | Add the `INVITED` state; add `last_seen_at` with an idle expiry |
| 0.9 | Catalogue is create-only; product and variant `status` accept any string; price changes are not auditable (Plan 1 Phase 8 criteria) | `admin.service.ts` catalogue methods | Status enums now. Edit endpoints and price history are delivered in Phase 2 |
| 0.10 | Audit entries have no before/after values | `audit()` | Store `before` and `after` in `metadata_json` for every update |
| 0.11 | Persistence is SQLite with an in-code schema and no migrations. Plan 1 says to replace it before go-live, and `docker-compose.yaml` and `.env.example` already provision Postgres and Redis | `database.service.ts` | Write a Prisma schema, take a baseline migration, move repositories to Prisma on `DATABASE_URL`, and keep the e2e suite running against a disposable Postgres. **Done now because Phases 3–4 introduce money and ledger tables** |
| 0.12 | Request bodies are untyped `Record<string, unknown>` | controllers | Validation DTOs |
| 0.13 | Plan 1 Phase 8 test matrix is only partly covered | `test/` | Add e2e tests: cross-organisation isolation, concurrent store creation at the limit, store-scoped denial, disabled and suspended login, last-admin protection via role change |
| 0.14 | All Plan 1 work is uncommitted; README is boilerplate | git | Commit, branch per phase, add CI (lint, typecheck, unit, e2e) |
| 0.15 | Permission catalogue covers admin functions only (12.4 partial) | `PERMISSIONS` in `database.service.ts` | Define the operational permission set used by Phases 3–9 (sales, discount, void, price override, refund, cash, inventory, approval, reports, export). Each permission is enforced in the phase that ships its feature |

Features completed: 12.3 and 12.1–12.2 hardening; 12.4 catalogue defined.
Exit criteria: all new e2e tests pass on Postgres; a store-scoped cashier sees and acts only on assigned stores; lockout works and is audited; CI is green on a committed baseline.

### Phase 1 — Platform trust boundary (POS side)

**Why here:** R2. The connection plan requires the trust boundary before any business feature, and the decisions in D1–D3 change how users, organisations and permissions are identified. Building checkout first would mean re-plumbing it later.

This phase covers Connection-Plan Steps 0–6, which are Phased-Plan Phases 0–5. Registration and lifecycle (Phased-Plan Phases 6–7) follow in Phase 6 of this plan, once there is a product to register.

1. Close D1–D3 in writing (`docs/decisions.md`).
2. Pin the agreed contract version with `--save-exact` and set `minimumContractVersion` to match.
3. Move all routes under the manifest prefix `/api/pos/v1` (immutable after registration). Add `/healthz` and `/readyz` (declared in the manifest, currently missing).
4. Finish the manifest **before** first registration:
   - capabilities agreed in D3
   - the `pos.*` permission set covering Phase 0.15 (key names are immutable once registered)
   - limits `POS_LOCATIONS` (store quota) and `POS_REGISTERS`
5. Write `pos-product-token.guard.ts` with `createRemoteJwksProductTokenVerifier` (issuer, audience `pos-api`, expiry, `kid` refresh once).
6. Write `pos-platform-contract.adapter.ts` with `ProductIntegrationClient` behind `ProductPlatformPort`, failing closed (`PLATFORM_CONTRACT_UNAVAILABLE`).
7. Map identities:
   - Plan 1 `organization` becomes the Platform `tenantId`.
   - The POS staff profile is keyed by Platform `userId` and holds store assignments, default store and PIN.
   - The Platform permission claims map to the internal permission codes.
   - Plan 1 native login is kept behind `POS_AUTH_MODE=local` for development only.
8. Make the entitlements read from Platform:
   - The store quota (`organization_entitlements.max_stores`, currently from `.env`) comes from the `POS_LOCATIONS` limit.
   - The register quota (`POS_REGISTERS`, declared but **not enforced today** in `createRegister`) is enforced the same way as the store quota.
9. Make `requireCapability` / `requirePermission` part of the same guard chain as Phase 0.1.
10. Add environment variables to `.env.example`: `PLATFORM_INTERNAL_BASE_URL`, `PLATFORM_PUBLIC_BASE_URL`, `PLATFORM_JWKS_URL`, `PRODUCT_TOKEN_ISSUER`, `POS_PLATFORM_SERVICE_KEY` (secret, server only).
11. Move the web app to `/{locale}/app/pos` routing (en/ar, RTL) and split `page.tsx` into routes.

Exit criteria: the Phased-Plan Phase 4 tests pass (valid token accepted; wrong audience, expired token, missing permission and missing capability rejected; Platform unreachable fails closed). Store and register limits come from entitlements. The admin UI works in both `local` and `platform` auth modes.

---

## 6. Stage B — POS_CORE (R4 order: catalogue → registers → sales → payments → receipts)

### Phase 2 — Catalogue completion

Features: 2.1, 2.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.13, 5.16
Depends on: Phase 0 (migrations, audit before/after), Phase 1 (routes and permissions).

- **Product master (5.1):** cost, HSN/SAC, product type `STOCK` / `SERVICE` / `NON_STOCK` (5.9), `track_inventory` flag, full edit and deactivate endpoints.
- **Categories (5.2):** edit, move and deactivate, with hierarchy cycles prevented.
- **Brands and manufacturers (5.3):** master tables in place of the free-text `brand`.
- **Variants (5.4):** attribute axes and values (size, colour, …); variant matrix generation.
- **Barcodes (5.5):** add and remove multiple per variant, unique per organisation.
- **UOM (5.6):** conversions (pack → each), with decimal rules enforced.
- **Images (5.7):** object-storage upload with tenant-prefixed keys, ordering and a primary image.
- **Lifecycle (5.13):** `DRAFT` → `ACTIVE` ↔ `SEASONAL` → `DISCONTINUED`, plus `BLOCKED`. Only `ACTIVE` and `SEASONAL` are sellable.
- **Prices (2.1, 2.2):** `variant_prices` becomes append-only history (`effective_from` / `effective_to`). One `PricingService.resolve(variant, store)` applies location price first, then base price. This service is the extension point for 2.5–2.8 later.
- **Bulk import and edit (5.16):** upload CSV/XLSX → map columns → row-level validation preview → atomic commit; update mode keyed by SKU; export.

Exit criteria: a spreadsheet of products, variants, barcodes and prices imports with row errors reported and nothing partially committed. Every price and catalogue change is in history and audit. A store price overrides the base price.

### Phase 3 — Register sessions & cash

Features: 11.1, 11.2, 11.3, 11.4, 11.5
Depends on: Plan 1 registers, Phase 0 store scoping. It precedes checkout because a sale must belong to an open session (R4: registers → sales).

- `register_sessions` (one OPEN per register, enforced by a unique partial index): opening float, expected, counted and variance, plus a denomination count.
- `cash_movements`: float, sale cash, refund cash, paid-in/out with reason (11.4), drop/pickup (11.5). The theoretical drawer balance is derived from movements (11.3).
- Open, X-summary, blind close and Z-summary endpoints and screens; reason codes master (typed, reused later by 3.6 and 8.10).

Exit criteria: open, move cash and close produces an exact expected-vs-counted variance. A second open on the same register is refused.

### Phase 4 — Checkout, payments and receipts

Features: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 1.11, 1.12, 1.13, 1.14, 4.1, 4.2, 4.3, 4.7, 4.8
Depends on: Phase 2 (sellable catalogue, price resolution, UOM decimals for 1.11) and Phase 3 (open session). Decisions D5–D7.

- **Data:** `sales`, `sale_lines` (snapshots of name, SKU, price, tax and UOM; decimal quantity; note), `sale_payments`, `tender_types`, `document_sequences` (gap-free per store and series).
- **Tax engine (4.1–4.3):** `TaxService` with inclusive back-out and exclusive add-on, a per-component breakdown (GST split per D5) and a documented rounding policy, covered by golden-file tests.
- **Cash rounding (4.7):** setting for the increment, applied to cash tenders only, recorded as a separate amount.
- **Scanning (1.2):** exact barcode, internal codes, weight- and price-embedded EAN prefixes (configurable), QR → SKU.
- **Search (1.3):** name, SKU, barcode, category, brand, variant and PLU.
- **Cart (1.6), variants (1.9), weighted quantity (1.11), notes (1.12)**.
- **Hold and resume (1.7)** on any authorised register in the same store.
- **Completion:** one transaction that runs a server-side recalculation, allocates the number, records payments, writes the cash movement and an **outbox event `sale.completed`**, and is idempotent on a client-generated sale ID.
- **Receipts / tax invoice (4.8):** print view and reprint.
- **Till UI** (`/{locale}/app/pos/register`): quick-key tiles (1.4, configured in admin), image and category grid (1.5), keyboard map (1.13), touch/tablet layout (1.14), and PIN user switch (D1).

Exit criteria: open register → scan and search → variant and weighted items → hold and resume elsewhere → split payment → tax invoice → close register, with cash reconciling exactly. Tax golden tests pass. Retried completion never duplicates a sale.

### Phase 5 — Approvals and discount controls

Features: 12.5, 12.6 (Advanced, pulled forward by R1 for 3.5 and 8.12), 3.5, 3.6, 4.5, 4.6
Depends on: Phase 4 (sale lines to discount and charge). It precedes returns because 8.12 needs it.

- `approval_policies` (action × scope × allow / require / deny × thresholds by amount, percent or quantity) and `approvals` (requester, approver, method, context, reference).
- One `ApprovalService.check()` reused by every later phase, with a manager-PIN override at the till.
- Manual line and order discounts that need a reason code (3.6) and approval when over threshold (3.5).
- Service charge (4.5) and delivery/handling fee (4.6) as taxable charge lines.

Exit criteria: a discount under the threshold passes; one over the threshold needs a manager PIN and records reason and approver; a denied action is refused server-side even if the UI is bypassed.

### Phase 6 — Platform registration and lifecycle

Features: none (integration). Phased-Plan Phases 6–7 (Analysis §2.9 step 7: "after POS_CORE modules").

- Register the manifest through CI with the registration-only credential. Platform ops configures the plan and capability grants.
- Lifecycle consumer for `platform.product.activation|suspension|reactivation|deletion-requested.v1`:
  - deduplicated by `eventId`
  - activation creates the tenant's POS defaults (organisation row, settings, system roles, default store/stock location)
  - suspension blocks access and never deletes data
  - failures go to a dead-letter queue
  - publishes `pos.product.*.v1` acknowledgements via an outbox (Redis/BullMQ worker, already provisioned in docker-compose)

Exit criteria: activating POS for a test tenant creates exactly one tenant projection even with duplicate delivery; suspension and reactivation converge; acknowledgements are visible in Platform.

---

## 7. Stage C — Core add-ons (R4 order: inventory → refunds → reporting)

### Phase 7 — Inventory ledger (`POS_INVENTORY`)

Features: 6.1, 6.6, 6.7, 6.8, 6.10, 6.12, 7.1
Depends on: Phase 4 (`sale.completed` events) and Phase 5 (approvals, reused when 6.9 arrives in Phase 14).

- `inventory_movements`, append-only (6.10): location, variant, decimal quantity, stock status, type, reference, reason, unit cost, actor. Add nullable `serial_id` and `lot_id` now so Phase 19 does not need a breaking migration.
- `inventory_balances` per location, variant and **status** (`SELLABLE` / `DAMAGED` / `QUARANTINE`, 6.6), updated in the same transaction as the movement.
- Consumer of `sale.completed` posts `SALE` movements for `track_inventory` items only when the tenant has `POS_INVENTORY` (6.1); opening-balance import provides the cutover.
- Negative-stock policy `ALLOW` / `WARN` / `BLOCK` (6.7), checked at checkout when the capability is active.
- Adjustments with reason codes (6.8), locations API for store, warehouse, stockroom and virtual locations (7.1), reorder point and safety stock per location (6.12).

Exit criteria: balances always equal the sum of movements (property test). A sale reduces stock only for inventory-enabled tenants. The block policy prevents an oversell. Concurrent postings lose nothing.

### Phase 8 — Returns and refunds (`POS_REFUNDS`)

Features: 8.1, 8.2, 8.3, 8.4, 8.9, 8.10, 8.11, 8.12
Depends on: Phase 4 (original sale and tenders), Phase 5 (8.12 approval) and Phase 7 (8.11 restock into a status).

- Receipt lookup (8.1); partial quantities capped at the remaining returnable quantity (8.2).
- Eligibility rules: window, category exclusions, condition (8.9). Reason codes (8.10). Restock decision to sellable, damaged, quarantine or vendor-return (8.11). High-value approval (8.12).
- Refund to the original tender, capped per tender (8.4). Cash refunds hit the session cash. A credit note is issued (4.8 document type).
- Exchange (8.3): a return and a new sale settled as one transaction for the net amount.

Exit criteria: a partial return followed by a second return can never exceed the sold quantity; damaged returns never enter sellable stock; cash refunds reconcile in the register close; a credit note is issued.

### Phase 9 — Store close, reporting and alerts v1

Features: 6.11, 11.6, 12.10, 13.1, 13.2, 13.5, 14.1, 14.2, 14.3, 14.4, 14.6, 14.9
Depends on: Phases 3, 4, 7 and 8 (the data being reported). Analysis §2.5 places "basic reporting" in the same tier as refunds.

- **End-of-day close (11.6):** consolidates registers, tenders, tax and exceptions; refuses to close while any register is open.
- **Reports with one filter model (13.2):** date range, store, register, user, category. Reports covered: cash reconciliation (13.1), staff sales performance (12.10), sales, tax, returns, discounts and stock on hand. Export to CSV, XLSX and PDF behind the `export` permission (13.5).
- **Dashboards:** owner (14.1) and store manager (14.2).
- **Alerts v1:** `alerts` table and job runner (BullMQ). Covers low and out-of-stock against reorder points (6.11, 14.3), cash variance (14.4), failed completion, sync or lifecycle event (14.6), and register not closed (14.9). Delivered in-app, with email optional.

Exit criteria: an automated reconciliation test proves every report total equals the underlying sales, payment, cash and ledger rows; every alert fires on a seeded scenario.

---

## 8. Stage D — Pilot

### Phase 10 — Pilot readiness and go-live

Features: none. Phased-Plan Phases 8–10.

- Run the full Connection-Plan §9 test matrix: tokens, entitlement layering, tenant isolation, provisioning idempotency, fail-closed, en/ar routing.
- Observability: token failures, denials, Platform latency, lifecycle lag, dead letters, `/healthz` and `/readyz`, trace propagation.
- Prove backup and restore, and run one real rollback rehearsal (additive migrations only).
- Load test: a full store trading day with concurrent tills.
- Activate one pilot tenant, then widen.

**Milestone 1:** all 26 Essential features plus the Recommended features of core, inventory, refunds and basic reporting are live. That is 71 features.

---

## 9. Stage E — Remaining Recommended features (R3, then R4: customers → multi-location)

### Phase 11 — Customers and loyalty basics (`POS_CUSTOMERS`)

Features: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 2.5, 8.5, 10.1, 10.2
Depends on: D8, Phase 4 (attach to sale), Phase 8 (returns to credit).
- Profiles, quick-create at the till, history, notes and tags, consent records, groups.
- Group price lists in `PricingService` (2.5).
- Wallet ledger for store credit (8.5).
- Points earn and redeem ledger (10.1, 10.2).

### Phase 12 — Pricing rules, coupons and bundles

Features: 2.6, 3.1, 3.4, 1.10, 5.8
Depends on: Phase 11 (per-customer limits in 3.4) and Phase 7 (component stock deduction for 1.10).
- Quantity breaks; coupon codes with eligibility and usage limits.
- Bundle bill-of-materials definitions and selling with component deduction, with proportional value allocation so returns work.

### Phase 13 — Multi-location stock and transfers (`POS_MULTI_LOCATION`)

Features: 6.2, 6.3, 6.4, 6.5, 7.3, 7.5, 7.6, 7.7, 7.8
Depends on: Phase 7.
- Reservations and available stock.
- Transfer documents: request → dispatch → in transit → receive, with partial quantities. In-transit and incoming balances are derived from open transfers.

**Milestone 2:** all 68 Recommended features are live (95 features in total).

---

## 10. Stage F — Advanced features (dependency order)

| Phase | Name | Features | Depends on |
|---|---|---|---|
| 14 | Advanced controls | 1.8, 4.4, 6.9, 8.8, 8.14, 14.5 | Approvals (5), inventory (7), customer identification (11) |
| 15 | Advanced pricing & promotions | 2.3, 2.4, 2.7, 2.8, 3.2, 3.3 | Pricing service (2, 11, 12), job scheduler (9), channel master (new), customer agreements (11) |
| 16 | Advanced reporting & exception workflow (`POS_REPORTING_ADVANCED`) | 6.13, 6.14, 6.15, 13.3, 13.4, 14.10, 14.11 | Ledger history (7), job/notification service (9) |
| 17 | Customer 360 & advanced loyalty | 9.7, 9.8, 10.3, 10.4, 10.5 | Customers and loyalty (11), analytics (16) |
| 18 | Advanced multi-location | 7.2, 7.4, 7.9, 8.6, 14.7 | Transfers (13), returns (8) |
| 19 | Traceability & regulated goods | 5.10, 5.11, 5.12, 5.14, 5.15, 8.13, 14.8 | Ledger `serial_id` / `lot_id` (7), returns (8) |
| 20 | Enterprise & omnichannel | 7.10, 8.7, 12.11 | Multi-entity accounting rules, an omnichannel order source and a commission/payroll interface (all external prerequisites to be scoped first) |

**Milestone 3:** all 40 Advanced features are live.

## 11. Stage G — Optional features

| Phase | Name | Features | Depends on |
|---|---|---|---|
| 21 | Workforce | 12.7, 12.8, 12.9, 12.12 | HR/payroll integration. Under the contract rules this must go through Platform, never a direct call to HRMS |

**Milestone 4:** all 138 approved features are live.

---

## 12. Immediate next actions

1. Commit Plan 1, run `pnpm --filter api test:e2e` locally and record the result.
2. Send D1–D3 to the Platform/contract owner and D4–D7 to the product owner.
3. Start Phase 0 with gaps 0.1/0.2 (store scoping) and 0.11 (Postgres/Prisma), because every later phase depends on them.

---

## Appendix A — Traceability: all 138 approved features

Status is the verified state on 6 October 2026. Phase refers to Plan 2.

| Ref | Feature | Priority | Status today | Plan 2 phase |
|---|---|---|---|---|
| 1.1 | New / quick sale | Essential | Not started | 4 |
| 1.2 | Barcode / QR scanning | Essential | Not started | 4 |
| 1.3 | Product search | Essential | Not started | 4 |
| 1.4 | Quick keys / favorites | Recommended | Not started | 4 |
| 1.5 | Visual product grid | Recommended | Not started | 4 |
| 1.6 | Cart management | Essential | Not started | 4 |
| 1.7 | Hold / suspend / resume | Essential | Not started | 4 |
| 1.8 | Open price product | Advanced | Not started | 14 |
| 1.9 | Product variants | Essential | Not started | 4 |
| 1.10 | Bundles / kits / combos | Recommended | Not started | 12 |
| 1.11 | Weighted / measured sales | Recommended | Not started | 4 |
| 1.12 | Line notes / order notes | Essential | Not started | 4 |
| 1.13 | Fast keyboard shortcuts | Recommended | Not started | 4 |
| 1.14 | Touch/mobile POS | Recommended | Not started | 4 |
| 2.1 | Base retail price | Essential | Partial | 2 |
| 2.2 | Location-specific price | Recommended | Schema only | 2 |
| 2.3 | Channel-specific price | Advanced | Not started | 15 |
| 2.4 | Customer-specific price | Advanced | Not started | 15 |
| 2.5 | Customer-group / tier price | Recommended | Not started | 11 |
| 2.6 | Quantity / volume pricing | Recommended | Not started | 12 |
| 2.7 | Time-based pricing | Advanced | Not started | 15 |
| 2.8 | Cost-plus pricing | Advanced | Not started | 15 |
| 3.1 | Promo / coupon code | Recommended | Not started | 12 |
| 3.2 | Location/channel promotion | Advanced | Not started | 15 |
| 3.3 | Promotion stacking | Advanced | Not started | 15 |
| 3.4 | Usage limits | Recommended | Not started | 12 |
| 3.5 | Promotion approval | Recommended | Not started | 5 |
| 3.6 | Discount reason codes | Recommended | Not started | 5 |
| 4.1 | Tax groups | Essential | Done | 4 |
| 4.2 | Tax-inclusive pricing | Essential | Partial | 4 |
| 4.3 | Tax-exclusive pricing | Essential | Partial | 4 |
| 4.4 | Tax override | Advanced | Not started | 14 |
| 4.5 | Service charge | Recommended | Not started | 5 |
| 4.6 | Delivery / handling fee | Recommended | Not started | 5 |
| 4.7 | Cash rounding | Recommended | Not started | 4 |
| 4.8 | Tax invoice / credit note | Recommended | Not started | 4 |
| 5.1 | Product master | Essential | Partial | 2 |
| 5.2 | Categories | Essential | Partial | 2 |
| 5.3 | Brands / manufacturers | Recommended | Partial | 2 |
| 5.4 | Variants | Essential | Partial | 2 |
| 5.5 | Multiple barcodes | Recommended | Schema only | 2 |
| 5.6 | Units of measure | Recommended | Partial | 2 |
| 5.7 | Product images | Recommended | Not started | 2 |
| 5.8 | Bundles / kits | Recommended | Not started | 12 |
| 5.9 | Services / non-stock | Recommended | Not started | 2 |
| 5.10 | Serialized products | Advanced | Not started | 19 |
| 5.11 | Lot / batch products | Advanced | Not started | 19 |
| 5.12 | Expiry-controlled products | Advanced | Not started | 19 |
| 5.13 | Product lifecycle state | Recommended | Schema only | 2 |
| 5.14 | Country of origin / customs fields | Advanced | Not started | 19 |
| 5.15 | Warranty profile | Advanced | Not started | 19 |
| 5.16 | Bulk import / edit | Recommended | Not started | 2 |
| 6.1 | Real-time on-hand stock | Essential | Not started | 7 |
| 6.2 | Available stock | Recommended | Not started | 13 |
| 6.3 | Reserved / committed stock | Recommended | Not started | 13 |
| 6.4 | Incoming stock | Recommended | Not started | 13 |
| 6.5 | In-transit stock | Recommended | Not started | 13 |
| 6.6 | Damaged / quarantine stock | Recommended | Not started | 7 |
| 6.7 | Negative stock control | Recommended | Not started | 7 |
| 6.8 | Stock adjustments | Essential | Not started | 7 |
| 6.9 | Adjustment approval | Advanced | Not started | 14 |
| 6.10 | Inventory transaction ledger | Essential | Not started | 7 |
| 6.11 | Low-stock alert | Recommended | Not started | 9 |
| 6.12 | Safety stock / reorder point | Recommended | Not started | 7 |
| 6.13 | Stock aging | Advanced | Not started | 16 |
| 6.14 | Slow / dead stock | Advanced | Not started | 16 |
| 6.15 | Sell-through / days of cover | Advanced | Not started | 16 |
| 7.1 | Multiple stock locations | Recommended | Partial | 7 |
| 7.2 | Bins / shelves | Advanced | Not started | 18 |
| 7.3 | Transfer request | Recommended | Not started | 13 |
| 7.4 | Transfer approval | Advanced | Not started | 18 |
| 7.5 | Pick / dispatch transfer | Recommended | Not started | 13 |
| 7.6 | Receive transfer | Recommended | Not started | 13 |
| 7.7 | Partial transfer | Recommended | Not started | 13 |
| 7.8 | Transfer in transit | Recommended | Not started | 13 |
| 7.9 | Transfer discrepancy | Advanced | Not started | 18 |
| 7.10 | Intercompany transfer | Advanced | Not started | 20 |
| 8.1 | Receipt-based return | Essential | Not started | 8 |
| 8.2 | Partial return | Essential | Not started | 8 |
| 8.3 | Exchange | Recommended | Not started | 8 |
| 8.4 | Refund to original tender | Recommended | Not started | 8 |
| 8.5 | Refund to store credit | Recommended | Not started | 11 |
| 8.6 | Cross-location return | Advanced | Not started | 18 |
| 8.7 | Cross-channel return | Advanced | Not started | 20 |
| 8.8 | No-receipt return | Advanced | Not started | 14 |
| 8.9 | Return eligibility engine | Recommended | Not started | 8 |
| 8.10 | Return reason codes | Recommended | Not started | 8 |
| 8.11 | Restock decision | Recommended | Not started | 8 |
| 8.12 | High-value approval | Recommended | Not started | 8 |
| 8.13 | Serial/batch validation | Advanced | Not started | 19 |
| 8.14 | Post-void | Advanced | Not started | 14 |
| 9.1 | Customer profile | Recommended | Not started | 11 |
| 9.2 | Fast customer creation | Recommended | Not started | 11 |
| 9.3 | Purchase history | Recommended | Not started | 11 |
| 9.4 | Customer notes / tags | Recommended | Not started | 11 |
| 9.5 | Marketing consent | Recommended | Not started | 11 |
| 9.6 | Customer groups | Recommended | Not started | 11 |
| 9.7 | Customer 360 | Advanced | Not started | 17 |
| 9.8 | Customer segmentation | Advanced | Not started | 17 |
| 10.1 | Points earning | Recommended | Not started | 11 |
| 10.2 | Points redemption | Recommended | Not started | 11 |
| 10.3 | Points expiry | Advanced | Not started | 17 |
| 10.4 | Tier membership | Advanced | Not started | 17 |
| 10.5 | Bonus multipliers | Advanced | Not started | 17 |
| 11.1 | Register open | Essential | Not started | 3 |
| 11.2 | Register close | Essential | Not started | 3 |
| 11.3 | Cash drawer balance | Essential | Not started | 3 |
| 11.4 | Paid-in / paid-out | Recommended | Not started | 3 |
| 11.5 | Cash pickup / drop | Recommended | Not started | 3 |
| 11.6 | End-of-day close | Recommended | Not started | 9 |
| 12.1 | Individual login / PIN | Essential | Done | 0 |
| 12.2 | Role-based access | Essential | Done | 0 |
| 12.3 | Location access | Recommended | Partial | 0 |
| 12.4 | Function permissions | Essential | Partial | 0 |
| 12.5 | Approval required state | Recommended | Not started | 5 |
| 12.6 | Approval thresholds | Advanced | Not started | 5 |
| 12.7 | Clock in/out | Optional | Not started | 21 |
| 12.8 | Shift scheduling | Optional | Not started | 21 |
| 12.9 | Break tracking | Optional | Not started | 21 |
| 12.10 | Sales performance | Recommended | Not started | 9 |
| 12.11 | Commissions | Advanced | Not started | 20 |
| 12.12 | Tip distribution | Optional | Not started | 21 |
| 13.1 | Cash reconciliation report | Recommended | Not started | 9 |
| 13.2 | Custom date ranges / filters | Essential | Not started | 9 |
| 13.3 | Scheduled reports | Advanced | Not started | 16 |
| 13.4 | Custom report builder | Advanced | Not started | 16 |
| 13.5 | Data export | Recommended | Not started | 9 |
| 14.1 | Owner dashboard | Recommended | Not started | 9 |
| 14.2 | Store manager dashboard | Recommended | Not started | 9 |
| 14.3 | Low/out-of-stock alerts | Recommended | Not started | 9 |
| 14.4 | Cash variance alert | Recommended | Not started | 9 |
| 14.5 | Refund/void alert | Advanced | Not started | 14 |
| 14.6 | Failed payment/sync alert | Recommended | Not started | 9 |
| 14.7 | Overdue PO/transfer alert | Advanced | Not started | 18 |
| 14.8 | Expiry alert | Advanced | Not started | 19 |
| 14.9 | Register not closed alert | Recommended | Not started | 9 |
| 14.10 | Severity / routing | Advanced | Not started | 16 |
| 14.11 | Acknowledgement / resolution | Advanced | Not started | 16 |
