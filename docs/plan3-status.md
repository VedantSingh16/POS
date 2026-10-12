# Plan 3 MVP verification status

Prepared: 8 October 2026

This is the authoritative status for the user-provided `plans/plan3-mvp.md`. A phase is not called complete merely because code exists: the phase gate and exit criteria must be demonstrated.

## Current status

| Phase | Status | Evidence completed | Remaining evidence or implementation |
|---|---|---|---|
| 0 | VERIFIED | Phase-0 commit `9371b9f`; mapped Prisma schema; workspace/shared package; isolation tests; API/web builds and tests; Docker baseline | None for the recorded Phase-0 scope |
| 1 | PARTIAL | Shared shell, navigation, route pages, data table/form patterns, POS layout, responsive tokens; 31/31 protected-route smoke audit is clean | Full route-by-route manual walkthrough plus automated accessibility evidence |
| 2 | PARTIAL | HttpOnly BFF session, login ambiguity, lockout, idle expiry, store permission guard, PIN unlock, API role matrix, production browser flow with 38/38 checks | Full landing/lock/manual walkthrough for every role |
| 3 | PARTIAL | Resumable onboarding state, organisation metadata, stores/registers, user/role administration, effective-access API/UI, allow/approval/deny effects, concurrent store-quota test, first-tenant registration with two stores and assigned managers, custom role creation, and store-specific permission enforcement | Fresh-database exit walkthrough with two stores, four users and three roles |
| 4 | PARTIAL | Product/variant edits, status, brands, barcodes, UoM, prices, GST HSN/inclusive metadata, grouped CSV import validation/commit, 500-row import/search regression, sale tax snapshots and GST unit tests; 10,000-variant search medians were 83.06 ms (name), 72.57 ms (SKU), 95.73 ms (barcode), and 85.89 ms (brand), all below the 200 ms gate. Attribute Cartesian-product builder and its unit tests are implemented | Browser walkthrough of builder, persisted generated variants, and product-list filter/stock behavior |
| 5 | PARTIAL | Register open/cash movements/denomination close, server pricing/tax, cash/card/UPI, split tender, rounding, holds, notes, discounts, manager-PIN approval path, customer quick-create, browser print formats, 20-concurrent sequential-invoice/sub-second regression | Full scan/variant/discount/split-tender walkthrough and exact printer validation |
| 6 | PARTIAL | Append-only ledger, projection rebuild preserving thresholds, sellable/damaged stock, negative-stock policy, thresholds, opening-stock import, UI flows | Final scheduled-low-stock gate and complete reconciliation walkthrough |
| 7 | PARTIAL | Sales list/detail, receipt/customer lookup, twice-partial-return cap, restock disposition, tender refund, credit-note data/print action, manager-PIN refund approval and drawer reconciliation e2e | Full browser manager-approval/refund-drawer/credit-note walkthrough |
| 8 | PARTIAL | Customer history, filtered report data, GST/margin/tender/cash reconciliation, CSV endpoint, real dashboard balances, scheduled low-stock/register alerts | Full owner/manager dashboard comparison and routing verification |
| 9 | PARTIAL | Cross-tenant/store isolation e2e coverage, including mixed grants across two stores and per-record permission checks; dependency audit is clean; PostgreSQL custom-format backup restored into an isolated database; operator/admin docs and evidence board exist | Full-route security audit, Playwright full-day smoke, accessibility/performance evidence, and production operational rehearsal |

## Verification run recorded in this workspace

- API typecheck, build and lint: PASS.
- Web typecheck and production build: PASS.
- Web lint: PASS with one existing warning in `apps/web/components/data/data-table.tsx` from TanStack Table/React Compiler incompatibility; no errors.
- Web unit tests: PASS — 3 files, 22/22 tests, including onboarding redirects, effective store permission display, and permission-filtered navigation.
- API e2e: PASS — 11 files, 45/45 tests, including new-organisation registration, two-store onboarding, custom role creation, manager isolation, and mixed-permission store filtering. Run with a 30-second per-test timeout and one worker to avoid database contention in the 10,000-variant search benchmark.
- Production browser e2e: PASS — 38/38 checks against the rebuilt Docker API/web stack, including session security, role/store isolation, POS access, lock/unlock, idle lock, manager dashboard and inventory-role restrictions; no cashier-flow console errors.
- Protected route smoke audit: PASS — 31/31 admin, store and POS route navigations completed against the production web container with no captured page errors or unexpected console errors. The audit caught and fixed unsupported alert severities and nondeterministic relative-time hydration.
- Focused Plan 3 phases 3–6 e2e: PASS — 1 file, 9/9 tests with a 60-second per-test timeout. Includes concurrent store quota, 500-row import/search, 10,000-variant name/SKU/barcode/brand search benchmark, reconciliation and 20-concurrent sequential-invoice coverage. The benchmark runs through the Nest API e2e app against the configured local PostgreSQL test database; values above are the medians of three requests per search field in that run, not production-host performance claims.
- Focused Plan 3 phases 7–8 e2e: PASS — 1 file, 2 tests, including two partial returns, over-return blocking, manager-PIN approval, credit notes and cash-drawer reconciliation.
- Docker config/build/recreate/runtime: PASS — API and web containers healthy; `/healthz`, `/readyz`, and web root returned 200; readiness reports `plan3-mvp`.
- Migration deploy: PASS — 10 migrations found, no pending migrations.
- Dependency audit: PASS — `pnpm audit --prod` reported no known vulnerabilities after verified patched dependency updates/overrides.
- Backup/restore rehearsal: PASS — custom-format dump restored into a temporary database and verified before cleanup.
- The complete Plan 3 Phase 9 gate remains incomplete because full-route manual/security, Playwright, accessibility/performance, and production operational evidence are still outstanding.

The API feature board at `/api/pos/v1/features` and the pilot roadmap use these same evidence-based statuses.
