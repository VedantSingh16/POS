# Plan 11: Read-only Organisation Access to Stores and Consistent Back Navigation

**Status: Implemented; automated verification passed (2026-10-14).** Database-backed end-to-end and responsive browser walkthroughs remain pending because no dedicated test database is configured.

## 1. Goal

Make organisation users' store access an explicit oversight experience. An organisation administrator can open a store and inspect the data that their policy permits, but organisation-level authority by itself must not let them create or change store-owned records, accept products into a store, run a till, or perform other store operations. Store mutations remain the responsibility of store-scoped roles.

Also make it clear how to return from store pages, nested records, and task flows to their logical parent. Navigation must work for direct links and reloads as well as normal in-app navigation.

This document records the implementation scope and the verification status below. The original findings and phase outline are retained as the design record.

## Implementation and verification record

- **API scope enforcement:** Organization-level grants no longer become store writes. Organization administrators receive an explicit store read permission set; store-scoped grants, deny rules, and approval effects remain effective. Resource-ID operations resolve the record's store and authorize after lookup.
- **Read/write separation:** `sale.view`, `refund.view`, and `alert.manage` distinguish reading sales/returns and acknowledging alerts from creating refunds or changing store state. Pending organization-sent products are readable with `catalog.view`; decisions still require `store-catalog.verify`.
- **Store UI:** Organization-only store views show a read-only banner; store product creation, assignment, POS entry, and review controls depend on store permissions. The organization store settings panel is read-only. Organization-side store lifecycle, register provisioning, and manager assignment remain authorized as organization administration.
- **Return navigation:** `PageHeader` supports a stable parent link; detail, import, wizard, inventory, return, register-session, and other nested routes now expose explicit destinations. The shell's existing “Back to organisation” action remains available in store context.
- **Automated checks:** `pnpm verify` passed: lint, shared/API/web typechecks, production builds, 36 API unit tests, and 27 web unit tests. Lint produced non-blocking React Compiler and unused-variable warnings.
- **Not run:** API/browser end-to-end checks that need a database or live test stack. `POS_TEST_DATABASE_URL` is not configured; the API e2e config can fall back to `DATABASE_URL`, so it was not run to avoid touching a non-test database. Manual desktop/mobile route walkthrough remains an additional release check.

## 2. User requirements captured

1. Organisation users need to open stores and view the store's information.
2. An organisation user should not use that store context to add or accept products sent by the organisation. The store's manager/staff should perform the store-side acceptance.
3. Store-only actions should not appear merely because a user is an organisation administrator.
4. Some pages lack an obvious back/return control. Navigation should consistently return users to the right parent and preserve their working context.
5. Keep organisation catalogue and distribution management in the organisation area; keep store operations in the store area.

## 3. Current project findings

### 3.1 Why organisation users see store actions

- The sample page is `apps/web/app/(app)/s/[storeId]/products/page.tsx`. It correctly checks `catalog.view` to load the store product list, but it also calculates store mutation controls for local product creation, adding products, and verification.
- `apps/web/lib/permissions.ts` makes `hasPermission(me, code, storeId)` return `true` for every permission when `me.user.isOrganisationAdministrator` is true. This means the page considers an organisation administrator to have `catalog.manage.store` and `store-catalog.verify` in the store.
- `apps/api/src/auth/authorization.service.ts` repeats the same unconditional administrator bypass in `hasPermission` and `permissionEffect`. Its `getSessionProfile` consequently returns an overly broad store-permission set too.
- The built-in Organisation Administrator role contains every permission code (`ALL_PERMISSION_CODES`), and the permission guard checks requested permissions. Some routes include an explicit `storeId`; other operations are addressed by resource ID and must be checked in the service after resolving the resource's store. A UI-only fix would leave the API authorization problem in place.
- Store products currently conditionally show “Edit in organisation catalogue”, “New product”, “Add products”, and the pending-product verification controls. The product list itself is read data; creating local products, assigning/accepting distributed products, and verification decisions are store mutations.
- The GET endpoint for pending verification currently requires `store-catalog.verify`, the same permission used for decisions. Read-only users therefore cannot be shown pending state separately from being allowed to accept/reject it.

### 3.2 Existing navigation behavior

- The app shell already has a store context card and a top banner with **Back to organisation** for users with organisation scope. The attached screenshot's Store Products page is one of the pages where this escape link is present.
- Most ordinary list and detail pages use `PageHeader` and `Breadcrumbs`; store breadcrumbs are augmented with the store context. Examples include product, sale, register-session, customer, user, and inventory detail routes.
- The `PageHeader` currently provides breadcrumbs but no general back action. Breadcrumbs show location; they do not always express the expected return action from a create/edit or nested task.
- The route scan found some deliberate exceptions: store attendance currently redirects to staff; organisation settings children use the shared settings layout and its section tabs; account and forbidden pages are standalone. The required fix is therefore a route-by-route audit, not an assumption that every page is missing navigation.
- The full-screen POS has its own header and is a write-oriented workflow. Once store writes are correctly scoped, organisation-only read access should not permit a user to enter or transact in POS.

