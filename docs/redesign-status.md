# Organisation / store redesign: status

Prepared: 11 October 2026. This records what changed, what was verified, and what was not.

## Root causes found

| Problem seen | Cause in the code |
|---|---|
| Organisation and store menus overlapped | `visibleNav` returned both sections at once for an administrator, and the top bar always showed a store switcher (even on `/org/*`). |
| Unclear context | No indicator of "organisation vs one store"; the bell and switcher silently used a default store on organisation pages. |
| Store manager was organisation-wide | "Invite user" defaulted the store to *Organisation-wide* for every role; nothing tied built-in store roles to a store. No UI could change a user's access afterwards. |
| Stores showed 0 registers / 0 staff, POS could not open a till | "New store" created a store without a register; the Staff column was hard-coded to `0`; the till dialog showed an empty dropdown with no explanation. |
| Roles list showed `NaN` | Counts were rendered without a guard when the API omitted them. |
| Audit log showed raw UUIDs | Actor ids and entity ids were printed as-is. |
| Hard-coded sign-in | The legacy `/pilot` console pre-filled `org-admin@pos.local` and kept a token in `localStorage`. The real `/login` was already clean. |
| Misleading "Preview data" badge, fake checklist | Settings layout passed `preview` unconditionally; the overview checklist had fixed done/not-done values. |
| Wizard defects | Default store code came out as `STORE-21` (`padStart(2, "2")`); no per-step validation; Finish redirected with no completion screen. |

## What changed

- **Navigation / shell**: the URL decides the context (`/s/*` is a store, everything else is the organisation). The sidebar shows only that area, grouped, with a context card (organisation, or store name and code) and *Back to organisation* for administrators. The top bar shows "Organisation-wide view" or the store chip; "Open a store" appears only for people with organisation access, and a store switcher only for people with several stores. A banner reminds administrators when they are inside a store. Breadcrumbs on store pages read Organisation › Stores › store › page. The ⌘K menu labels each group.
- **Entry**: `/pilot` removed. Sign in / Create organisation switcher on both pages.
- **Onboarding** (persisted at every step through the existing endpoints): administrator summary, store-count control, per-step validation with inline messages, manager-per-store assignment, review with edit links, confirm, completion screen with *Open organisation dashboard*.
- **Organisation**: overview with real checklist and "Your stores" (manager, registers, staff, readiness); stores list with manager/register/staff columns; store page with registers, team, settings, activate/deactivate; *Add register*; *Add team member* fixed to the store; team page with *Edit access*; reports page with a store-by-store comparison; audit shows names.
- **Store**: overview labelled as that store only; "today" now uses the store's own time zone (it used UTC); charts show an explanation when empty; POS explains a missing register.
- **API** (`admin.service.ts`): `GET /admin/stores` now returns `staffCount` and `managers` (names only for callers who may list users); `POST /admin/stores` accepts an optional first `register`, created in the same transaction. No schema change, no migration.
- **Tests added**: `apps/api/test/redesign-stores.e2e-spec.ts` (needs PostgreSQL); navigation-mode cases in `apps/web/lib/__tests__/permissions.test.ts`.

## Verification actually performed

| Check | Result |
|---|---|
| Web `tsc --noEmit` | Pass for all source. Two errors remain in generated `.next/**/validator.ts` that still reference the deleted `/pilot` page; `next build` regenerates them. |
| API `tsc --noEmit` | Pass (includes the new e2e spec). |
| Navigation logic, run against the real `nav.ts` / `permissions.ts` | 8/8 checks pass (org view has no store items, store view has no org items, a store manager has no org area, URL decides context, landing pages). |

## Not verified (could not run in this environment)

- `vitest`, `eslint`, `next build`: the installed `node_modules` are Windows builds and the Linux sandbox could not reach the npm registry; ESLint did not finish on the network drive.
- API e2e suite and the new `redesign-stores` spec: need PostgreSQL (`POS_TEST_DATABASE_URL`).
- Nothing was exercised in a browser; responsive layout, keyboard use and visual polish are unchecked.
- Docker was not rebuilt. **Rebuild the web and API images and restart before looking at the UI** (`docker compose build && docker compose up -d`); the running containers still serve the old code.

Run on your machine: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter api test:e2e`, then `pnpm build`.

## Known limitations

- **Pricing & Promotions** is not in the navigation: the application has no pricing or promotion pages, so none were invented. Store-level **Customers** has no page either (customers are organisation-level).
- Deactivating a store removes it from the store limit; whether the POS refuses sales in a deactivated store was not checked.
- *Edit access* sets a single role and scope per person (matching how users are created); people with several assignments keep only the one chosen on save.
- The demo user "Manager" currently holds Store Manager **organisation-wide**; use *Edit access* on their page to assign a store.
- Org-wide "Customers" and the legacy per-store KPI tiles were not redesigned beyond labels and scope.
