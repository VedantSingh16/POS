# Plan 3: POS MVP — Phased Implementation Plan

Prepared: 7 October 2026
Scope source: `plans/completefeaturelist.md` (138 approved features). Anything not on that list is out of scope.
Builds on: `plans/plan1.md`, `plans/plan2.md`. Plan 2's phase numbers are not reused here.
Inputs: the first-pass foundation brief (hierarchy, onboarding, shell, module pages) and the UI stack brief (shadcn/ui, Tailwind, Lucide, Recharts, TanStack Table, React Hook Form + Zod, Sonner, date-fns, cmdk, Framer Motion).

---

## 1. What the code actually contains today (verified 7 Oct 2026)

The documents in `docs/` and `plans/` were treated as claims. This is what the source shows.

| Area | Finding | Consequence for the MVP |
|---|---|---|
| Git | One commit (`Initial commit`). All Plan 1 and Plan 2 work is uncommitted: `src/admin`, `src/auth`, `src/pos`, `src/database`, `prisma/`, the e2e tests and the plans. | Commit a baseline before any change (Phase 0). |
| Data layer | Runtime tables are **raw SQL written in SQLite dialect**. `database.service.ts` rewrites that SQL for Postgres at runtime (drops `PRAGMA`, `COLLATE NOCASE`, `INSERT OR IGNORE`, `?` → `$n`) and also runs `CREATE TABLE IF NOT EXISTS` on boot. Migration `0001` creates the same 42 snake_case tables. | It works, but it is fragile. |
| Prisma schema | `schema.prisma` describes a **different model** (`Organization`, `UserRoleAssignment`, `ApprovalRule`… with no `@@map`) that no code uses. `seed.ts` also uses raw SQL. | The schema file is not a source of truth. Running `prisma migrate dev` against it would cause drift or create duplicate tables. Fix this first. |
| API surface | About 60 routes: `/api/auth/*` (login, me, logout, pin), `/api/admin/*` (overview, settings, audit, users, roles, stores, registers, catalog categories/uoms/tax-groups/products/variants), `/api/pos/v1/*` (catalog search, sessions, cash, holds, sales, approvals, inventory, locations, returns, reports, alerts, customers, promotions, bundles, transfers, demo seed). | Much of the MVP backend exists in thin form. Reuse it and harden it rather than rewriting it. |
| API depth | `pos.service.ts` covers 15+ modules in 326 lines. Request bodies are untyped `Record<string, unknown>`. | The "Live" labels in `docs/plan2-implementation.md` are overstated. Treat every module as "exists, unverified". |
| Defects found in review | (a) Receipt and credit-note numbers come from `COUNT(*)+1`, which can produce duplicates under concurrency. (b) `createTransfer`, `createBundle` and `adjustInventory` don't check that the referenced location or variant belongs to the caller's organisation, so cross-tenant references are possible. (c) The access token is stored in `localStorage` and the API sets `enableCors({ origin: true })`. | Fix (a) and (b) in Phase 0. Fix (c) in Phase 2. |
| Web app | Next.js **16.3.5**, React 19.2, Tailwind 4. A single `app/page.tsx` "pilot console" with hand-rolled Button/Card/Field. None of shadcn, Lucide, TanStack, RHF, Zod or Sonner is installed. `globals.css` overrides the Geist font with Arial. | Build the UI foundation fresh. Retire the pilot console once its flows are re-homed. `apps/web/AGENTS.md` requires reading `node_modules/next/dist/docs/` before writing Next code, because v16 has breaking changes. |
| Monorepo | Root `pnpm-workspace.yaml` has no `packages:` list. Each app has its own lockfile and workspace file. `packages/` is empty. Docker builds each app from its own folder as context. | Code can't be shared between web and API yet (Zod schemas, money/tax maths, permission codes). See decision D7. |
| Tests | 5 e2e specs (auth, admin, plan2 pilot, plan2 recommended, app) and one unit spec. Plan 2 records that they had not been run on this machine. | Record a real baseline run in Phase 0. |
| Claude config | `apps/api/.claude/skills` holds only two Prisma reference skills. No root `.claude/`. | The development-workflow skills go at the repo root (Phase 0). |

