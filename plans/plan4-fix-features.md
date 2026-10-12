# Plan 4: make every visible feature work

Prepared: 11 October 2026. Basis: static audit of `apps/web` against `apps/api` (every page, every API call site, every controller route). Nothing in this audit was exercised at runtime, so "working" below means "wired UI to API in code", not "demonstrated". Plan 3 evidence in `docs/plan3-status.md` still stands for the older work it covers.

Definition of working for this plan: UI action → API call → database change → audit record → UI shows the new state, with a test or a recorded browser run proving it.

## 1. What the audit found

### 1a. Wired (UI calls a real endpoint)
Stores (create, edit settings, activate/deactivate, add register), team (invite, edit access), roles (create, edit permissions), products (create, edit, CSV import), categories (create), tax groups (create), onboarding (all steps), settings (general/tax/receipts/approvals/security), store settings, POS (open register, sale, hold/resume, quick-create customer), returns (create), registers (open, cash movement, blind close), inventory (adjust, opening-stock import), reports (read, CSV export), audit (read).

### 1b. Controls that do nothing useful
| # | Where | Problem |
|---|---|---|
| 1 | Brands page "Add" | `PreviewAction` only shows a "preview only" toast. The API has no brand create/update endpoint (brand is a plain text field on a product). |
| 2 | Customers page "New customer" | Same `PreviewAction` toast. `POST /pos/v1/customers` exists but needs a store. |
| 3 | `/dev/ui` | Component test page ships in the app. |
| 4 | Dead preview plumbing | `previewResult` is never used and `preview` is always false, so "Preview data" badges can never appear. `mocks/data.ts` is imported only for TypeScript types, and `features/api.ts` types are shaped like the mock rows. |

### 1c. API exists, no UI at all
| Area | Endpoints with no screen |
|---|---|
| Approvals | `PATCH /pos/v1/approvals/:id`, `POST /pos/v1/approvals`. The Approvals table is read-only, so nobody can approve or decline from the UI. |
| Alerts | `PATCH /pos/v1/alerts/:id`. No acknowledge or resolve. |
| Inventory | `PATCH /pos/v1/inventory/thresholds`, `POST /pos/v1/inventory/rebuild`, `POST /pos/v1/locations`, transfers (`GET/POST/PATCH /pos/v1/transfers`). There is no transfer screen. |
| Customers | `POST /pos/v1/customers/:id/ledger` (store credit). |
| Catalogue | `PATCH /admin/catalog/tax-groups/:id`, `GET/POST /admin/catalog/uoms`, `POST /admin/catalog/products/:id/variants` (confirm whether the product page can add a variant). |
| Registers | `PATCH /admin/registers/:id` (rename, deactivate). |
| Promotions, bundles | `GET/POST /pos/v1/promotions`, `GET/POST /pos/v1/bundles`. No UI. |
| Organisation profile | `PATCH /admin/organization` is reachable only inside onboarding. After setup nobody can edit name, legal name, GSTIN, address. The General settings tab only edits notification email and negative-stock policy. |
| Account | `PATCH /auth/profile`: used only in the onboarding administrator step. There is no profile or change-password page. The user menu can change the PIN only. |

### 1d. Risks found
- `POST /pos/v1/demo/seed` is guarded only by `catalog.manage`. Nothing restricts it to non-production, so any catalogue manager in a real organisation can inject demo data.
- No password reset or "forgot password" flow exists in the API or the UI (the design mockups showed a link; that was not a real feature).
- Team members: no UI for deactivating a user or resetting their password (confirm against `PATCH /admin/users/:id`).

### 1e. Verification debt
- After the redesign: vitest (native binding fails on the synced Windows `node_modules`), ESLint (times out), `next build`, API e2e (needs Postgres), and browser checks have not been run.
- From Plan 3: full route walkthrough, Playwright suite, accessibility/performance, operational evidence.

## 2. Phases

### Phase A: remove falsehood (about 1 day)
1. Move row types out of `mocks/data.ts` into real types, delete `mocks/`, `previewResult`, `PreviewBadge`, `preview` props and `PreviewAction`.
2. Brands: decision needed (see section 3). Until then remove the dead "Add" button and show the brand list read-only with an honest note.
3. Customers: "New customer" opens a real form with a store picker calling `POST /pos/v1/customers`.
4. Gate `/dev/ui` (404 in production).
5. Get a working Linux toolchain (clean `pnpm install` in Docker or CI) so lint, vitest and build can actually run. **Exit:** typecheck, lint, unit tests and build all green from a clean checkout.

### Phase B: finish half-built workflows (2–3 days)
1. Approvals: approve/decline buttons, permission-gated, reason on decline, audit entry, table refresh.
2. Alerts: acknowledge/resolve.
3. Organisation profile: editable name, legal name, GSTIN (validated), address, timezone under Settings → General.
4. Account page: change name, password (current password required), PIN.
5. Register admin: rename and deactivate from the store Registers tab.
6. Tax group edit; category edit/deactivate.
7. Team: deactivate/reactivate, admin-set password reset (decide on email flow in section 3).
**Exit:** each action has an API test and a browser test.

### Phase C: missing modules that already have an API (3–4 days)
1. Inventory transfers (create, dispatch, receive) and locations.
2. Reorder thresholds editor on the inventory page; "Rebuild projection" as a guarded admin action.
3. Variant add and UoM management on the product page.
4. Customer store credit (ledger entry and balance view).
**Exit:** ledger totals match after each flow (existing ledger rebuild test extended).

### Phase D: decisions, then build or hide (1–2 days each)
- Promotions and bundles: build the screens, or remove the endpoints from the feature board until planned.
- Brands as an entity (needs schema, migration and endpoints) or keep as a text field with suggestions.

### Phase E: security and operations (1–2 days)
1. Disable `demo/seed` outside development (env flag) and add a test.
2. Password reset: decide (email, or admin-set only) and implement.
3. Re-run the Plan 3 Phase 9 security checks against the new endpoints.

### Phase F: prove it (2–3 days)
1. Playwright script that visits every route in light and dark, clicks every primary action, and fails on console errors or toast "not connected".
2. Visual review of every screen against `ui-designs/`.
3. API e2e on Postgres, Docker rebuild, migration deploy, backup/restore rehearsal.
4. Accessibility pass (keyboard, contrast already checked for tokens) and basic performance budget.
5. Update `docs/plan3-status.md` with real evidence only.

## 3. Decisions needed from you
1. Brands: first-class records (schema change) or keep a text field?
2. Promotions and bundles: build now or hide?
3. Password reset: email-based (needs an email provider) or administrator-set only?
4. Is store-to-store transfer in scope for the first release?

## 4. Order of work
A → B → E1 (demo seed gate, quick) → C → F, with D after your decisions. Phase F's script should be started early and extended after each phase so regressions show up immediately.
