# Plan 13 — Shared till login with cashier switching, and editable roles with safe-level warnings

Status: plan only, nothing implemented. Written 19 Oct 2026 from the code at commit `e37ddf1` (plus the uncommitted changes in `schema.prisma`, `auth.guard.ts`, `auth.module.ts`, `auth.types.ts`) and the screenshots of `/org/roles` and `/org/roles/<Inventory User>` on http://3.237.177.106:3100.

Two features:

- **Part A — one till login per store; cashiers are just names.** The store manager adds cashier names. At billing the cashier picks their own name (and can switch any number of times) without logging the POS out and in.
- **Part B — role permissions become editable**, including system roles. When an administrator raises a role above its safe level, the app shows a warning. The change is saved only after the warning is confirmed.

Do Part B (Phases 1–2) first. Part A adds a new permission to the Store Manager template, and Part B changes how template changes reach roles that have been edited.

---

## 0. What the code does today (confirmed in source)

### Cashiers / bill handler
| Area | Today |
|---|---|
| `Sale.handledById` (schema ~L789) | Already exists: "Employee selected as the person handling the bill". `createdById` is the logged-in actor. |
| `PosService.eligibleSaleHandlers` (`pos.service.ts:1007`) | Lists **Users** (full login accounts) assigned to the store who have `sale.create`. It calls `getUserContext` once per user (N+1, max 500). |
| `completeSale` (`pos.service.ts:1044-1048`) | Takes `handledById`, checks it against the eligible list and writes `snapshot.billHandler` for the receipt. Store setting `requireBillHandler` forces a choice. |
| POS screen (`features/pos/pos-screen.tsx:126, 352, 487`) | Shows a "Bill handled by" dropdown inside the payment dialog. The default is the logged-in user. |
| Other till actions | Register open/close (`:645, :762`), cash movements (`:703`), held sales (`:932`), returns (`:1779`) and approval requests record only `context.userId`. |
| Reports cashier filter (`pos.service.ts:2080-2090`) | Filters `handledById`, falling back to `createdById`. Only accepts a **User** id. |
| Lock / PIN | `User.pinHash`, `/auth/unlock`, `idleLockMinutes`. The lock screen re-authenticates the **same** user. |

**Gap:** every name in the "handled by" list must be a full user with an email, a 12+ character password and a role. You can't add "just a name". A shared till login would only ever list itself.

### Roles
| Area | Today |
|---|---|
| `AdminService.updateRole` (`admin.service.ts:517`) | `if (role.isSystem) throw 'System roles cannot be edited'`. |
| Role page (`app/(app)/org/roles/[id]/page.tsx`) | `PermissionMatrix readOnly={role.system || …}`, labelled "System role: read only" (as in the screenshot). |
| **Startup reconcile** (`bootstrap/foundation.ts:73-92`) | On every API start, for each system role it runs `rolePermission.deleteMany` and re-creates the permissions from `SYSTEM_ROLES`. **If editing were simply enabled, every edit to a system role would be lost on the next restart or deploy.** |
| Custom roles | Already editable, with no warnings, no diff and no reason recorded. The audit records only `permissionsChanged: true`, with no before/after. |
| Store-manager assignment (`admin.service.ts:323-331`) | A store manager sees only roles whose allowed permissions are all within the manager's own store permissions. This is a good anti-escalation rule; keep it. |
| `hasPermission` (`authorization.service.ts`) | A store-scoped grant of an organisation-only permission (for example `users.manage` on a store-assigned Cashier) has **no effect**. Today the editor says nothing about this. |

---

## 0.1 Decisions to confirm before coding

My recommendation is marked ★.