## 4. Target access and ownership rules

### 4.1 Scope rules

1. Organisation-scoped grants authorize organisation work in `/org` (for example, editing the shared catalogue or dispatching a distribution through the organisation workflow).
2. An organisation administrator can enter an authorized store's context for oversight and receives only an explicit set of store read capabilities. This is read access to the store's records, not an implicit store role.
3. Store mutations require an effective **store-scoped** grant for the target store. Organisation administrator status and an organization-scoped mutation grant do not silently become store-scoped mutation permission.
4. If a person is also assigned a store-scoped role, that explicit assignment may authorize the actions in that store according to its grants and deny rules. The product decision for whether an organisation administrator may be assigned a store-operating role must be recorded; the default remains no mutation authority from organization scope alone.
5. Organisation workflows that intentionally target stores (such as distribution dispatch) remain organization actions. They must be individually identified and authorized at organization scope, rather than being treated as a store manager action because their request contains a store ID.
6. Explicit deny rules and approval requirements retain their current meaning and must be resolved consistently in API and web permission calculations.

### 4.2 Read-only permission policy

Define a reviewed, explicit policy for which store data an organisation administrator can inspect. Do not infer access merely from a permission's name ending in `.view`. Candidate read capabilities include store overview, catalogue/products and pending distribution status, inventory, sales and receipt detail, registers/session summaries, staff, settings, reports, alerts, tax/pricing, and audit information. Confirm data sensitivity and role policy for each capability before enabling it.

Export, create, update, delete, accept/reject, approve, clock, sell, refund, transfer, adjust stock, cash movement, close/open register, and other write or bulk-data actions are not part of default read-only access. `report.export` and similar capabilities must be evaluated separately instead of being treated as ordinary viewing.

Represent this as a central permission/scope policy shared in intent by API authorization and web session permissions. Keep an explicit list or permission metadata; avoid string heuristics. The API is authoritative.

### 4.3 Expected actor behavior

| Actor/context | Store information | Store mutations | Organisation catalogue/distribution work |
|---|---|---|---|
| Organisation administrator, in organisation area | Organisation-wide views permitted by role | Organisation-scoped operations permitted by role | Allowed by organization-scoped grants |
| Organisation administrator, viewing a store without a store role | Explicit read-only store views | Denied, including direct API calls | Must leave store context and use the organisation workflow |
| Store manager, in an assigned store | Views permitted by role | Store operations permitted by explicit store-scoped grants, including product verification if granted | No organization-wide editing unless separately granted |
| Cashier/staff, in an assigned store | Minimum views permitted by role | Only assigned operational actions; no catalogue management by default | Not available from store role |
| Organisation administrator who also has an explicit store role | Read access plus that store role's permitted access | Only the specific store-scoped grants; deny/approval rules still apply | Still governed separately in organisation context |

## 5. Proposed product/store experience

### Organisation area

- Keep shared product creation/editing and product distribution in the organisation catalogue/distributions pages.
- Make store destination, distribution state, dispatch time, and store acceptance state visible to organization users in those organization workflows.
- Do not use a store page as a shortcut for editing the shared product catalogue or performing store acceptance.

### Store Products page

- For an organisation-only viewer, show the store's assigned products, approved store-specific details, and the state of products waiting for store review.
- Present pending organization-sent products as **Pending store review** (read-only), without Add/Accept/Reject controls.
- Hide store-local product creation, adding/accepting sent products, tax/local edits, removal, and other mutations from viewers without the corresponding store-scoped grants.
- Remove the “Edit in organisation catalogue” action from the store action area; users can use the organisation navigation/context link and the catalogue's own workflow.
- Keep these actions available to the store manager or another store-scoped actor where the role grants them.

### Other store routes

- Show read-only links and data to organization viewers only where included in the approved view policy.
- Hide or disable mutation controls in the UI, but also return a consistent forbidden response from APIs when the actor lacks the required store-scoped grant.
- Treat POS, approval decisions, cash/till actions, returns, inventory adjustment, staff management, configuration edits, and distribution acceptance as write workflows, not as read-only store browsing.
- Provide a clear read-only context label, such as **Organisation view · Read-only · Store name**, on store pages for users whose store permissions are only the read-only policy. Do not show it to users who are acting under an explicit store role unless the product design intentionally indicates combined access.

## 6. Back and return navigation policy

