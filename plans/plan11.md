# Plan 11: Store-Owned Billing, Organization-Owned Product Setup, and Store Tax Groups

**Status: Implemented in source. The migration was rehearsed on disposable PostgreSQL; deployment to the application database and browser acceptance remain pending.**

## 1. Goal

Give each configuration area one clear owner:

- Each store owns its billing and checkout behavior. Billing settings do not inherit organization billing defaults.
- The organization owns product setup, product field definitions, and shared product data. Stores cannot change product fields, add local product fields, or override shared product fields.
- Each store owns its tax groups and the tax-group assignments used by that store. There are no organization-wide tax groups.
- Products and Inventory use a consistent product-selection, search, and filtering experience while retaining their separate operational permissions.

This plan follows the user's requested ownership model. It supersedes the conflicting billing, product-field, and tax-scope recommendations in Plan 9 and Plan 10 when those documents are next revised. The separate store-access and navigation plan remains a distinct scope.

## Implementation decisions and status

The recommendations below were used to implement this plan:

- “Product version” means the organization-owned product type/template, because the user described versions as products with different fields. `ProductType` remains the stored concept and the UI calls the selector “Product version.” Sellable sizes, colors, and packs remain variants.
- Shared catalog fields, values, variants, and base prices are organization-owned. Stores assign and receive shared products, manage availability and inventory, and assign their own tax groups. Store discount, promotion, and price-rule records remain store-owned commercial policies; they do not alter the product schema or shared base price.
- New shared products are created in the organization catalog, then assigned to stores. A separate store request/review workflow was not added.
- Tenant currency and organization tax identity remain organization-scoped. Tax groups and product-to-tax assignments are store-scoped.
- Existing completed sale and invoice snapshots remain unchanged.

Implementation status by phase:

| Phase | Status | Evidence |
|---|---|---|
| 0. Requirements and ownership decisions | Complete | Decisions above are reflected in API, schema, migration, and UI. |
| 1. Contracts and migration | Complete in source | Store ownership checks, conflict reporting, and forward-only migration `apps/api/prisma/migrations/0020_plan11_store_owned_configuration/migration.sql`. |
| 2. Store billing and discounts | Complete in source | Store Billing & Checkout screen, store-only API settings, configurable checkout fields, store discount limits/reasons, whole-bill offers, and price rules targeting a product, category, brand, or all products. |
| 3. Organization product setup | Complete in source | Organization product type/field editors; store product field edits and store product creation are rejected by the API. |
| 4. Store tax groups | Complete in source | Store tax-group management and assignments; organization tax-group UI redirects away; checkout uses only store assignments. |
| 5. Product and Inventory discovery | Complete in source | Both views have a Product version selector and search; store search includes SKU and barcode. |
| 6. Verification and rollout | Rehearsal complete; rollout pending | Typechecks, tests, builds, lint, schema validation, and blank/populated migration rehearsals passed. Browser acceptance and application-database deployment have not been performed. |

### Migration behavior

Migration `0020_plan11_store_owned_configuration` materializes each store's effective legacy billing and checkout configuration before removing organization billing defaults. It archives legacy store product-field settings and reports store-only values for review instead of applying them to shared products. It creates store copies for legacy organization tax groups and applicable organization charges, price rules, promotions, and discount reasons, remaps store assignments, disables legacy organization-scoped rows, and records collisions or changed aggregate promotion limits in `plan11_migration_conflicts`. Completed sale snapshots are not rewritten. The migration was applied to an empty disposable PostgreSQL database and to a two-store legacy fixture; the application's configured database has not been migrated.

### Verification results

- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` passed.
- API tests passed: 7 files, 40 tests. Web tests passed: 4 files, 27 tests.
- API and web production builds passed. Web lint passed with three existing React Compiler warnings; API lint passed with existing warnings in Plan 6/7 end-to-end files.
- Prisma schema validation/client generation passed.
- Migration 0020 succeeded against blank PostgreSQL and a legacy fixture with two stores, inherited billing settings, local checkout overrides, store-only product fields, global and local tax groups, assignments, charges, price rules, reasons, and promotions. The fixture checks confirmed per-store settings materialization and cloning, conflict records, disabled global rows, and unchanged sale-history data.
- Browser role walkthroughs and deployment to the application's configured database remain outstanding. Do not describe the production/application database as migrated until that deployment is run and checked.

## 2. Current baseline and conflicts

The current implementation reflects the earlier organization-default/store-override model:

- The organization Billing & Checkout page configures billing defaults and checkout fields. Store billing settings can override individual values and otherwise inherit the organization value.
- Stores have a Product Fields settings page with local fields and organization-field overrides.
- Tax groups can be organization-wide (`storeId = NULL`) or store-specific. Organization tax-group screens and product tax-group fields exist.
- `ProductType` is the current organization-owned setup-rule concept. It determines allowed categories/brands and extra attributes. `ProductVariant` represents a sellable item with its own SKU and inventory.
- Products, Store Products, and Inventory currently have separate list implementations and actions.

Relevant records: [Plan 9](plan_9.md), [Plan 10](plan_10.md), the organization billing screen, the store product-fields screen, and the `TaxGroup`, `Product`, `ProductVariant`, and `StoreVariant` models in the Prisma schema.

## 3. Target ownership rules

| Area | Owner | Store behavior |
|---|---|---|
| Billing and checkout settings | Store | Configure independently; no organization billing fallback or shared billing defaults. |
| Checkout field definitions and values captured on a sale | Store configuration; sale values belong to the sale | Configure store-specific visibility, labels, requiredness, ordering, and validation. Snapshot values and labels on completed sales. |
| Discounts available at checkout | Store | Configure line-item and whole-bill discounts, limits, eligibility, stacking, reason, and approval rules. Calculations remain server-side. |
| Product types/templates, product/variant field schemas, and shared product data | Organization | Read and use the shared structure; cannot alter definitions or shared field values. |
| Store product availability and inventory | Store | Assign/receive organization products and manage permitted stock operations. These are store operations, not product-field overrides. |
| Tax-group definitions and store product-to-tax assignments | Store | Configure and apply only within that store. Checkout must not use an organization-wide fallback. |
| Tenant base currency and core financial invariants | Organization/system policy | Keep currency as a finance-level invariant unless multi-currency stores are explicitly required. |

Product master changes are made in the organization catalog. If a store needs a product that does not exist, an organization user creates it and then assigns it to the store. This implementation does not include a store draft/request workflow; stores cannot create a separate field schema.

### 3.1 Meaning of “version”

For this implementation, “version” means an organization-owned product type/template whose field schema determines which products appear when selected. The selector uses the existing `ProductType` concept and is labeled “Product version.”

Sellable sizes, colors, and packs continue to use variants with their own SKU/barcode and inventory. A future requirement for historical product specifications would need a separate product-revision model; it is not part of this selector.

### 3.2 Configurable versus system-controlled behavior

Make merchant-facing choices configurable within supported limits. Keep tenant/store isolation, permissions, authenticated actor, invoice identity, price/tax arithmetic, rounding arithmetic, inventory ledger entries, and historical sale snapshots server-enforced. Hiding a field in a form must not bypass an API validation or financial rule.

## 4. Phases

### Phase 0 — Confirm requirements and inventory the existing configuration

**Purpose:** settle ownership and migration decisions before changing APIs or screens.

**Work:**

- Inventory every billing, discount, product, tax, price, and inventory setting; mark its current owner, target owner, API, page, permission, persistence, and historical-record behavior.
- Confirm the meaning of product “version” using Section 3.1.
- Decide whether store prices are allowed. If so, represent them as an explicit store price policy/value, not as a store override of the product field schema.
- Confirm whether new products can only be created in the organization catalog or whether stores may submit a creation request for organization review.
- Confirm whether tax registration/business identity is shared or store-specific. This does not change the requirement that tax groups are store-owned.
- Confirm whether tenant base currency remains organization-wide. The recommendation is to keep it as a finance-level invariant unless multi-currency is required.
- Review Plan 9 and Plan 10 to identify the clauses and status summaries that must be amended after implementation planning is approved.

**Exit criteria:** ownership matrix and scope decisions are recorded above. Product type/template is the product-version selector; shared base prices are organization-owned; store request/review, tax identity, and currency decisions are recorded above.

### Phase 1 — Define scope-safe contracts and migration strategy

**Purpose:** ensure the ownership change is enforced by the API and preserves existing data.

**Work:**

- Define store-scoped billing and tax API contracts. Organization-scoped APIs must not create or update store billing or tax groups.
- Define product APIs so organization roles manage product schemas and shared product values; store roles cannot mutate them. Keep explicit store permissions for availability, assignment/acceptance, and inventory operations.
- Identify resource-ID endpoints that must resolve their organization/store before authorization.
- Plan additive, forward-only migrations and a compatibility period. Do not use destructive resets or silently discard configuration.
- Prepare exception reports for conflicting store field overrides, store-only field values, duplicate tax-group names, and product assignments that cannot be mapped unambiguously.
- Define audit events for setting changes and preserve existing sale/invoice snapshots.

**Billing migration rule:** for every store, materialize the current effective configuration (organization defaults plus that store's overrides and local checkout-field configuration) into a complete store-owned configuration. This preserves each store's current behavior at cutover and removes future inheritance.

**Product migration rule:** organization-owned definitions remain organization-owned. Report store-local definitions and differing store values for an explicit resolution; do not merge conflicting values into the shared product silently. Preserve legacy values until their disposition is approved.

**Tax migration rule:** create a store-owned copy of every organization tax group required by a store, then map that store's products/variants to the copied group. Preserve existing store-owned groups. Record unassigned and conflicting mappings for review. Do not recompute completed sales.

**Exit criteria:** store-scoped API checks, forward-only backfill, conflict reporting, and historical-sale safeguards are implemented. Review the migration report and rehearse forward recovery before application-database deployment.

### Phase 2 — Move billing and discount configuration to each store

**Purpose:** make each store independently configure its complete billing workflow.

**Work:**

- Provide a comprehensive Store Settings → Billing & Checkout experience. Remove organization billing defaults and store override toggles.
- Cover checkout fields: supported standard controls and typed custom fields, visibility, label, order, requiredness, defaults, validation, and receipt/invoice display.
- Cover line-item and whole-bill discounts: fixed and percentage values, eligible products/categories, maximum limits, discount stacking/exclusion rules, required reason, permitted roles, and approval thresholds.
- Review existing price rules, promotions, and discount reasons. Scope cashier-available discount behavior to the store so a separate organization-level path does not contradict store ownership.
- Include payment methods, supported partial/split tender behavior, cash rounding, held-bill expiry, applicable register thresholds, and receipt/invoice presentation where those are merchant-configurable.
- Seed new stores with system defaults. Store settings must be complete values, not references to organization settings.
- Keep payment completion, totals, discount arithmetic, and permissions validated on the API. Snapshot configured sale fields and their labels with completed sales.
- Keep tenant base currency in the agreed finance scope; do not create a per-store currency field unless Phase 0 explicitly approves multi-currency.

**Exit criteria:** organization users cannot edit shared billing defaults; every store can independently configure billing; changing one store has no effect on another; API checkout uses only the selected store's effective configuration.

### Phase 3 — Enforce organization-only product schemas and shared product data

**Purpose:** make the organization catalog the sole source of product setup and product fields.

**Work:**

- Extend the organization-owned product type/template configuration to cover the approved field types, labels, requiredness, order, options, validation, and display surfaces.
- Add schema revision/history behavior for safe field changes. Archive fields rather than deleting historical values without a migration decision.
- Apply the same organization schema to product and variant creation/editing, server-side validation, product details, lists, imports, and exports as in scope.
- Remove store product-field settings, store-created product fields, and store overrides of organization product fields from APIs, permissions, navigation, and UI.
- Make shared product master values read-only in the store. Store-specific availability, stock, and any approved store price data remain separate operational records.
- Route missing-product needs through organization catalog creation, with the Phase 0-approved request/review flow if needed.
- Preserve completed sale snapshots when product labels or schemas change.

**Exit criteria:** organization definitions are the only product field schema; stores cannot mutate shared product fields through UI or direct API calls; organization-defined fields validate consistently in every store.

### Phase 4 — Make tax groups and assignments store-only

**Purpose:** remove organization-wide tax-group ownership and fallback behavior.

**Work:**

- Add/manage tax groups within each store's settings and enforce store-scoped create, update, disable, and assignment permissions.
- Remove organization-wide tax-group creation and editing routes, product-form selection, and organization-level tax-group assignment.
- Make store product/variant tax assignment reference a tax group owned by that same store. Reject a group from another store and reject organization-wide groups.
- Remove checkout fallback to a global product-variant tax group. Show a clear store configuration error if a sellable item lacks its required store tax assignment.
- Keep product facts such as HSN/classification in organization product data only if required by the approved model; these facts do not make a tax group organization-owned.
- Migrate existing groups and assignments under the Phase 1 plan; retain completed-sale tax snapshots unchanged.

**Exit criteria:** every active store tax group belongs to exactly one store; cross-store assignments fail; checkout uses that store's group only; historical invoices remain unchanged.

### Phase 5 — Align Products and Inventory selection, search, and filters

**Purpose:** make product discovery consistent without mixing product setup with stock operations.

**Work:**

- Define a shared product-list query and presentation contract for Products and Inventory.
- Add the product type/template (“version” only if approved) selector. Selecting it displays matching products and variants.
- Provide a product search bar and filters that work independently of the selector and combine predictably with the selected type.
- Search relevant product name, SKU, barcode, and approved searchable fields. Apply store scope to store inventory results.
- Keep product setup and shared-field editing in the organization area. Keep stock balances, adjustments, ledger, and store availability controls in Inventory/store workflows.
- Preserve list state such as selected type, query, filters, and pagination when opening a product and returning to the list where practical.

**Exit criteria:** users can select a product type and find its products from either view; search and filters return the same scoped product set; inventory actions remain protected by store permissions.

### Phase 6 — Data-backed verification and staged rollout

**Purpose:** prove ownership, isolation, migration, and checkout behavior before broad use.

**Work:**

- Rehearse migrations against a dedicated disposable copy of a supported database, including a multi-store organization with organization defaults, store overrides, local product fields, organization tax groups, and store-specific tax groups.
- Verify the billing cutover preserves each store's effective settings and that later settings changes do not cross stores.
- Verify API and UI permissions for organization admins, store managers, cashiers, and users with multiple store roles.
- Verify line and whole-bill discounts, approvals, receipts, payment flows, and store-scoped tax calculations.
- Verify attempts to edit product definitions or shared product values from store routes and direct API requests are denied.
- Walk the organization product setup, store product selection, inventory search/filter, billing setup, tax setup, checkout, receipt reprint, and historical invoice flows in a browser.
- Test cross-tenant and cross-store isolation, invalid configuration, missing tax assignments, and migration conflicts.
- Update Plan 9/10 status and operator guidance to distinguish implemented, migrated, and verified behavior. Roll out only after migration and acceptance evidence is reviewed.

**Exit criteria:** disposable-database rehearsal, automated checks, and production builds pass. Before rollout, apply the migration to the target database using the deployment process, review `plan11_migration_conflicts`, and complete the browser walkthrough for organization admin, store manager, and cashier roles.

## 5. Acceptance criteria

- Billing configuration exists only in store context and has no organization-default inheritance.
- Store billing configuration supports configurable checkout fields and both product-level and whole-bill discounts with server-enforced rules.
- Product schema, setup, and shared product fields are organization-owned; stores cannot override or add product fields.
- Tax groups and product-to-tax assignments are store-owned; no global fallback is used at checkout.
- Inventory and Products share product type selection, search, and filtering behavior while keeping stock actions store-scoped.
- Existing billing behavior is materialized per store during migration; conflicting legacy product/tax values are reported for review.
- Completed sales, invoices, tax snapshots, and audit history remain intact.
- API authorization enforces the same ownership rules as the UI for direct requests and resource-ID routes.

## 6. Decisions recorded for implementation

These choices were used for this implementation:

1. “Version” means product type/template. Variants remain sellable size, color, and pack options.
2. Shared base prices are organization-owned. Store price rules and promotions are local selling policies, not product-field overrides.
3. Organization users create shared products; stores assign and receive them. A store request workflow is outside this implementation.
4. Organization tax identity remains shared; tax groups and product tax assignments are store-owned.
5. Stores use the organization's base currency. Store-level multi-currency is not part of this implementation.