---

## 2. MVP definition

**Goal:** one organisation can onboard itself, set up stores, staff and roles, load its catalogue and opening stock, and run real retail trading in 1–5 stores. Trading covers selling, taking cash, card and UPI (recorded), printing GST invoices, handling returns, closing tills and reading the day's numbers. Everything is enforced server-side by role and store.

### 2.1 In the MVP: 62 of 138 approved features

**All 26 Essential features**

| Module | Refs |
|---|---|
| Sales & Checkout | 1.1, 1.2, 1.3, 1.6, 1.7, 1.9, 1.12 |
| Pricing | 2.1 |
| Tax | 4.1, 4.2, 4.3 |
| Catalogue | 5.1, 5.2, 5.4 |
| Inventory | 6.1, 6.8, 6.10 |
| Returns | 8.1, 8.2 |
| Registers | 11.1, 11.2, 11.3 |
| Staff & permissions | 12.1, 12.2, 12.4 |
| Reporting | 13.2 |

**36 Recommended features, chosen because a real store can't run a pilot without them**

| Refs | Why it's in the MVP |
|---|---|
| 1.4, 1.5, 1.13, 1.14 | The POS screen is built in this plan anyway. Quick keys, a product grid, keyboard shortcuts and tablet layout cost little and determine till speed. |
| 3.5, 3.6 | Manual discounts are Essential to a cashier's job. Without approval and reason codes they are a loss-prevention hole. |
| 4.7, 4.8 | Cash rounding at the till. GST tax invoices and credit notes are a legal requirement in India (D3). |
| 5.3, 5.5, 5.6, 5.13, 5.16 | Brands, multiple barcodes, units of measure, lifecycle states and **CSV import**. Nobody types 2,000 SKUs by hand at go-live. |
| 6.6, 6.7, 6.11, 6.12 | Returns can be restocked as damaged (needs 6.6). Negative-stock blocking or warning, low-stock threshold and reorder point. |
| 7.1 | Stores are stock locations. The MVP has one location per store. |
| 8.4, 8.10, 8.11, 8.12 | A refund needs a tender, a reason, a restock decision and a high-value approval. |
| 9.1, 9.2, 9.3 | Customer profile, quick create at checkout and purchase history. These are the minimum needed to find a receipt by customer. |
| 11.4, 11.5 | Paid-in/paid-out and cash drops. Without them the drawer never balances. |
| 12.3, 12.5 | Store-scoped access, and an allow / deny / require-approval state. |
| 13.1, 13.5 | Cash reconciliation report and CSV export (the accountant needs both). |
| 14.1, 14.2, 14.3, 14.4, 14.9 | Owner and store-manager dashboards. Alerts for low stock, cash variance and registers left open. |

### 2.2 After the MVP, in this order

1. **MVP+1, still Recommended:** 5.7 images, 5.9 services, 8.3 exchange, 8.5 store credit, 8.9 return eligibility, 11.6 end-of-day consolidation, 12.10 staff sales performance, 2.2 store-specific prices (the schema is already there), 9.4–9.6 customer CRM fields.
2. **Promotions and loyalty:** 3.1, 3.4, 2.5, 2.6, 10.1, 10.2.
3. **Multi-location stock:** 6.2–6.5, 7.3, 7.5–7.8.
4. **Bundles and weighted goods:** 1.10, 5.8, 1.11. 1.2 price-embedded barcodes ship with weighted goods.
5. **Platform integration:** Plan 2 Phase 1 and Phase 6, unless D1 pulls it forward.
6. **Advanced and Optional features**, following Plan 2 Stages F and G.

Unlisted features stay out: offline selling, payment-terminal integration, purchase orders, stock counts, e-commerce and food service.

---

## 3. Decisions (defaults applied unless you say otherwise)