1. Keep the app-shell **Back to organisation** action available across all organization-user store routes, including responsive/mobile navigation and route transitions. It is a fixed known destination, not browser history.
2. Add an explicit parent/list return link to nested detail and task pages when breadcrumbs alone do not make the next step clear. Use the page's known route (for example, Sale → Sales, Session → Registers, Product → Product catalogue).
3. Standardize an optional `backHref`/`backLabel` affordance in the shared page header or a shared `BackLink` component. Use it for create/edit/wizard/result routes that need a clear return action.
4. Preserve search, filters, pagination, and selected store when returning from a detail page where practical. Use a validated same-application return target or a known parent fallback; never trust an arbitrary external `returnTo` URL.
5. Do not rely on `history.back()` as the only return mechanism. Direct opens, browser refreshes, and links from email/bookmarks must still have a valid destination.
6. Treat modal/sheet **Cancel** and close controls as local dismissal, not as a substitute for page-level navigation.
7. Maintain breadcrumbs as location indicators. A breadcrumb and a back action can coexist when the task flow needs both; avoid duplicate links when they communicate the same destination.
8. Ensure POS's **Exit** destination is explicit and safe; organization-only read viewers should be denied entry to the transaction screen after the permission change.

## 7. Implementation phases

### Phase 0 — Confirm route/permission inventory

- Build an endpoint-to-permission inventory covering every store read and write route, including routes addressed by register/session/sale/product IDs instead of `storeId`.
- Build a page/action matrix for the web routes and every visible control (including tables, row menus, sheets, POS, and dashboard shortcuts).
- Approve the exact read-only store data set, including whether organization-only viewers can see staff/attendance, detailed receipts, alerts, audit events, and store reports.
- Decide whether an organization administrator can separately hold a store-operating role. Record this as a role policy, not an accidental consequence of admin status.
- Produce a navigation checklist for list, detail, create/edit, wizard, settings, POS, error, and redirect routes. Record route-specific gaps and intended destinations.

**Exit criteria:** permission matrix and route checklist are reviewed; no implementation starts with ambiguous resource ownership or access policy.

### Phase 1 — Enforce separation of organization and store scope in the API

- Replace the unconditional organization-administrator bypass for store-scoped permission checks with the reviewed store read-only policy plus explicit store-role grants.
- Apply the same scope semantics to `hasPermission`, `permissionEffect`, store access, permitted-store listing, and session-profile permission generation.
- Keep organization-scope checks for organization-level endpoints. Identify and explicitly preserve cross-store organization actions such as product distribution.
- Audit `PermissionsGuard` and service authorization for all endpoints. Where a route uses a resource ID, load/resolve its store and authorize against that store before changing data.
- Make write endpoints require the correct store-scoped permission; ensure missing or mismatched store context cannot fall back to an organization-level grant.
- Split pending-distribution reading from verification: organization read-only viewers may read pending status under the approved view capability; only store-scoped `store-catalog.verify` may accept/reject.
- Keep tenant ownership and store membership checks in place for every read and write.

**Exit criteria:** API behavior is secure without the web app; organization scope alone cannot mutate store-owned records; organization distribution still works through its intended endpoint.

### Phase 2 — Align session and web permission/UI behavior

- Return only effective store read capabilities to an organization-only viewer; remove the organization-admin shortcut in the client permission helper.
- Ensure server-rendered route guards, client `Can` checks, navigation visibility, dashboard actions, and API behavior use matching scope semantics.
- Update Store Products as described above: read-only products and pending status for organization viewers; store management controls only for store-scoped managers.
- Audit all store pages for write controls and shortcuts, not just product catalogue. Hide or disable controls based on effective store permissions.
- Add a distinct read-only context indicator and ensure store switching remains limited to stores the viewer may inspect.
- Make direct URLs to transactional pages (especially POS) resolve to a clear forbidden/read-only destination rather than rendering hidden controls or a partial cashier workflow.

**Exit criteria:** navigation and visible actions match the effective permission set; the organization-only Store Products view contains no store mutation action.

### Phase 3 — Standardize return navigation

- Complete the Phase 0 route checklist and add a known-parent return affordance to each confirmed gap.
- Ensure shared breadcrumbs and the store-to-organisation return action render consistently for desktop, mobile, and full-screen routes where accessible.
- Add explicit destinations to detail pages, new/edit forms, multi-step setup flows, and completion/error states; preserve store/filter context where applicable.
- Keep existing working breadcrumbs and the shell's Back to organisation links; avoid replacing them with an unbounded browser-history dependency.
- Verify every destination under direct route entry, refresh, and browser Back/Forward navigation.

**Exit criteria:** every navigable page has an obvious path to its logical parent or a stable home/context route, and no page traps users when opened directly.

### Phase 4 — Regression and acceptance verification