1. **Cashier PIN when switching.** ★ A store setting "Require cashier PIN to switch", **off by default**. Without a PIN anyone can pick anyone's name. That's fine for a small bakery, but weak for cash accountability.
2. **Who creates the till login.** ★ The organisation admin **and** the store manager of that store. The till account is tightly limited, so letting a manager create it is safe.
3. **When the cashier is picked.** ★ Default "**sticky**": the cashier stays selected until someone switches. A store setting "Ask on every bill" clears the cashier after each completed sale.
4. **Existing personal Cashier logins (the 5 people shown).** ★ Keep them working. Add a one-click "Import as cashier names" on the store's staff page. The admin decides later whether to disable the personal logins.
5. **Safe level for custom roles.** ★ When creating a custom role, pick a "Based on" template (Cashier / Supervisor / Store Manager / Inventory User / Blank). The template is the safe ceiling. For Blank, only view-level (low-risk) permissions are safe.
6. **System role rename/disable.** ★ Not allowed. Code finds the admin role by name (`ORGANISATION_ADMINISTRATOR_ROLE`). Permissions are editable; name and status are not.
7. **Organisation Administrator role.** ★ Stays locked, always with the full catalogue, so nobody can lock themselves out.

---

# PART B — Editable roles with safe-level warnings

## Phase 1 — Backend: editable system roles that survive restarts

### 1.1 Schema (`apps/api/prisma/schema.prisma`, new migration `0026_editable_roles`, numbered after your pending schema changes land)
On `Role`:
- `templateKey String? @map("template_key")`: a stable key for system roles (`cashier`, `supervisor`, `store_manager`, `inventory_user`, `org_admin`), and the "Based on" template for custom roles. Backfill system roles by name.
- `customizedAt DateTime? @map("customized_at") @db.Timestamptz(3)` and `customizedById String? @db.Uuid`. Null means the role still follows its template.
- `templateVersion Int @default(0) @map("template_version")`: the template version the role was last synced to or reviewed against.

Optional, recommended: a new `RolePermissionChange` table (id, orgId, roleId, actorUserId, before Json, after Json, elevated Json, reason, createdAt). It drives the role history tab. The AuditLog also gets the full diff.

### 1.2 One shared safety model (`packages/shared/src/permissions.ts`)
Put this in the shared package so the web warning and the API check use **the same code**.
- `PERMISSION_RISK: Record<PermissionCode, { level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; reason: string; scope: 'ORG' | 'STORE' | 'BOTH' }>`. Starting proposal:
  - **CRITICAL**: `roles.manage`, `users.manage`, `org.settings.manage`, `stores.manage`. These let someone grant access or change the business setup.
  - **HIGH**: `sale.void`, `refund.create`, `cash.manage`, `approval.manage`, `pricing.manage`, `tax.manage`, `inventory.manage`, `dayclose.manage`, `catalog.manage`, `catalog.distribute`, `transfer.manage`, `registers.manage`, `store.staff.manage`, `store.settings.manage`, `attendance.manage`, `audit.view`, `report.export`.
  - **MEDIUM**: `sale.discount`, `customer.manage`, `promotion.manage`, `catalog.manage.store`, `store-catalog.verify`, `alert.manage`, `register.open`, `register.close`.
  - **LOW**: every `*.view`, `sale.create`, `sale.hold`, `attendance.clock`, `approval.request`.
- `ROLE_TEMPLATES` (moved from `permission-catalogue.ts` `SYSTEM_ROLES`, with `key` and `version`). These are the "safe level" per role.
- `assessRoleChange({ template, before, after, storeAssignable, assignedCount, isTillRole })`. It returns:
  - `elevated[]`: permissions that are ALLOW or REQUIRE_APPROVAL in `after` but not in the template's safe set. Each carries its risk and reason. A permission set to REQUIRE_APPROVAL is still reported, one risk level lower.
  - `newlyHighRisk[]`: HIGH or CRITICAL permissions added compared with `before`, even when inside the template. The warning covers the change itself.
  - `ineffective[]`: organisation-only permissions on a role that is store-assignable. They do nothing at store scope, as `hasPermission` shows.
  - `conflicts[]`: separation-of-duties pairs, for example `refund.create` + `approval.manage`, `sale.void` + `approval.manage`, `users.manage` + `roles.manage` on a non-admin role, `cash.manage` + `dayclose.manage`.
  - `storeAssignabilityLost`: the role would now exceed the Store Manager template, so store managers could no longer assign it (see `admin.service.ts:329`).
  - `blocked[]`: hard stops (1.4).
  - `confirmLevel`: `NONE | WARN | TYPE_TO_CONFIRM` (CRITICAL means type the role name).