| # | Decision | Default used in this plan | What changes if you pick otherwise |
|---|---|---|---|
| D1 | Identity: native POS login vs Platform tokens | **Native login for the MVP**, behind an `AuthProvider` seam so Platform JWKS tokens can be added later without touching guards. | If the pilot must run inside the DeltCRM platform, Plan 2 Phase 1 moves in before Phase 3, adding about 1–2 weeks. |
| D2 | Business type | **General retail.** No tables, KOT or tips. | Hospitality would add 12.12 and table and course flows. |
| D3 | Tax | **India GST.** GSTIN on organisation and store, HSN/SAC on product, CGST+SGST split on intra-state invoices. IGST later. | Another jurisdiction changes Phase 4 and the invoice template. |
| D4 | Tenders | Cash, card and UPI are **recorded** with an optional reference. Split tender is supported. No terminal integration. | — |
| D5 | Receipts | Browser print. 80 mm thermal layout plus A4 invoice. | ESC/POS direct printing is post-MVP. |
| D6 | Data layer | **Introspect the live DB into `schema.prisma`** (`prisma db pull`, with `@@map`/`@map` to the snake_case tables). Delete the unused model. Migrations become the only schema path. Remove boot-time `CREATE TABLE`. Move services to the typed client **as each phase touches them**, not in one big rewrite. | — |
| D7 | Shared code | Wire the pnpm workspace with `packages/shared` (Zod schemas, permission codes, money/GST maths) and move Docker build context to the repo root. | If you'd rather not touch Docker, the schemas get duplicated in each app. That works but drifts. |
| D8 | Organisation creation | The organisation is provisioned by bootstrap (`POS_ORGANIZATION_*` env today, Platform later), as Plan 1 says. **Onboarding is the admin's first-login setup wizard.** There is no public "sign up a new org" page. | A self-serve signup page would need an org-provisioning endpoint and abuse controls. |

---

## 4. Target architecture

### 4.1 Hierarchy, as represented in data and UI

```text
Organization (tenant: every row carries organization_id)
├── Settings (currency INR, timezone, GSTIN, receipt, approval thresholds)
├── Roles ── RolePermissions (permission code × ALLOW | REQUIRE_APPROVAL)
├── Users ── UserRoles (role × scope: ORGANIZATION | STORE:<id>)
└── Stores (quota from entitlement)
    ├── Registers ── RegisterSessions ── CashMovements
    ├── Stock location ── InventoryBalances / InventoryMovements (ledger)
    └── Sales ── Lines / Payments / Returns
Catalogue (org-level): Categories, Brands, UoM, TaxGroups, Products ── Variants ── Barcodes / Prices
Customers (org-level)
```

Access is decided like this, and **always on the server**: user → role assignments (org-wide or per store) → permission codes → effect. The frontend only hides what the server would refuse anyway.

### 4.2 Web routes (Next.js App Router)

```text
/login                     email + password (+ organisation if the email is ambiguous)
/lock                      PIN unlock for a shared till
/onboarding/[step]         welcome · organization · administrator · stores · roles · users · tax-receipts · review

/org                       ORGANISATION ADMINISTRATION (org-scoped permissions)
  /org                     overview: setup checklist, store quota, staff by role, recent audit
  /org/users, /org/users/[id]          (tabs: profile, access, activity)
  /org/roles, /org/roles/[id]          (permission matrix)
  /org/stores, /org/stores/[id]        (tabs: overview, registers, staff, settings)
  /org/catalog/products, /[id], /import, /org/catalog/categories, /brands, /tax
  /org/customers, /org/customers/[id]
  /org/reports, /org/settings/{general,tax,receipts,approvals,security}, /org/audit

/s/[storeId]               STORE OPERATIONS (store context lives in the URL)
  /s/[storeId]             store dashboard
  /s/[storeId]/sales, /sales/[id]       (labelled "Sales" — a retail POS has sales/receipts, not orders)
  /s/[storeId]/returns, /returns/new
  /s/[storeId]/inventory, /inventory/ledger, /inventory/adjust
  /s/[storeId]/registers, /registers/[sessionId]
  /s/[storeId]/approvals, /alerts, /staff, /reports

/s/[storeId]/pos           POINT OF SALE (separate full-screen layout, no sidebar)
```

- **Store context in the URL** rather than in global state. Deep links, multiple tabs and the back button all work. The switcher just navigates. The guard checks access to `storeId` on every call.
- **The catalogue is organisation-level.** Store pages show it with that store's stock. Prices are org-level in the MVP, with 2.2 store prices after.
- **Navigation comes from one config** (`lib/nav.ts`: label, href, Lucide icon, permission, scope). The sidebar, ⌘K palette and breadcrumbs all read from it. A cashier with only `sale.*` lands straight on `/s/:id/pos`.