- Add API authorization tests for organization-only viewer, explicit store manager, cashier, cross-store attempts, denied roles, approval-required grants, and organization distribution.
- Test both request shapes: routes with `storeId` in params/query/body/header and mutations addressed only by resource ID.
- Test that organization-only users can read each approved store view and cannot create products, assign/accept distributions, edit store data, operate registers, sell, refund, adjust inventory, manage staff, export restricted data, or submit equivalent direct API requests.
- Test that a store manager with the corresponding store-scoped role can perform allowed local operations and that a cashier cannot gain manager operations through organization scope.
- Add UI tests for read-only banners, hidden controls, pending product status, navigation visibility, and store-role controls.
- Walk every route in the navigation checklist at desktop/mobile widths, including a direct deep link and reload. Verify links preserve store/filter context and have a safe fallback.
- Run the project-defined unit, type-check, lint, build, and integration/e2e checks. Run database-backed tests and any permission migration rehearsal only against a dedicated disposable test database.

**Exit criteria:** all acceptance cases pass; no regression in organisation-level catalogue/distribution flows; no API authorization bypass remains; navigation checklist is fully verified.

## 8. Acceptance criteria

- Opening a store from the organization area grants store visibility only according to the approved read policy.
- The organization administrator role does not imply `catalog.manage.store`, `store-catalog.verify`, or any other store mutation permission.
- An organization-only viewer can see a pending organization-sent product and its status but cannot accept, reject, or add it to sale.
- Store-scoped managers can review/accept products and manage local products only for their assigned store and granted actions.
- Organization catalogue edits and distribution dispatch continue to work through organization-scoped workflows.
- API authorization rejects forbidden writes even when called directly and even when the store can only be inferred from a resource ID.
- Web permission data, route protection, navigation, and action buttons agree with the API's effective scope.
- Store read-only state is visually unmistakable; transaction pages do not become usable by hiding just one button.
- Every route in the audited app route matrix has a contextual return path; deep links and reloads do not depend on prior browser history.
- No cross-tenant or cross-store data becomes visible through the read-only capability.

## 9. Risks and safeguards

| Risk | Safeguard |
|---|---|
| Hiding controls leaves API mutations available | Make API/service permission checks authoritative; test direct requests and resource-ID routes. |
| Narrowing organization grants breaks organization workflows | Classify endpoints by operation ownership; retain explicit organization-scoped operations such as distribution. |
| Read permissions expose sensitive operational data | Approve the exact view set in Phase 0; keep exports and sensitive detail permissions separate. |
| Store users lose existing allowed behavior | Test explicit store roles and deny/approval precedence before rollout. |
| Session profile still claims admin has every store permission | Generate store permissions using the same scoped policy and test the serialized profile. |
| Return links lose filters or lead out of the active store | Preserve validated list context and use stable in-app parent fallbacks. |
| Legacy roles or grants have surprising scope | Inspect existing role assignments and run a read-only permission impact report before enforcement rollout. |

## 10. Rollout and audit

1. Before rollout, report which users currently receive store permissions solely because they are organization administrators and which organization-scoped roles currently mutate store data.
2. Review role impact and resolve unintended store grants; do not silently convert an organization role into a store role.
3. Deploy API enforcement and the matching session/UI contract together so the UI does not present actions the API rejects, and the API does not allow actions hidden by the UI.
4. Monitor forbidden responses and support reports during rollout; distinguish expected denied store writes from actual permission regressions.
5. Update role/help text to explain that organization access provides oversight and store-scoped roles grant store operations.

## 11. Files/areas expected to be involved during implementation

- Authorization and permission definitions: `apps/api/src/auth/authorization.service.ts`, `apps/api/src/auth/permissions.guard.ts`, `apps/api/src/auth/permission-catalogue.ts`, `apps/api/src/auth/auth.types.ts`, and shared permission definitions in `packages/shared/src/permissions.ts`.
- Product distribution and store catalogue: `apps/api/src/pos/pos.controller.ts`, `apps/api/src/pos/pos.service.ts`, `apps/web/app/(app)/s/[storeId]/products/page.tsx`, `apps/web/features/actions.tsx`, and the store catalogue API client.
- Session/UI permission projection and navigation: `apps/web/lib/permissions.ts`, `apps/web/lib/server/session.ts`, `apps/web/lib/nav.ts`, `apps/web/components/app/app-shell.tsx`, and the role editor/permission matrix.
- Shared navigation: `apps/web/components/app/page-header.tsx` and the route-specific pages identified by the Phase 0 audit.
- Tests: API auth/authorization specs and e2e coverage; web permission, navigation, product action, and route tests.

The exact implementation file list must be confirmed against the Phase 0 endpoint and route inventory before editing.
