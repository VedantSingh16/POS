# Plan 9: configurable billing, product fields, staff roles and store workflows

**Status: Core implementation delivered; configuration sweep and database-backed rollout verification remain.** This plan now records the implementation in the current branch and the verified work. See the phase status summary below for boundaries and remaining work.

## 1. Goal

Make merchant-facing product and checkout fields configurable while preserving a clear ownership model:

- The organisation administrator defines organisation defaults, product standards, and which settings stores may change.
- Store managers manage their own store, assign staff to organisation-approved store roles, and override only the fields/settings allowed by the organisation.
- Cashiers see the fields required for their work and can record who handled a bill.
- Field definitions and values are validated by the API, audited, tenant/store isolated, and retained with completed transactions.

“Configurable” means the business can choose supported fields, labels, order, visibility, requiredness, allowed values, and edit scope. Financial calculations, audit identity, tenant boundaries, permission enforcement, and ledger behavior remain system-enforced.

## 2. Baseline gaps identified before implementation

| Area | Current implementation | Gap this plan addresses |
|---|---|---|
| Roles and staff | Organisation-scoped custom roles and store-scoped user-role assignments exist. The built-in Store Manager role has `store.staff.view`; the store Staff page is read-only. User creation/access and role-definition endpoints require organisation-level permissions. | Store managers cannot assign approved cashier/supervisor roles within their store. Provide store-scoped staff management without allowing organisation-wide access or permission escalation. |
| Cashier on a bill | The POS displays the signed-in user's name. Checkout stores that user as `Sale.createdById`, and reports use the creator for cashier filtering. | There is no separate “Bill handled by” control. Preserve the signed-in actor for audit and store the selected, eligible bill handler separately. |
| Billing configuration | Organisation billing defaults and store overrides cover receipt footer, enabled tenders, cash rounding, discount-reason requirement, hold lifetime, and point value. | Checkout controls such as customer, coupon, discount, reference, split tender and line note need visibility controls; a shared sale-field definition/value system is also missing. |
| Product configuration | Product and variant data use fixed columns. Organisation product types can restrict categories/brands, require several standard values, and add typed attributes stored in `Product.attributes`. | Standard fields cannot be configured for visibility, requiredness, ordering, or store editability. Store-only product data is unsupported; store-created products do not use product types. |
| Receipts and reports | Receipt/invoice output is mostly fixed, with a configurable footer. | Configured sale fields need explicit print/report behavior, and schema changes must not rewrite historical bills. |
| Other settings | Currency, inventory policy, approval behavior, pricing, tenders, hold expiry and several store settings already have configuration surfaces. | Review settings and display behavior so each area has clear organisation defaults, permitted store overrides, and audited changes. |

Relevant source includes `apps/api/src/auth/permission-catalogue.ts`, `apps/api/src/admin/admin.service.ts`, `apps/api/src/admin/product-types.ts`, `apps/api/src/common/billing-settings.ts`, `apps/api/src/pos/pos.service.ts`, `apps/api/prisma/schema.prisma`, and the POS/catalog/settings screens under `apps/web`.

## 3. Design rules

### 3.1 Configuration scope and inheritance

Use this resolution order for settings and field definitions:

1. Organisation definition/default.
2. Store override where the organisation has enabled store control.
3. Store-only field where the organisation permits local extensions.

An organisation may lock a field, allow a store to change its value, or allow a store to add a local field. Store managers cannot change the organisation's field definitions or edit fields that are locked by the organisation. The effective configuration returned to the POS should include the resolved values and capabilities, not require the client to infer permissions.

### 3.2 Field definition contract

Define a reusable, versioned field format for product, variant, sale, and later customer data. A definition should support:

- Stable machine key and editable display label/help text.
- Supported type: text, number/decimal, yes/no, date, select, and multi-select where needed.
- Required/optional, active/disabled, default value, allowed options, length/range/pattern validation, and display order.
- Placement flags such as product form, variant form, list, POS, receipt/invoice, import/export, and report filter.
- Ownership/edit policy: organisation only, store override allowed, or store-specific.
- Sensible limits on field count, option count, key/label length, and payload size.