### 4.3 Web folder layout

```text
apps/web/
  app/                      routes only: thin pages that compose features
    (auth)/  onboarding/  (admin)/org/  (store)/s/[storeId]/  (pos)/s/[storeId]/pos/
    api/[...path]/route.ts  BFF proxy: forwards to the API with an httpOnly session cookie
  components/ui/            shadcn primitives, restyled to POS tokens
  components/app/           AppShell, Sidebar, Topbar, StoreSwitcher, CommandMenu, PageHeader, Breadcrumbs
  components/data/          DataTable (TanStack), StatusBadge, Money, KpiTile, EmptyState, ErrorState
  components/form/          FormField wrappers (RHF + Zod), FormSheet, ConfirmDialog
  features/<module>/        api.ts · queries.ts · schemas.ts · components/ (one folder per module)
  lib/                      api-client, permissions, nav, format (date-fns, Intl INR)
  mocks/                    preview fixtures used only where an endpoint doesn't exist yet
```

### 4.4 API structure (NestJS)

Split `pos.service.ts` as each phase reaches its module, not in one go: `catalog/`, `registers/`, `sales/`, `returns/`, `inventory/`, `customers/`, `reports/`, `alerts/`, `onboarding/`. Each module has a controller, a service, Zod DTOs (from `packages/shared`) and tests. Guards are `AuthGuard` → `StoreScopeGuard` → `PermissionsGuard` (with approval effect). Every query is filtered by `organization_id` from the session, never from the request body.

### 4.5 UI stack and how each library is used