### 1.3 API changes (`admin.service.ts`, `admin.controller.ts`)
- `updateRole`: remove the blanket `isSystem` throw. Replace it with:
  - The Organisation Administrator role → 400 "The administrator role always has every permission".
  - System role: reject any `name` or `status` change. Allow permission changes only.
  - Load the current effects, run `assessRoleChange`, and count assignments with their stores.
  - If `blocked` is non-empty → 400 with the list.
  - If there are warnings and the body's `acknowledgedPermissions` doesn't cover every `elevated` and `newlyHighRisk` code → **409 `ROLE_ELEVATION_CONFIRMATION_REQUIRED`** with the full assessment. The UI cannot be bypassed by calling the API directly.
  - HIGH or CRITICAL changes need a `reason` (at least 10 characters).
  - Save. For a system role, set `customizedAt` / `customizedById`. Write the audit `role.permissions.changed` with before, after, elevated, reason and the affected-user count.
- `createRole`: the same assessment against the chosen `templateKey`. The UI starts from the template's permissions.
- New `POST /admin/roles/:id/reset` (`roles.manage`): restore template permissions, clear `customizedAt`, and audit `role.permissions.reset`.
- New `POST /admin/roles/:id/assess` (`roles.view`): a dry run that returns the assessment for a proposed set, so the UI can show live impact numbers (people and stores affected).
- `getRole` / `listRoles` DTO: add `templateKey`, `customized`, `templateUpdateAvailable` and `defaultEffects` (the template), so the UI can mark differences from the default.
- **Anti-escalation:** a non-admin with `roles.manage` cannot grant a permission they don't hold themselves. This is a hard block.
- Fix: `PermissionMatrix` currently sends every code, including DENY rows, as `permissions`. Keep the API tolerant of that, but store only the effects that aren't the default, or keep DENY rows explicitly. Pick one and document it, because DENY overrides ALLOW across roles in `hasPermission`.

### 1.4 Hard blocks (refused outright, not warnings)
- Editing the Organisation Administrator role, or renaming or disabling a system role.
- Giving a role that is assigned to a **till account** (Part A) any CRITICAL permission, or any organisation-scope `*.manage` permission. A shared password must never manage users, roles or settings.
- A grant above the editor's own permissions (1.3).

### 1.5 Startup reconcile (`bootstrap/foundation.ts` and the same block in `auth.service.ts:133` for sign-up)
- `customizedAt IS NULL` → reconcile to the template as today, and set `templateVersion`.
- `customizedAt` set → **don't touch the permissions.** If `template.version > role.templateVersion`, write an `Alert` / flag "New default permissions available for <role>". The admin reviews them in the UI and either accepts them (through the same warning flow) or dismisses them, which bumps `templateVersion`.
- The admin role still always gets the full catalogue.
- Tests must prove that restarting keeps the edits.

### 1.6 Effect timing
Permissions take effect on the user's next request. Confirm that `getUserContext` is rebuilt per request in `auth.guard.ts`. The web session profile (`/auth/me`) must not cache stale permissions; check `lib/server/session`.

## Phase 2 — Web: role editor with a warning step

Files: `features/permission-matrix.tsx`, `features/role-editor.tsx`, `app/(app)/org/roles/[id]/page.tsx`, `app/(app)/org/roles/page.tsx`, plus a new `features/roles/elevation-dialog.tsx`.

1. **Role page:** drop the read-only label for system roles (except the admin role). Show "System role · follows default" or "System role · **modified** on <date> by <name>".
2. **Matrix:**
   - Each row shows a risk badge (Low, Medium, High, Critical).
   - Rows that differ from the default show a dot and "Default: No access".
   - Rows above the safe level are highlighted in amber as soon as they change, so the warning isn't a surprise at save time.
   - A sticky "Unsaved changes (3)" bar with **Cancel** and **Save**.