Keep definitions in a validated server-side registry/schema with version history. Keep custom values as structured JSON on the relevant record, rather than adding a database column for every merchant field. Reuse or migrate `Product.attributes` and product-type configuration rather than creating a second competing product-field system. Do not expose sensitive fields in POS/receipt/report placements by default.

### 3.3 Historical records and validation

- Validate values against the effective field definition on the API for create and update; client validation is only for usability.
- Snapshot field key, label, type, value, and schema version with each completed sale so reprints stay faithful after a label or schema changes.
- Keep old values readable if a definition is disabled or removed. Disable/archive definitions instead of deleting values from completed records.
- Audit configuration changes with actor, scope, timestamp, and changed fields. Apply tenant and store checks to both definitions and values.

### 3.4 System-owned fields

Product and financial facts can be hidden from a particular form or display only when the underlying operation remains valid. SKU/variant identity, price/tax calculation inputs, stock ownership, invoice identity, permission checks, authenticated actor, and ledger entries remain system-managed. A manager must not be able to bypass a required price/tax rule by hiding its UI field.

## 4. Implementation status

| Phase | Status | Implemented in this branch | Remaining work |
|---|---|---|---|
| 0. Contract and ownership | Implemented as v1 | Shared typed field definitions, validation, organization/store inheritance, store-approved overrides and local fields. Settings updates use the existing audit log. | No field-definition history/rollback registry yet; schema version is currently `1`. |
| 1. Staff roles and bill handler | Implemented | Organization admins control which roles are store-assignable. Store managers can assign only approved roles in their store and only within their own permission ceiling. Checkout records the authenticated creator separately from the selected eligible handler; sale detail, invoice and cashier filtering include handler attribution. | Database-backed authorization walkthrough still needs a disposable test database. |
| 2. Product and variant fields | Implemented for configuration and forms | Organization product/variant definitions support typed custom values, requiredness, order, select/range rules, store edit permission, receipt/list display flags and storage on product, variant, or store catalogue records. Standard fields can be shown/hidden; configured list fields appear in catalogue and POS views. Store overrides/local definitions are bounded by organization settings. | Standard fields do not yet have per-field requiredness, edit-role, ordering, or value-ownership controls. Custom fields are not included in catalogue import/export or report filters. |
| 3. Checkout fields | Implemented | Organization/store checkout definitions render at payment, validate on the API, persist typed values and snapshot labels/receipt visibility on the sale. Optional standard controls (customer, coupon, discount/reason, payment reference, split tender and line note) can be hidden. Payment method, cash received and bill-handler attribution stay available. Invoice printing respects each custom field's receipt setting. | No configuration preview yet. Standard fields keep their built-in labels/order/validation. Custom sale-field report filters/exports remain future work. |
| 4. Configurability sweep | Partially implemented | Standard product visibility and custom-field list presentation are connected to catalogue/store/POS screens. Existing currency, billing, pricing, product-type, and inventory policies remain in their existing settings workflows. | Customer profile fields, full receipt layout, remaining hard-coded workflow options, and a reviewed configuration inventory remain. |
| 5. Verification and rollout | Unit/build checks complete; integration rollout pending | API suite: 28 tests pass. Web suite: 26 tests pass. API/web typechecks and production builds pass. API lint exits successfully with existing warnings. A field-config suite covers types, options, inheritance, store scope and invalid values. | Full web lint exits non-zero on existing rule violations in store taxonomy/dashboard, onboarding and POS components. The database-backed e2e suite deletes seeded test tenants and no dedicated `POS_TEST_DATABASE_URL` is configured in this checkout, so it was not run. No browser walkthrough, upgrade migration run, feature flag, or pilot guide yet. |

### Delivered behavior and files