| Library | Used for | Not used for |
|---|---|---|
| shadcn/ui + Tailwind 4 | All primitives, restyled through CSS tokens (`--primary`, `--success`, `--warning`, `--danger`, radius, density) | — |
| Lucide | Every icon, via the nav config | Any second icon set |
| TanStack Table | One `DataTable` for users, roles, stores, products, sales, inventory, customers, ledger, audit. Server-side paging, sort and filter, column visibility, row actions, skeleton/empty/error states | The POS cart. That's a plain list, built for speed |
| TanStack Query *(added; not on the brief's list)* | Caching, retries, loading/error states, optimistic cart and approval updates | — |
| RHF + Zod | Every form. The same Zod schemas validate on the API | — |
| Recharts | Sales trend, sales by hour, tender mix, top categories | Decorative charts |
| Sonner | Action feedback (saved, sale complete, approval granted) | Errors that block a flow. Those are shown inline |
| cmdk | ⌘K navigation and actions, and POS product search | — |
| date-fns | Report ranges, "x minutes ago", shift durations | — |
| Framer Motion | Probably nothing. The CSS transitions shadcn already ships with are enough. Added only if a specific interaction needs it | Page transitions |

TanStack Query is the one addition. It earns its place because every page needs consistent loading, error and refetch behaviour, and the POS needs optimistic updates. Hand-rolling that per page is what produced the current `useEffect` tangle.

**Visual direction:** neutral slate surfaces with one brand accent, Geist Sans with tabular numerals for money, and an 8 px spacing scale. There are two densities. **Compact** (32 px rows) is for back-office tables. **Touch** (≥44 px targets) is for the POS and onboarding. Status colours are semantic only. Money is formatted with `Intl` `en-IN` (₹1,23,456.00) and stored as integer paise (the existing `*_cents` columns).

---

## 5. Phases

Each phase ends with the **verification gate**:
- API: `pnpm build`, `pnpm lint`, `pnpm test` and `pnpm test:e2e`
- web: `pnpm lint`, `pnpm typecheck` (added in Phase 0) and `pnpm build`
- Docker: `docker compose config`, `docker compose build`, `docker compose up -d` and `docker compose ps`
- a manual walkthrough of that phase's flows

A phase isn't done until the gate passes and its exit criteria are demonstrated.

Sizes are relative effort for one full-stack developer: S ≈ 2–4 days, M ≈ 1–1.5 weeks, L ≈ 2–3 weeks.

### Phase 0 — Baseline, data layer and guardrails · **M**
*Goal: a committed, tested, honest starting point that is safe to build on.*

1. **Commit the current tree** on a `baseline` branch. Run the API and web builds and all tests, run Docker, and record the results in `docs/baseline.md`. That file records what passes and what fails, without claiming more.
2. **Development workflow skills** at the repo root under `.claude/skills/`. Keep the set to the ones that earn their place: `codebase-analysis`, `implementation-planning`, `frontend-ui` (this plan's tokens and components), `backend-api`, `database-prisma`, `testing`, `security-review` (tenant and store isolation checklist), `docker`, `git-safety` and `verification-gate`. Requirements analysis and code review fold into planning and verification. Keep the existing Prisma skills under `apps/api`.
3. **D6 data layer:** `prisma db pull` → reconcile into `schema.prisma` with mapped names. Delete the unused model. Baseline migration via `migrate resolve`. Remove `ensureSchema()` from boot. Keep the SQL translation shim only until the services that use it are migrated.
4. **D7 workspace:** root `pnpm-workspace.yaml` with `apps/*` and `packages/*`, a single lockfile, `packages/shared` (permission codes, Zod primitives, `money.ts`, `gst.ts`), turbo tasks, and Docker contexts moved to root.
5. **Fix the review defects:**
   - per-store document sequences (a `document_sequences` row locked `FOR UPDATE`) in place of `COUNT(*)+1`
   - organisation-ownership checks on every referenced id (variant, location, store, customer, register, sale) in transfers, bundles, adjustments, returns and sales
6. **Plan 2 Phase 0 security gaps:**
   - 0.1/0.2 store-scoped guard and store-filtered lists
   - 0.4 ambiguous login
   - 0.12 typed DTOs on existing routes
   - 0.13 isolation e2e tests: org A can't read or write org B on every route, and a cashier in store 1 can't act in store 2
7. **CI** (GitHub Actions or equivalent) running the gate.

**Exit:** a green gate on a committed baseline. Isolation tests pass. `schema.prisma` equals the live DB.

### Phase 1 — Design system, app shell and all route skeletons · **M**
*Goal: the first-pass foundation from your brief. Every module is visible, navigable and consistent.*

- Install and theme shadcn/ui on Tailwind 4. Fix the font. Define tokens for colour, radius, density and focus ring. Add a dev-only `/dev/ui` page showing every primitive in each state.
- Build the shared components (4.3): AppShell, Sidebar (collapsible, role-filtered), Topbar (organisation name, **StoreSwitcher**, ⌘K **CommandMenu**, notifications bell, user menu), PageHeader, Breadcrumbs, **DataTable**, StatusBadge, Money, KpiTile, EmptyState, ErrorState, ConfirmDialog, FormSheet.
- Create every route in 4.2 as a real page with title, description, primary action, search and filters, and a table or cards plus empty, loading and error states.
  - **Where an API endpoint already exists, call it.** Where it doesn't, read from `mocks/` through the same `features/*/api.ts` function, and show a small "Preview data" badge so mock data is never mistaken for real.
- POS layout shell at `/s/:id/pos`: a categories and quick-keys rail, search plus product grid, and a cart panel with totals and a Pay button. Includes cart interactions with preview data (add, remove, quantity).
- Responsive: desktop and laptop first, tablet (≥768 px) for POS and dashboards, with the sidebar becoming a sheet on narrow screens.
- Accessibility: keyboard reachable, visible focus, labelled controls, contrast at AA.

**Exit:** every route renders with no console errors. Navigation and store switching work. The table, form, dialog, tab and dropdown patterns are each used at least once and look like one product. The old pilot console stays reachable at `/pilot` until its flows are replaced.

### Phase 2 — Authentication, session and access control · **S–M**
*Features: 12.1, 12.2, 12.3, 12.4, 12.5 (engine)*

- **API:**
  - Session cookie (httpOnly, SameSite=Lax) issued via the BFF route handler. The token never reaches JS or `localStorage`, and CORS narrows to the web origin.
  - Lockout and idle timeout (Plan 2 0.3, 0.8).
  - `/auth/me` returns user, organisation, roles, effective permissions per scope and accessible stores.
  - `REQUIRE_APPROVAL` is returned as a distinct 403 code so the UI can raise the manager-PIN overlay.
- **Web:**
  - Login, organisation picker when needed, and `/lock` with PIN unlock for shared tills (auto-lock after idle).
  - `usePermission()` and `<Can>`, with the nav filtered from `/me`.
  - The landing route depends on role: admin → `/org`, manager → `/s/:id`, cashier → `/s/:id/pos`.
- **Tests:** a user → role → permission → decision matrix over real routes: admin, manager, cashier and inventory user × own store and other store.

**Exit:** a cashier sees only the POS and their store. Direct API calls outside their scope get 403. A lockout is audited.

### Phase 3 — Onboarding and organisation administration · **M–L**
*Features: 12.2–12.5 UI, 7.1, and the admin side of 5.x settings*

- **Onboarding wizard** (resumable, with progress kept in `organization_settings.onboarding`):
  1. **Welcome**: what will be set up, and roughly how long it takes.
  2. **Organisation**: legal and trade name, business type (retail), address, GSTIN, currency (INR, fixed), timezone.
  3. **Administrator**: confirm profile, replace the bootstrap password, set a PIN. Explains that this person runs the organisation.
  4. **Stores**: add one or more stores (code, name, address, GSTIN if different) and their registers. The quota meter shows `3 of 5 used` from the entitlement.
  5. **Roles**: review the five system roles with a plain-language summary of each. Optionally duplicate one into a custom role.
  6. **Users**: invite or create users, each with a **role and store assignment in the same row**, so it reads as user → role → store.
  7. **Tax and receipts**: default tax groups (GST 0/5/12/18/28 %), receipt header and footer, cash rounding.
  8. **Review**: a hierarchy diagram of the organisation, its stores and staff per store, then **Finish** → `/org`.
  - The order differs from the brief (stores and roles before users) because a user can't be assigned to a store or role that doesn't exist yet.
- **Organisation pages:**
  - **Overview** shows a setup checklist until onboarding is complete.
  - **Users** has a table and an add-user sheet. User detail has an **effective-access** tab (permission, source role, scope), plus reset credentials and suspend.
  - **Roles**:
    - The **permission matrix** groups the real permission codes by module, each set to Allow / Requires approval / No access.
    - System roles are locked but can be duplicated.
    - A custom role can't be disabled while it's assigned.
    - The brief's generic View/Create/Edit/Delete grid is not used. POS rights are actions (apply discount, void, refund, open till), and a CRUD grid would misdescribe them.
  - **Stores** has a list with quota, and detail tabs for overview, registers, staff and settings.
  - **Settings** covers general, tax, receipts, **approval thresholds** (discount %, refund amount) and security (PIN length, idle lock).
  - **Audit** is a filterable log with before/after diff.
- **API additions:** onboarding state, reset credentials, effective access, role disable, and invited status (Plan 2 0.5–0.8, 0.10).

**Exit:** starting from a fresh database, an admin completes onboarding and ends with 2 stores, 4 users in 3 roles, and correct landing and access for each user. The quota limit is enforced in the UI and, concurrently, in the API.

**Milestone A: Foundation.** Your first-pass brief is delivered with real data in organisation administration and preview data elsewhere.

### Phase 4 — Catalogue, pricing and tax · **M–L**
*Features: 2.1, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.13, 5.16*

- **API:**
  - Edit endpoints for products and variants, which are currently create-only.
  - Status enum (draft, active, discontinued, seasonal, blocked).
  - Brands. Multiple barcodes per variant with a uniqueness check across the organisation.
  - UoM with decimals allowed per unit. Price history (audited).
  - Tax groups with HSN and a tax-inclusive/exclusive flag.
  - `/catalog/import`: CSV upload → validate → preview diff → commit, in a single transaction.
- **Web:**
  - Product list with filters (category, brand, status, tax group) and inline stock per store.
  - Product create/edit sheet with a variant builder (attributes → generated variants, editable SKU, barcode and price grid).
  - Category tree, brands and tax pages.
  - Import wizard with row-level errors.
- `packages/shared/gst.ts` holds the one implementation of inclusive and exclusive line tax and CGST/SGST split, with paise rounding. **Unit tests** cover it against hand-worked invoices.

**Exit:** a 500-row CSV imports with clear errors for bad rows. Searching by name, SKU, barcode or brand finds variants in under 200 ms on 10k variants.

### Phase 5 — Register and checkout (the core POS) · **L**
*Features: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 1.12, 1.13, 1.14, 3.5, 3.6, 4.7, 4.8 (invoice), 9.2, 11.1, 11.3, 11.4, 11.5, 11.2*

- **Register:**
  - Open with float (blocked if the register is already open).
  - Live drawer balance, paid-in, paid-out and cash drop with reasons.
  - Close with a **blind count** by denomination → expected vs counted → variance. Variance over the threshold raises an alert.
  - Z-summary.
- **POS screen:**
  - Search is cmdk-style: type-ahead over name, SKU, barcode and brand.
  - **Barcode wedge detection** treats fast keystrokes ending in Enter as a scan. An unknown code goes to search with the code prefilled.
  - Category rail with **quick keys**, configurable per store.
  - Variant picker dialog.
  - Cart: quantity stepper and direct entry, line note, line discount, remove, reorder.
  - Attach a customer, or quick-create one.
  - **Hold/resume** list.
- **Payment:**
  - Cash with tendered amount, change and rounding. Card or UPI with reference. Split tender.
  - "Complete" sends with the existing `clientSaleId` idempotency key. **The server re-prices and re-taxes the sale; the client total is only a preview.**
  - The receipt prints as an 80 mm thermal slip or an A4 GST invoice, with reprint.
- **Discounts:**
  - Line or cart, % or amount. A reason code is required.
  - Above the threshold, or for a role with `REQUIRE_APPROVAL`, a **manager-PIN overlay** approves in place, and the decision is audited and tied to the sale.
- **Keyboard map** (shown with `?`):
  - `/` or F2: search
  - `+` / `−`: quantity
  - Del: remove line
  - F4: hold
  - F6: customer
  - F8: discount
  - F12 or Ctrl+Enter: pay
  - Esc: back
- **Performance budget:** add-to-cart under 50 ms (local and optimistic). Search results under 150 ms. Sale completion under 1 s on LAN.
- **Tests:**
  - Unit tests for cart maths: add, quantity change, subtotal, discount, tax, rounding and total.
  - e2e: open register → sell (scan, variant, discount with approval, split tender) → invoice numbering is sequential under 20 concurrent sales → close with variance.

**Milestone B: Sellable.** A store can trade for a full day.

### Phase 6 — Inventory · **M**
*Features: 6.1, 6.6, 6.7, 6.8, 6.10, 6.11, 6.12, 14.3*

- **API:**
  - The ledger is append-only. Balances are a projection and can be rebuilt from the ledger by a tested command.
  - Statuses are sellable and damaged.
  - Adjustments carry a reason code. A large adjustment needs approval (using the 12.5 engine).
  - A per-store negative-stock policy: block, warn or allow.
  - Reorder point and low-stock threshold per variant per store.
  - **Opening stock import** (CSV).
- **Web:**
  - Stock on hand by store, with filters for low, out and damaged.
  - Ledger view with movement type, reference link (sale, return or adjustment) and actor.
  - Adjust-stock sheet.
  - Low-stock panel. The POS shows stock on the product tile and warns or blocks according to the store policy.

**Exit:** opening stock → sale → return to damaged → adjustment all reconcile, and the balance equals the sum of the ledger in a test.

### Phase 7 — Sales history, returns and refunds · **M**
*Features: 8.1, 8.2, 8.4, 8.10, 8.11, 8.12, 4.8 (credit note)*

- **Sales list** with date, register, cashier, tender, status and customer filters. **Sale detail** shows lines, payments, approvals, reprint and audit trail.
- **Return flow:**
  1. Find the receipt (scan the receipt barcode, or search by number, customer or phone).
  2. Select lines and quantities, capped at sold minus already returned.
  3. Choose a reason and a restock decision (sellable or damaged) per line.
  4. Refund to the original tender. Cash refunds come from the open drawer.
  5. Over the threshold, manager approval is required.
  6. Print the GST credit note.
- **Tests:** over-return is blocked, partial return twice works, refunds reconcile into the drawer, and stock lands in the right status.

### Phase 8 — Customers, dashboards, reports and alerts · **M–L**
*Features: 9.1, 9.3, 13.1, 13.2, 13.5, 14.1, 14.2, 14.4, 14.9*

- **Customers:** list, profile and purchase history (sales and returns). Quick-create at the POS was already built in Phase 5.
- **Store manager dashboard:**
  - Today's sales, transactions, average order value and items per sale versus the same weekday last week.
  - Sales-by-hour chart. Open registers with cashier and duration. Pending approvals. Low stock. Recent exceptions.
- **Owner dashboard:** the same KPIs across stores, a 30-day trend, gross margin (cost captured at sale), a store comparison table and tender mix.
- **Reports** (filters for date range, store, register and cashier; CSV export gated by `report.export`):
  - sales summary
  - sales by product and category
  - **GST summary by rate/HSN**, which the accountant needs for filing
  - tender summary
  - returns
  - cash reconciliation by session, with variance
- **Alerts:**
  - A scheduled job (`@nestjs/schedule`; Redis is already provisioned if a queue is needed later) raises "register not closed by store close time", cash variance and low stock.
  - Alerts appear in the bell with acknowledgement and are routed to managers of that store.

**Milestone C: Store-complete.** All 62 MVP features are present.

### Phase 9 — Hardening and pilot go-live · **M**

- **Security review** using the skill checklist:
  - tenant and store isolation suite on **every** route
  - PIN brute-force throttling
  - audit coverage of every sensitive action
  - no secrets in the web bundle
  - dependency audit
- **Quality pass on every page:**
  - empty, loading and error states
  - keyboard paths
  - tablet layout
  - a11y (axe)
  - a Playwright smoke test of the full day: onboarding → catalogue import → open → sell → return → close → report
- **Ops:**
  - Postgres backup and restore, rehearsed once
  - migration rollback note
  - health and ready checks
  - structured logs
  - demo-data seed separated from production seed
- **Docs:** README for running the stack, an admin guide and a cashier quick card (shortcuts and the close-of-day routine).
- Replace `docs/plan2-implementation.md` status claims with a verified feature-status table.

**Milestone D: Pilot.** One real store trades for a week. Every till closes with an explained variance, and the GST summary matches the invoices.

---

## 6. Sequence at a glance

```text
P0 Baseline ─► P1 Shell+skeletons ─► P2 Auth/access ─► P3 Onboarding+Org admin    ══ Milestone A Foundation
                                                   └─► P4 Catalogue/tax ─► P5 Register+POS ══ Milestone B Sellable
                                                                      └─► P6 Inventory ─► P7 Returns ─► P8 Customers/Dash/Reports ══ Milestone C
                                                                                                                  └─► P9 Hardening ══ Milestone D Pilot
```

P4 can start in parallel with P3 once P2 is done, if there are two developers. Inventory (P6) comes before returns (P7) because the restock decision needs stock statuses, and before go-live because opening stock must be loaded.

Indicative total for one developer: about 14–18 weeks. With two developers splitting backend and frontend from P3 onward: about 9–11 weeks.

## 7. Main risks

| Risk | Mitigation |
|---|---|
| The data-layer reconciliation (D6) uncovers drift between migration 0001 and the boot-time schema | `db pull` against a database created **only** from migrations, compared with one created by boot. Resolve the differences before anything else. |
| Feature claims in existing docs are optimistic | Each phase starts by running the existing e2e test for that module and reading its service code. Status is only marked done after the phase gate passes. |
| Next.js 16 API differences | Read `node_modules/next/dist/docs` before writing routing, proxy/middleware and caching code (per `AGENTS.md`). |
| D1 flips to Platform auth mid-way | The `AuthProvider` seam from Phase 2 and permission codes kept identical to the manifest keep the switch local to auth. |
| Scope creep into Advanced features | §2.2 is the backlog. Anything not in §2.1 needs an explicit decision. |