3. **Save flow:**
   - Compute `assessRoleChange` on the client. No warnings → save directly.
   - Otherwise open the **Review elevated access** dialog, which shows:
     - The list of permissions above the safe level, each with its risk and its plain-language reason (for example "Can void completed bills, which removes revenue from reports").
     - The impact: "Applies immediately to **5 people** in **3 stores**".
     - Conflict and ineffective-permission notes. Store-manager assignability lost: "Store managers will no longer be able to assign this role".
     - A required reason field for High and Critical changes.
     - For Critical, a field to type the role name.
     - Buttons: **Go back** and **Grant elevated access**. The confirm button is styled as danger.
   - On 409 from the server (for example someone else changed the role in between), show the server's assessment in the same dialog.
4. **Reset to default** button for system roles, with its own short confirmation.
5. **"New default permissions available"** banner (1.5) with a Review button.
6. **Changes** tab: a timeline from `RolePermissionChange`, showing who, when, the added and removed permissions, and the reason.
7. **Roles list:** the Type column shows `System`, `System · Modified` or `Custom`. Add a filter for "Above default".
8. **New role:** a "Based on" template picker that pre-fills the matrix and sets the safe level.
9. Add every new string to the EN and AR dictionaries (the app has `LocalizedText` and RTL).

---

# PART A — One till login per store, cashier names, switching at billing

## Phase 3 — Data model and API

### 3.1 Schema (migration `0027_store_till_cashiers`)
- `enum UserAccountType { PERSON STORE_TILL }`. Add to `User`:
  - `accountType UserAccountType @default(PERSON) @map("account_type")`
  - `tillStoreId String? @map("till_store_id") @db.Uuid`, a relation to Store.
  - SQL in the migration: `CREATE UNIQUE INDEX users_one_till_per_store ON users (till_store_id) WHERE account_type = 'STORE_TILL' AND status <> 'DISABLED';` plus a CHECK that `till_store_id` is set if and only if the account is a till.
- New model `StoreCashier` → table `store_cashiers`:
  `id, organizationId, storeId, displayName, employeeCode (optional, ""), pinHash?, status RecordStatus, linkedUserId? (an existing person login, used when importing), createdById, lastSelectedAt?, failedPinAttempts Int @default(0), pinLockedUntil?, createdAt, updatedAt`.
  It has a unique index on `(storeId, lower(displayName))` among active rows (partial index in SQL) and `@@index([organizationId, storeId])`.
- Add `cashierId String? @db.Uuid` (FK to StoreCashier, `onDelete: SetNull`) to:
  `Sale`, `HeldSale`, `CashMovement`, `SaleReturn`, `Approval` (as the requesting cashier), and `RegisterSession` (`openedByCashierId`, `closedByCashierId`).
  `createdById` stays the authenticated till user, so the audit trail still shows "who was logged in" and "who said they were selling".
- `Sale.documentSnapshot.billHandler` keeps the cashier's name at sale time, so a renamed or deleted cashier never changes an old receipt.

Why a separate table and not more `User` rows: a user needs an email, a 12-character password and a role. Users also appear in the CRM / Product Contract identity projection (`platformUserId`) and in the Team members list. Cashier names need none of that.

### 3.2 Till account rules (enforced in the API; the web only reflects them)
- A till account belongs to exactly one store and holds exactly one store-scoped role: the organisation's **Cashier** role, or another role the admin marks "usable on tills". It never holds an organisation-scope role. Enforce this in `validateAccess` / `writeAccess` / `assignStoreRole`, and add the Phase 1.4 hard block.
- The till is allowed only on the POS surfaces: sell, held sales, receipts and reprint, register open/close and cash in/out (if the role allows), returns (if the role allows) and customer quick-create. It can't use `/admin/*` (except the read endpoints the POS screen needs), its own profile, password or PIN change, or reports.
  - Add a guard in `auth.guard.ts`: if `accountType === 'STORE_TILL'`, the route must be on an allow-list.
  - In web `middleware.ts` and `lib/server/session`, redirect a till session to `/s/<tillStoreId>/pos`.