- Migration `0016_plan9_configuration` adds store-assignable roles, store field settings, bill-handler attribution and custom fields for variants, store variants and sales; `0017_product_custom_fields` adds product-level values.
- `apps/api/src/common/field-config.ts` validates v1 field definitions and values. Organization definitions, store overrides and store-local definitions are resolved server-side. API writes validate configured values and record setting/role changes through the audit service.
- Store staff APIs expose assignable roles and update one store-scoped assignment without changing role definitions. A role is offered only if all its allowed permissions are already within the assigning manager's store permissions.
- Checkout configuration supplies active store staff with `sale.create`. The sale keeps `createdById` as the authenticated actor and stores `handledById` separately. New invoices identify both; older sales without a handler fall back to their creator.
- Organization/store checkout settings can hide optional standard controls and add custom typed sale fields. The payment method, cash received and bill handler remain visible so the payment and attribution flows stay operable.
- Product fields are available on product/variant forms, store product creation and store-editable fields. `showInList` applies to organization/store catalogue columns and POS product tiles. Standard product visibility reaches product details, variants, catalogue tables, store product forms and POS category browsing.
- `plans/plan_9.md` is the as-built record for the implemented scope and the explicitly deferred areas; the original phased design follows below.

## 5. Phases

### Phase 0: configuration contract, ownership and migration design — implemented as v1; field history deferred

**Purpose:** agree on field ownership and avoid introducing incompatible one-off settings.

**Work:**

- Document field owners and permitted store actions for product, variant, sale, and receipt fields.
- Define the versioned field-definition shape, supported field types, validation limits, and scope-resolution rules.
- Map existing product-type attributes and billing settings into the new contract. Preserve current data and existing API behavior during migration.
- Decide how organization-managed product fields, store-level value overrides, and store-only fields are stored and resolved. Organization master data must not be silently overwritten by a store value.
- Identify display/export consumers for each field before adding field-placement options.
- Add an audit event vocabulary for field definitions and field values.

**Exit criteria:** every configurable field has a named owner, scope, validation rule, and display destination; existing configurations have a backward-compatible migration path; no unresolved conflict exists between organisation and store ownership.

### Phase 1: store-scoped staff assignment and bill-handler attribution — implemented

**Purpose:** deliver the requested role and “who handled this bill” workflow safely.

**Work:**

- Add store-scoped staff management endpoints and permission checks. The built-in Store Manager can manage staff assignments only for stores they manage.
- Keep role definitions and permission sets under organisation administrator control. Let managers assign only roles explicitly approved for their store; prevent assigning an organisation-wide role or a role with permissions beyond the manager's delegation ceiling.
- Replace or extend the read-only store Staff page with an assignment flow showing eligible staff and approved roles. Record assignment changes in the audit log.
- Add an eligible-staff list for the POS, constrained to active users assigned to the current store and allowed to take sales.
- Add a “Bill handled by” selector to checkout, defaulting to the signed-in user. Require a selection only if the organisation/store configuration says so.
- Store the authenticated actor separately from the selected bill handler. Add a sale relation/field for the handler, validate it server-side, and update sale detail, receipt/invoice, and cashier report filtering to use the intended attribution.

**Exit criteria:** a manager can assign an approved cashier role in their store and cannot manage another store or elevate access; a cashier can complete a bill with the default or selected eligible handler; actor and handler remain separately visible in audit/sales data.

### Phase 2: organisation product and variant field configuration — core implemented; standard-field policy extensions deferred

**Purpose:** make product setup fit different businesses without fixed merchant-facing forms.

**Work:**

- Extend the existing product-type experience into the shared field-definition contract. Configure standard and custom product-level and variant-level fields, including category, brand, barcode, SKU, description, unit, tax group, cost, price, status, and open-price behavior where policy permits.
- Support show/hide, required/optional, order, defaults, allowed options, and which roles can edit each field. Preserve system validation for identity, price, tax, and inventory invariants.
- Let the organisation define which fields stores may override and whether stores may add store-specific product/variant fields.
- Apply effective definitions to organization product create/edit, variant create/edit, store product create/edit, product detail, product tables/filters, and catalogue import/export.
- Store organisation custom values with the product/variant and store-specific values with the relevant store catalogue record. Define precedence explicitly for display and sale pricing/tax resolution.
- Make POS product search/display configurable for approved fields while retaining required scan, stock, and price behavior.
- Provide a migration/backfill for current product type configs and preserve existing `attributes` values.

**Exit criteria:** organisation field definitions are enforced by both UI and API; permitted store overrides/local fields save and display only in that store; product types, variants, imports, and POS all use the same effective definitions; existing product data remains intact.

