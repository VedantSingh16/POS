# Plan 4 status

Prepared: 11 October 2026. Plan: `plans/plan4-fix-features.md`.

## Corrections to the plan's audit
- The first audit listed routes with `git ls-files`, which omits untracked files, so some existing pages were not seen (for example inventory opening stock, store products and store settings). All 26 sidebar links were re-checked against the real route files and every one has a page.
- Team members could already be suspended and reactivated from the user page. That control is now replaced by one that confirms first and also offers a password reset.
- Variant edit, CSV import commit, opening-stock commit, register close and cash movements were already wired.

## Delivered
| Area | Change |
|---|---|
| A | `mocks/` deleted; real row types in `features/types.ts`; preview badges, `previewResult` and the fake "preview only" buttons removed |
| A | Customers: real "New customer" form with store picker. Brands: dead Add button removed, page explains brands come from products |
| A | Categories and tax groups show real product/variant counts (were hard-coded 0) |
| B | Approvals: Approve / Deny (confirm on deny). Alerts: Acknowledge |
| B | Settings → General: editable organisation profile (name, legal name, GSTIN, address, time zone, type) |
| B | New `/account` page: name, change password (current password required), change PIN. Linked from the user menu |
| B | Registers: rename and activate/deactivate on the store Registers tab. Tax groups: edit |
| B | User page: confirmed deactivate/reactivate and administrator password reset |
| C | New Stock transfers page (request, dispatch, receive, cancel). Reorder level editor, rebuild stock balances, new stock location on the inventory page |
| C | Add variant on the product page. New Units of measure page. Customer store-credit adjustment |
| E | API: changing a password now requires the current password. Administrator password reset on `PATCH /admin/users/:id`. `POST /pos/v1/demo/seed` returns 403 in production unless `ALLOW_DEMO_SEED=true` |

## Decisions I took because they were not answered
Brands stay a text field on the product. Promotions and bundles were not built (still API only). Password reset is administrator-set, no email flow. Transfers are in scope and live under Organisation.

## Verification actually run
- Web typecheck: clean. API typecheck: clean.
- Every sidebar link has a page (26/26). Every endpoint the web calls exists in the API.
- Navigation gating harness (real `nav.ts` and `permissions.ts`): admin sees Stock transfers and Units; a cashier does not.
- Token contrast check, both themes: all pairs at least 4.5:1.

## Not run (and why)
- ESLint: times out on the synced folder.
- Vitest: native bindings built for Windows do not load in the Linux sandbox.
- `next build`: not run.
- API e2e, including the new `test/plan4-fixes.e2e-spec.ts`: needs PostgreSQL, which is not available here. That spec is not typechecked either, because `tsconfig` does not include `test/`.
- No browser run: none of the new screens has been opened.
- Phase F items (Playwright route walk, accessibility, Docker rebuild) are still open.

## Still open
Promotions and bundles UI, category edit (no API endpoint), brands as records, password-reset email, the full Phase F browser suite.


## Correction (Plan 5)

Earlier text in this file listed Stock transfers as delivered. At that point transfers only changed a status and never moved stock. Plan 5 makes dispatch take stock out of the source, receipt add it to the destination (and to that store's catalogue), and cancel return dispatched stock. Customers are organisation-wide, and each store now has its own catalogue (`store_variants`).