- **Login ID:** generated as `till.<storecode>@<org-slug>.till`. It stays email-shaped so the existing login form works unchanged; a `.till` suffix can never be a real mailbox. The manager sets the password (12+ characters) and the till PIN for idle unlock. A **Reset password** action signs out every till device (deletes the till's `Session` rows).
- Excluded from `eligibleSaleHandlers`, from the Team members list (or shown under a separate "Till logins" tab) and from CRM SSO linking.

### 3.3 New permission
`store.cashiers.manage` ("Add, rename, deactivate cashier names and manage the till login for this store"):
- Add it to `PERMISSIONS`, `PERMISSION_CODES` and the Store Manager template, and bump the template version.
- Risk level **HIGH**.
- Viewing cashiers uses the existing `store.staff.view`.

### 3.4 Endpoints (all store-scoped, `assertStoreAccess` + permission, organisation ownership checked on every id)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/stores/:storeId/cashiers` | `store.staff.view` | Returns name, code, status, whether a PIN is set and last used. Never returns the PIN hash. |
| POST | `/admin/stores/:storeId/cashiers` | `store.cashiers.manage` | `{ displayName, employeeCode?, pin? }` |
| PATCH | `/admin/stores/:storeId/cashiers/:id` | `store.cashiers.manage` | Rename, set or clear the PIN, activate or deactivate. Hard delete is not allowed, so history stays intact. |
| POST | `/admin/stores/:storeId/cashiers/import` | `store.cashiers.manage` | Creates names from the store's current person users that hold Cashier, linked with `linkedUserId`. |
| GET | `/admin/stores/:storeId/till` | `store.staff.view` | Shows whether the till exists, its login ID, status and active sessions. |
| POST | `/admin/stores/:storeId/till` | `store.cashiers.manage` | Creates the till user (fails if one exists) with `{ password, pin }`. |
| POST | `/admin/stores/:storeId/till/reset` | `store.cashiers.manage` | Sets a new password and/or PIN and revokes the till's sessions. |
| PATCH | `/admin/stores/:storeId/till` | `store.cashiers.manage` | Disable or enable the till. |
| GET | `/pos/v1/stores/:storeId/cashiers/active` | `sale.create` | The picker list: id and name, plus `pinRequired`. |
| POST | `/pos/v1/stores/:storeId/cashiers/:id/verify` | `sale.create` | Checks the PIN when the store requires one, with a lockout after 5 failures (1.5 min). Returns a short-lived signed **cashier token** (cashierId + storeId + tillUserId, valid for 12 hours). |

The cashier token stops a till session from simply sending any cashierId. When PIN is off, `verify` still issues the token without a PIN. The server always validates the token rather than a bare id.

### 3.5 Attribution rules in `pos.service.ts`
- Add a helper `resolveCashier(context, storeId, input)`:
  - For a **till** account: `cashierToken` is required. It must be valid, for this store, for this till user, and for a cashier who is still ACTIVE. Otherwise → 400 "Select the cashier before billing".
  - For a **person** account: as today (`handledById`). `cashierId` is optional.
- Use it in completeSale (replacing the `handledById` path for tills), holdSale, cash movement, register open and close, createReturn and approval request.
  - Write `cashierId` and include it in the audit metadata.
  - The idempotent retry path (`findSaleByClientId`) stays before the cashier check, as the existing comment requires.
- Checkout config (`pos.service.ts:975`): for tills, return `cashiers` instead of `handlers`, plus the `cashierSelection` mode and `pinRequired`.
- Replace `eligibleSaleHandlers`' N+1 with one query. This is an unrelated speed-up but in the same code path.

### 3.6 Store settings (billing settings JSON; no migration needed)
- `cashierSelection: 'STICKY' | 'EVERY_BILL'` (default STICKY)
- `cashierPinRequired: boolean` (default false)
- `cashierAutoClearOnIdleLock: boolean` (default true)

Add them to `billing-settings.ts` defaults and validation, and to the settings form.

## Phase 4 — Store manager screens

`app/(app)/s/[storeId]/staff/page.tsx` gets two new cards above the existing people table.

1. **Till login.** Shows the login ID and status (Active / Disabled / Not set up).
   - Buttons: **Set up till login**, **Reset password / PIN**, **Sign out all tills** and **Disable**.
   - The password is shown once, with copy and print options ("Till card").
2. **Cashiers at this store.** A table with name, employee code, PIN (Set or Not set), status and last used.
   - **Add cashier**: a name, plus an optional PIN.
   - Row actions: Rename, Set or clear PIN, Deactivate / Reactivate.
   - **Import from current cashier logins** shows a preview first.
   - Empty state: "Add the names of the people who use this till. They pick their name when they bill; nobody needs their own login."
3. Billing settings form: the three settings from 3.6.

Hide the manage actions without `store.cashiers.manage`. The API is the real check.

## Phase 5 — POS screen: pick and switch the cashier

Files: `features/pos/pos-screen.tsx`, `features/auth/lock-screen.tsx`, `app/(auth)/lock/page.tsx`, a new `features/pos/cashier-picker.tsx`.

1. **Cashier chip** in the POS header, always visible: "Cashier: **Asha** ▾". Tap it to open the picker.
2. **Picker:** a full-screen grid of large touch buttons with the names, sorted by most recently used, plus a search box when there are more than 12 names.
   - If a PIN is required, a numeric keypad appears after the name is tapped.
   - On success, the client keeps `{cashierId, name, token}` in memory and in `sessionStorage` (wrapped in try/catch), keyed by register.
3. **When it opens:**
   - On entering the POS with no cashier selected.
   - On tapping the chip.
   - After each completed sale if the store uses `EVERY_BILL`.
   - After an idle lock if auto-clear is on.
   - Keyboard shortcut (for example F2).
4. **Switching mid-bill** is allowed. The bill belongs to whoever is selected when **Complete sale** is pressed. The payment dialog shows "This bill will be recorded under **Asha** · Change".
5. **Payment dialog:** for tills, replace the "Bill handled by" dropdown with that read-only line. Person accounts keep the current dropdown.
6. **Idle lock for tills:** the lock screen becomes the cashier picker ("Who's billing?"). Unlocking the till session itself uses the till PIN (existing `/auth/unlock`) only when the store manager has signed the till out. Day-to-day, no logout or login is needed.
7. **Held bills:** the list shows who held each bill. Any cashier can resume it, and the resumer becomes the cashier.
8. **Register open/close and cash in/out dialogs:** show and record the current cashier.
9. The receipt prints "Cashier: Asha" from the snapshot. This already works through `billHandler`.

## Phase 6 — Reports, migration of existing staff, docs

1. **Reports:**
   - The cashier filter lists till cashier names and person users together, as `cashier:<id>` or `user:<id>`.
   - The "Sales by cashier" grouping uses `cashierId`, then `handledById`, then `createdById`.
   - The register session report shows the cashier switches during the shift (from the audit log: `pos.cashier.selected` events with the time).
   - Note: the cash variance belongs to the **drawer session**, not to one cashier, because the drawer is shared. Show it that way and don't imply individual blame.
2. **Existing data:** old sales keep `handledById` and are unchanged. No backfill of `cashierId`.
3. **Rollout per store:**
   1. Store manager sets up the till login.
   2. Imports or adds the names.
   3. Signs the till devices into the till login.
   4. (Optional) The admin disables the personal cashier logins.
4. **Docs:** update `docs/cashier-quick-card.md` ("Pick your name, don't log out"), `docs/admin-guide.md` (till logins, editing roles, what the warnings mean) and `CRM-POS-Manual-Verification-Checklist.md`.
5. **Attendance (follow-up, not in this plan):** `StaffAttendance` is tied to `User`. Clock-in for cashier names from the picker would need `cashierId` on attendance. List it as Plan 14.

---

## Phase 7 — Verification gate (exit criteria)

Run `pnpm verify` and `POS_TEST_DATABASE_URL=… pnpm test:e2e`. Every item below needs a passing test or a recorded manual check.

**Part B: roles**
- [ ] Unit (`packages/shared`): `assessRoleChange` covers elevated, newly high-risk, ineffective, conflicts, assignability lost, REQUIRE_APPROVAL one level lower, and Critical needing type-to-confirm.
- [ ] e2e: PATCH Cashier adding `sale.void` without acknowledgement → 409 with an assessment; with acknowledgement and a reason → 200. The audit entry has before, after and the reason.
- [ ] e2e: run `seedFoundation` again (simulated restart) → the customised Cashier keeps its edits; an unmodified Supervisor is reconciled to the template.
- [ ] e2e: bump the template version → a customised role is not changed and the "update available" flag is set.
- [ ] e2e: PATCH Organisation Administrator → 400. Renaming or disabling a system role → 400.
- [ ] e2e: a non-admin with `roles.manage` granting a permission they lack → 400.
- [ ] e2e: a role used by a till account getting `users.manage` → 400.
- [ ] e2e: the role id of another organisation → 404 for GET, PATCH, reset and assess.
- [ ] e2e: a user's effective permissions change on the very next request after the save.
- [ ] Manual: the warning dialog works in EN and AR (RTL), in light and dark themes, and with the keyboard only.

**Part A: till and cashiers**
- [ ] e2e: a second till for the same store → 409 (unique index). A till with an organisation role → 400.
- [ ] e2e: a till calling `/admin/users`, `/admin/roles` or reports → 403. A till completing a sale without a cashier token → 400.
- [ ] e2e: a cashier token from store A used at store B, or by a different till → 400. A deactivated cashier's token → 400.
- [ ] e2e: with a PIN required, a wrong PIN 5 times → locked; the attempts are audited; the PIN hash never appears in any response.
- [ ] e2e: the manager of store A can't list or create cashiers or reset the till of store B. Cross-organisation ids → 404.
- [ ] e2e: a sale, hold, cash movement, register open/close and return from a till all store `cashierId`. The receipt shows the name; renaming the cashier later doesn't change the reprint.
- [ ] e2e: an idempotent sale retry after the cashier has been deactivated returns the original sale.
- [ ] e2e: the reports cashier filter works for a till cashier and for a person user.
- [ ] e2e: the manager-PIN approval still works from a till (the approver is a person ≠ the till).
- [ ] Manual (Playwright on plain HTTP, as in Plan 12): sign the till in once, switch cashiers 10 times across 10 bills with no logout, an idle lock opens the picker, and EVERY_BILL mode asks each time.

---

## Files expected to change (summary)
- **API:** `prisma/schema.prisma`, two new migrations, `auth/permission-catalogue.ts`, `auth/auth.guard.ts`, `auth/auth.service.ts`, `auth/authorization.service.ts` (till flags in the context), `bootstrap/foundation.ts`, `admin/admin.service.ts` and `admin.controller.ts` (roles, cashiers, till), `pos/pos.service.ts` and `pos.controller.ts` (cashier resolve, picker, verify), `common/billing-settings.ts`, `audit/audit.service.ts` (diff metadata), plus new e2e spec files `plan13-roles.e2e-spec.ts` and `plan13-till-cashiers.e2e-spec.ts`.
- **Shared:** `packages/shared/src/permissions.ts` (risk catalogue, templates, `assessRoleChange`) and its tests.
- **Web:** `features/permission-matrix.tsx`, `features/role-editor.tsx`, new `features/roles/elevation-dialog.tsx`, role pages, `app/(app)/s/[storeId]/staff/page.tsx` with new `features/store/store-cashiers.tsx` and `store-till-login.tsx`, `features/pos/pos-screen.tsx`, new `features/pos/cashier-picker.tsx`, `features/auth/lock-screen.tsx`, `features/settings/billing-form.tsx`, `middleware.ts`, `lib/server/session`, and the i18n dictionaries.

## Risks
- **Shared password:** accountability depends on people picking their own name. The optional PIN, the audit of each switch and the restriction of the till to the POS reduce this but don't remove it.
- **Wider attribution change:** adding `cashierId` to 6 tables touches every till write path. Check them all against the list in Phase 0.
- **Template drift:** once a system role is customised, it no longer gets new default permissions automatically. The review banner (1.5) is the safety net. Without it, new features would silently be missing from customised roles.