### Phase 3: configurable checkout/billing fields — implemented; preview/report extensions deferred

**Purpose:** let each business collect the information it needs on a bill.

**Work:**

- Add organisation-defined checkout fields and store-level overrides/local fields using the same field contract.
- Allow visibility control for optional standard checkout controls while keeping payment completion and bill-handler attribution available.
- Configure label, type, requiredness, default, order, validation, cashier visibility/editability, and whether the value appears on receipts/invoices or in reports.
- Render configured fields in the checkout flow alongside core billing controls. Provide a preview of the cashier form and printed result to administrators/managers.
- Validate at checkout on the API and persist values plus a versioned label/value snapshot with the sale. Include configured values in sale detail and reprints.
- Extend import/export and report filters only for field types and uses where they are meaningful. Keep payment, tax, discount, and total arithmetic server-authoritative.
- Keep the existing billing settings (tenders, rounding, footer, hold lifetime, and point value) working as settings; do not model operational behavior as arbitrary text fields.

**Exit criteria:** organization defaults apply to stores; managers can change only permitted local settings; a required custom field blocks incomplete checkout on both client and API; completed sales and invoice reprints retain the captured values after the definition changes.

### Phase 4: configurability and editability sweep — partially implemented

**Purpose:** close related hard-coded business settings discovered during implementation.

**Review and implement, prioritised by pilot need:**

- Receipt/invoice layout and optional business fields, including whether product custom fields print.
- Customer profile fields and customer form visibility.
- Product list columns, filters, and POS tile/search presentation.
- Store/category/brand/unit/tax/pricing edit workflows and their existing scope rules.
- Discount, approval, refund/return, hold, and inventory policies that still have fixed UI or missing store override behavior.
- Store-facing staff permissions and manager-visible configuration areas.

For each candidate, record whether it is already configurable, should inherit organization defaults, may be overridden by a store, or must remain system-controlled. Do not expand scope to every hardware or payment-gateway option in this phase unless a pilot specifically needs it.

**Exit criteria:** a configuration inventory marks each business-facing option as configurable, fixed by design, or deferred with an owner; high-priority pilot gaps are implemented with consistent scope, permissions, audit, and validation.

### Phase 5: migrations, end-to-end validation and rollout — unit/build checks complete; integration pending

**Purpose:** prove configuration works across roles, stores, imports, checkout, reporting, and historical records.

**Work:**

- Add migration and API coverage for old records, organization/store inheritance, permission boundaries, invalid field values, field archival, and sale snapshots.
- Walk through fresh and upgraded organizations with at least two stores, two managers, and multiple cashiers with different role assignments.
- Browser-walk organization setup, store overrides, product creation/edit/import, POS checkout, receipt/invoice reprint, and cashier reports.
- Verify that cross-organization and cross-store reads/writes are rejected, and that managers cannot assign permissions they do not control.
- Provide concise organization administrator, store manager, and cashier setup guides.
- Roll out behind an organization feature flag; enable per pilot after migration and workflow evidence is reviewed.

**Exit criteria:** migration preserves existing field values and sales; API and browser walkthroughs pass for each role; audit records identify who changed configuration and who submitted/handled each sale; pilot stores can configure and use fields without developer edits.

## 6. Recommended delivery order

Deliver Phase 0 first, then Phase 1 in parallel with the shared field registry foundation. Complete Phase 2 before Phase 3 so both forms share tested field validation, inheritance, audit, and versioning. Phase 4 should use pilot feedback after the core product and checkout flows are stable. Complete Phase 5 before enabling the configuration broadly.

## 7. Key decisions to preserve during implementation

- Organisation administrators own role definitions and the maximum permissions available to store roles; store managers assign only approved roles in their own store.
- `createdById` remains the authenticated actor. “Bill handled by” is separate sale attribution and must be permission-checked.
- Product master values and store-specific values have explicit ownership; store edits must not mutate organisation data unless the organisation allowed that field to be shared.
- Completed sale values and printed labels are historical facts. Later configuration edits affect future records, not reprints of past bills.
- Configuration is data-driven, but all configured values remain typed, validated, audited, and scoped on the server.
