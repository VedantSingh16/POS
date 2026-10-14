# Plan 10: Configurable Store Operations, Workforce, Reporting, and Alerts

**Status: Partially implemented; rollout verification remains open (2026-10-14).** Plan 10 changes are present in the working tree and have passed unit tests, type checks, schema validation, and production builds. This is not a completion sign-off: database-backed integration/e2e verification, a migration rehearsal, and a browser workflow walkthrough still need a safe disposable database and runtime environment. The delivery record below identifies implemented areas and the remaining scope.

### 0.1 Delivery record

| Plan area | Implemented in the working tree | Still required before calling it complete |
|---|---|---|
| W9 register and cash controls | Explicit opening float; required movement reason; cash threshold and drawer-floor checks; manager PIN or payload-bound approval; idempotent cash movement IDs and browser retry queue; variance reason/tolerance review; audited force-close during day close. POS cash sales can be locally queued only for simple, non-discounted bills without customer/custom-field data or a non-cash attempt. | Database/concurrency tests for cash movement, approval consumption, register open/close races and offline replay; test queued bills across browser restart, conflicts and changing prices. Expand offline support only after defining safe persistence for custom/customer data. |
| W10 day close and reporting | Store-timezone-aware date ranges; day-close snapshots and restatement history; reasoned force-close of open registers; register/cashier filters; CSV/PDF background export jobs with status, retry, scoped download, expiry and audit. | Rehearse migration against an upgraded database; test job crashes/retries and late sale/return restatements with persisted records; add scheduled exports and complete configured-field report filtering. |
| W11 alerts and dashboards | Stable active-alert deduplication, repeat counts/last-seen, acknowledgement and reasoned resolution metadata, in-app alert actions, and active-only open counts. | Configurable rule/recipient/escalation settings, void/return-spike detection, external email/push delivery with retry/outbox, escalation timers, concurrent dedupe tests and explicit freshness checks across dashboard/report views. |
| W12 staff and approvals | Store-scoped attendance clock-in/out and reasoned manager correction; new permissions; expiring approval records bound to action/store/resource/payload, self-approval prevention and single-use consumption paths for protected operations. | Staff invite/create policy and manager unlock flow; missed-clock-out handling and attendance-hours performance reporting; browser approval request/decision flow for each action; database tests for expiry, wrong-payload, wrong-store and concurrent token use. |
| Configuration coverage carried from Plan 9 | Typed organization/store product and checkout field definitions/values, permitted store overrides, product-type field metadata and configurable billing controls already exist in the working tree. | Standard-field labels/order/requiredness/edit-role policy, customer profile fields, field and receipt previews, configurable import/export columns and report filters, invoice layout controls, and a complete ownership/configuration inventory. |

**Verification completed for this delivery:** API unit tests (31 tests), web unit tests (26 tests), API/web TypeScript checks, Prisma schema validation/client generation, and API/web production builds. Targeted web lint passes for the changed POS, register, and attendance components. API lint exits successfully with warnings in Plan 6/7 e2e fixtures. Full web lint still exits nonzero on other hook-rule findings in store brand/category pages, the store dashboard, and onboarding. Database-backed e2e tests and migration rehearsal are intentionally not run without a dedicated disposable `POS_TEST_DATABASE_URL`; the existing e2e setup performs tenant cleanup and must not be pointed at a developer or pilot database.

## 1. Objective

Complete a store operations workflow in which organization administrators control shared policy, store managers configure permitted local behavior, and staff carry out sales and register operations with clear attribution and approval. Reports, alerts, and audit records must reflect the same underlying business events.

The plan covers:

- W9: register shifts, cash movements, reconciliation, and controlled close.
- W10: day-end close, operational reports, and reliable exports.
- W11: actionable alerts and dashboards.
- W12: staff roles, PIN lifecycle, approvals, attendance, and performance.
- Remaining Plan 9 configuration work for product, checkout, customer, receipt, import/export, and report fields.

## 2. Existing implementation baseline

Plan 9 already documents substantial delivered work in the current working tree. Plan 10 should build on it instead of introducing a competing configuration model.

| Area | Existing capability | Known gap to address |
|---|---|---|
| Configuration foundation | Typed field definitions and values, organization/store inheritance, bounded store overrides and local fields, server-side validation, setting audit records. | Field definition history/rollback and a complete inventory of configurable versus system-owned behavior are not finished. |
| Staff access and bill attribution | Organization admins manage roles; store managers can assign organization-approved store roles within their permission ceiling. Checkout records the authenticated actor separately from the eligible bill handler. | Store managers assign existing staff but do not have a complete staff onboarding workflow. Attendance, explicit PIN sign-in, manager unlock, and session revocation on deactivation are outstanding. |
| Product fields | Product, variant, and store catalogue custom fields are supported; standard visibility and selected product-type rules exist. | Standard-field requiredness, order, role edit policy and ownership are incomplete. Custom fields are not fully wired into import/export and report filters. |
| Checkout fields | Organization/store custom checkout fields are rendered, validated, persisted and snapshotted. Optional standard checkout controls can be hidden. | No field/receipt preview; standard checkout field labels/order are fixed; custom checkout values are not usable as report filters or export columns. |
| Register and cash | Register sessions, opening float, cash movement ledger, expected cash, close count, variance and audit events exist. A database constraint prevents more than one open session per register. | Omitted opening float currently defaults to zero; movement reasons are optional; no over-limit movement approval or cash-drawer floor check; no offline sale queue; no variance-tolerance review before close. |
| Reports and exports | Live sales, tender, return, product, tax and cash reconciliation reports; date/store/register/cashier API filters; scoped CSV export. | No explicit day-end close record, force-close workflow, close snapshot/restatement history, PDF report export, scheduled/background export jobs, or export download audit. |
| Alerts and dashboards | Five-minute sweep for low stock and registers left open; alerts for cash variance and selected events; alert acknowledgement; store dashboard and alerts page. | No configurable alert routing, void-spike rule, robust alert merging, delivery retries/escalation, staff resolution notes/actions, or clear dashboard data-age semantics. The alert listing does not filter to open status even where the dashboard labels its count “Open alerts.” |
| Approvals and authentication | Password sessions, PIN credential storage, repeated-failure lockout, discount/refund/open-price approvals, approval queue and audit events. | Approval authorization is not a general expiring, single-use token bound to one action; self-approval prevention is not enforced consistently; cash movements are not wired into approvals. |

The detailed Plan 9 record is in `plans/plan_9.md`. Relevant code includes `apps/api/src/common/field-config.ts`, `apps/api/src/admin/admin.service.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/pos/pos.service.ts`, `apps/api/src/pos/alert.scheduler.ts`, `apps/api/prisma/schema.prisma`, and the corresponding settings, staff, reports, alerts, registers, and POS screens under `apps/web`.

### 2.1 Verification baseline

`plans/plan_9.md` records that API and web unit suites, type checks, and production builds passed at the time of that record. It also records that database-backed end-to-end verification was not run because a dedicated disposable `POS_TEST_DATABASE_URL` was unavailable, that a browser walkthrough and migration rehearsal remain pending, and that full web lint has existing rule violations. These checks have not been rerun as part of writing this plan.

The POS feature status board (`apps/api/src/pos/pos-features.ts`) still marks register/checkout and reporting/alerts as partial. Reconcile the plan status board and the user-facing feature board as verification phases complete.

## 3. Product and access rules

### 3.1 Organization and store ownership

Use one effective-configuration contract:

1. Organization defaults and field definitions.
2. Store overrides only for settings the organization has allowed stores to change.
3. Store-local fields only where organization policy allows local extensions.

The effective configuration returned to each UI must include its value, source scope, and capabilities. The API must enforce the same policy independently of the UI.

Organization administrators own permission definitions, organization-wide policy, and the maximum authority that can be delegated. Store managers can administer only their store and may assign only approved roles whose permissions are within their own authority. A decision is needed during Phase 0 on whether managers may invite/create staff or only assign roles to organization-created users; either way, tenant and store boundaries must be enforced.

### 3.2 Configurable versus system-controlled behavior

Business-facing labels, optional fields, field order, requiredness, supported options, store override permissions, report/receipt placement, alert thresholds, alert recipients, cash limits, and day-end policy should be configurable where useful.

Configuration must not bypass:

- Organization/store isolation or permission checks.
- Authentication identity, action attribution, or audit history.
- Server-side price, tax, discount, tender, and total calculations.
- Register and cash ledger invariants, inventory ownership, or transaction idempotency.
- Legal invoice numbering and historical sale snapshots.

Hide optional UI controls only when the underlying operation stays valid. Do not make arbitrary free-form configuration a replacement for typed validation or policy.

### 3.3 Historical and audit behavior

- Keep field definition versions and preserve the field key, label, type, value, and version used on completed sales.
- Archive fields instead of deleting historical values.
- Keep immutable actor, handler, approver, and timestamp attribution on staff actions and financial records.
- Audit policy changes, forced shift/day close, approvals, alert resolution, report restatement, exports, and staff lifecycle changes.
- Preserve legacy records and use backward-compatible defaults only where the value is unambiguous.

## 4. Target workflows

### 4.1 W9 — Register shift and cash movement

1. Cashier selects a register and records an explicit opening count. An explicit zero is valid; a missing count blocks opening.
2. The system permits one open session per register and records store, register, cashier, opening amount, and timestamps.
3. Cash in/out movements require a type, positive amount, reason, actor, and open session. Paid-outs cannot exceed the available expected cash unless an approved policy explicitly permits it.
4. A configured amount threshold triggers a manager approval bound to the exact pending movement. Requester and approver must differ where policy requires separation of duties.
5. The ledger updates expected cash transactionally and idempotently. A network interruption leaves the shift open; supported offline sales/movements are queued locally and replayed safely when connectivity returns.
6. Cashier enters drawer count at close. The system records expected, counted, variance, count details, and actor.
7. A variance inside configured tolerance closes the shift. A variance outside tolerance moves to manager review with a reason; force-close is explicit and audited. A closed shift never reopens silently.

### 4.2 W10 — Day-end, reports, and exports

1. A manager starts close for a store business date. The system lists open shifts and prevents close until they are closed or explicitly force-closed with a reason.
2. The system records an idempotent day-end snapshot of sales, tenders, returns, cash variances, and relevant operational totals.
3. Reports can filter by business date range, store/location, register, cashier/handler, and supported configured fields. API permissions scope every query and export.
4. CSV and PDF exports run as background jobs. The caller can check status, retry failures safely, and download only a complete artifact. Scheduled exports use the same permission and store-scope rules.
5. A late sale, return, or correction updates the affected report through a versioned restatement with actor/time/reason history; repeated processing must not double-count.
6. Show the report period, store timezone, generation/as-of time, and whether the figures are original or restated.

### 4.3 W11 — Alerts and dashboards

1. Evaluate configured rules for low stock, cash variance, register left open, void/return spikes, and other approved operational risks.
2. Use a stable alert key to merge repeats into one active alert, increment occurrence count, and update last-seen time. Concurrent sweeps must not create duplicate active alerts.
3. Assign severity and route an alert to configured roles. Deliver in-app notices and, where enabled, email/push notifications using a retryable outbox and an in-app fallback.
4. If nobody acts within the configured service window, escalate to the next role. An alert does not expire without resolution or an explicit policy outcome.
5. Alert detail presents the source record and supported staff actions, such as reorder, recount, correct, or add a note. Close/resolution captures who, when, outcome, and reason.
6. Dashboards and reports derive from the same scoped data definitions. The dashboard counts only active alerts in its “open” metric and shows data freshness/as-of time.

### 4.4 W12 — Staff, roles, approvals, and performance

1. Organization admin (and store manager if enabled by organization policy) creates/invites staff, assigns store/location, and assigns only permitted roles.
2. Staff PIN is provisioned securely. Repeated failures lock access and generate an audit event; the manager unlock workflow is explicit, authorized, and audited. Keep password and PIN policies distinct where their use differs.
3. Staff clock in and out against a store/shift. Missed clock-out is flagged; a manager may close it only with a reason and audit event.
4. Sensitive actions request a manager PIN or approval. The resulting authorization is short-lived, single-use, bound to action, resource, requester, store, and relevant amount/payload; it cannot be reused or approved by the requester when separation is required.
5. Permission changes apply to subsequent requests. All protected operations re-evaluate current role grants; the audit trail preserves the role and actor context for completed actions.
6. Deactivated accounts remain in history, lose access immediately, and have all active sessions revoked. The last active organization administrator cannot be deactivated or demoted.
7. Performance reporting attributes sales to the selected bill handler while preserving the authenticated actor. Include sales, voids/returns, attendance hours, and store/date filters with role-scoped visibility.

## 5. Implementation phases

### Phase 0 — Confirm contracts, ownership, and safe migration strategy

**Purpose:** resolve shared policy decisions before adding cross-cutting operational state.

**Work:**

- Reconcile Plan 9, this plan, the current Prisma schema/migrations, and the POS feature status board into one baseline.
- Inventory all merchant-facing fields/settings and mark each organization-owned, store-overridable, store-local, fixed by design, or deferred.
- Define store business-date/timezone behavior, cash variance tolerances, cash movement limits, approval separation rules, staff invitation authority, attendance policy, alert delivery channels, and export retention.
- Define stable IDs and idempotency rules for offline sales/movements, day close, report jobs, alert generation, and approval consumption.
- Design migrations to preserve existing sessions, sales, movements, approvals, alerts, settings, and custom field values. Avoid destructive reset scripts in verification.
- Decide which external delivery/storage integrations are available; retain a usable in-app path when external channels are not configured.

**Exit criteria:** written decisions cover ownership, timezone/day boundary, approval rules, data retention, supported offline actions, notification channels, and test environment. Every new workflow has an owner and failure behavior.

### Phase 1 — Staff lifecycle, attendance, and single-use approvals (W12 foundation)

**Purpose:** establish staff and authorization primitives needed by cash controls and sensitive actions.

**Work:**

- Extend the store Staff flow for the staff creation/invitation model approved in Phase 0; preserve organization-level role-definition ownership and manager permission ceilings.
- Complete PIN setup, staff sign-in/clock workflow as required, failed-attempt lockout, manager unlock, and recovery/audit paths.
- Add clock-in/out records with store, staff, timestamps, status, source, and manager correction reason. Prevent duplicate active clocks where policy disallows them.
- Extend approval records or introduce an authorization token entity with action/resource/store/requester/approver, payload binding, issue time, expiry, consumption time, and terminal state.
- Enforce non-self-approval for configured actions and atomically consume approved authorization during the protected operation.
- Revoke all sessions on deactivation or credential reset where policy requires; preserve user and historical records. Protect last-admin role and status transitions.
- Recheck current permissions on every request and audit staff, role, PIN, attendance, approval, and session lifecycle changes.

**Exit criteria:** a manager cannot act outside the assigned store or delegate beyond their own permission ceiling; an authorization cannot be self-approved (where prohibited), replayed, expired, or applied to another action; clock corrections and deactivation are auditable; inactive users cannot use extant sessions.

### Phase 2 — Register controls, cash ledger, offline recovery (W9)

**Purpose:** complete shift cash control, manager review, and recovery behavior.

**Work:**

- Require explicit opening count, enforce one open session per register, and show the session cashier/register clearly.
- Require movement reason; validate amount and available drawer cash; add configurable thresholds and use Phase 1 approval for over-limit cash movement.
- Make cash movement plus expected-cash update and approval consumption a single transaction. Record reason, actor, approver, and decision in immutable audit data.
- Add durable local queue and status visibility for supported offline operations. Use stable idempotency keys, conflict handling, retry policy, and server replay responses; do not report an unconfirmed operation as committed.
- Add configurable close variance tolerance, denomination breakdown, manager-review queue, reasoned force-close, and terminal closed-session state.
- Derive expected cash from the register ledger and completed cash tenders/movements with a reconciliation path for discrepancies.

**Exit criteria:** missing count blocks opening; explicit zero works; duplicate open and double close fail safely; paid-out validation and approvals work under concurrency; retries produce one ledger entry; unresolved out-of-tolerance variance cannot silently appear as an ordinary close.

### Phase 3 — Day close, report restatement, and export jobs (W10)

**Purpose:** turn current live reporting into an auditable operational close and reliable export flow.

**Work:**

- Add a store/business-date close record with `OPEN`, `READY`, `CLOSED`, and restatement/version semantics as appropriate.
- Block normal close while sessions are open; show affected registers and support a reasoned, permission-checked force close.
- Snapshot end-of-day totals and source IDs; define how late sales, returns, and corrections reopen/restatement the report without changing historical source transactions.
- Extend manager report filters in the UI to match the API: date, store, register, cashier/handler, and permitted configured fields.
- Implement asynchronous CSV/PDF export jobs with status, progress/error, retry, scoped download, retention, and audit trail. Return no downloadable partial artifact.
- Support scheduled exports only after access/recipient/retention policy is defined. Revalidate access at download time.
- Show timezone, “as of,” generation time, and restatement version in report and export metadata.

**Exit criteria:** a repeated/interrupted close or report job cannot double-count; late events cause a traceable restatement; every export is complete, store/role scoped, and auditable; users can tell which data version they are viewing.

### Phase 4 — Alert rules, delivery, escalation, and dashboard freshness (W11)

**Purpose:** make alerts reliable, actionable, and visible to the right store roles.

**Work:**

- Create a rule configuration surface with event type, threshold/window, severity, active state, recipients, escalation timing, and store override policy.
- Add rules for low stock, cash variance, overdue register, void/return spikes, and additional approved events. Bound query cost and evaluation frequency.
- Implement deduplicated alert upsert with active uniqueness, occurrence count, first/last seen, state transitions, assignee/role, and resolution metadata.
- Add retryable notification delivery with in-app fallback and recorded delivery attempts. Escalate unhandled alerts and surface pending/failed delivery state.
- Link alerts to inventory/register/sale records and permitted actions; capture action notes and manager resolution reasons.
- Fix dashboard open counts to use active status only. Add “as of” or data-age indicators and reconcile report/dashboard totals to the same query definitions.

**Exit criteria:** duplicate events merge even during concurrent sweeps; alerts are not lost on delivery failure; unresolved alerts escalate; a user can identify the linked record, take an authorized action, and see who resolved it; dashboard counts and freshness are explicit.

### Phase 5 — Finish configuration coverage and staff performance (Plan 9 continuation + W12)

**Purpose:** close the original no-rigid-fields requirement and finish manager reporting needs.

**Work:**

- Add standard product field policies for requiredness, order, edit role, scope/value ownership, and supported display surfaces, while keeping core SKU/identity and price/tax validation protected.
- Extend shared typed field configuration to customer profile fields where justified; support checkout and product field preview.
- Add configured product/checkout fields to appropriate import/export columns, list filters, and report filters. Define unsupported field-type behavior explicitly.
- Finish receipt/invoice layout controls and preview. Preserve historical document snapshots on reprint.
- Complete report attribution and performance views for handler, creator, approver, voids/returns, and clocked hours, scoped by role/store/date.
- Review current pricing, tax, inventory, payment, cash, alert, and approval settings for a consistent organization default/store override/audit pattern.

**Exit criteria:** the configuration inventory is complete; managers can configure only permitted fields; organizations can set shared defaults; typed fields behave consistently in forms, POS, receipts, imports/exports, and reports; protected financial facts remain validated by the API.

### Phase 6 — Integration verification, migration rehearsal, and pilot rollout

**Purpose:** prove the combined flows work with real persistence, multiple roles/stores, failures, and existing tenant data.

**Work:**

- Add API unit tests for field contract, cash policy, approval lifecycle, day close, alert state transitions, and export job behavior.
- Add database-backed integration tests using a dedicated disposable test database. Test setup must not target or delete developer/pilot tenant data.
- Add concurrency tests for register open/close, cash movement, approval consumption, report close/restatement, alert deduplication, and export retry.
- Add offline/reconnect tests for idempotent sale/movement replay, network interruption, invalid replay, and unresolved conflict visibility.
- Add role-scope and tenant-isolation tests for each read, write, dashboard, export, alert action, and staff operation.
- Browser-walk organization setup, store overrides, staff assignment, sign-in/PIN, clock-in/out, sale attribution, cash approval, variance review, day close, report filtering/export, and alert acknowledgement/escalation.
- Rehearse migrations from a copy of a supported existing database; verify rollback/forward-recovery and preservation of historical bills, roles, sessions, and ledger rows.
- Resolve lint findings in changed paths; document any pre-existing unrelated lint failures. Update the feature status board and pilot/operator guides.
- Roll out behind a tenant/org feature gate if available; enable for a small pilot after database backup and success criteria are agreed.

**Exit criteria:** all migrations apply on a fresh and upgraded database; tests pass on the isolated database; browser walkthrough passes for organization admin, manager, cashier, and accountant/report roles; no cross-store or cross-tenant access succeeds; key failure/retry paths are demonstrated; pilot rollback and support ownership are documented.

## 6. Cross-phase verification matrix

| Risk | Required verification |
|---|---|
| Tenant/store leakage | Attempt cross-organization and cross-store access for every staff, shift, report, export, approval, alert, and attendance operation. |
| Permission change during active work | Change a user's role during an open shift; verify the next request uses current grants and historical events preserve original actor/handler attribution. |
| Approval misuse | Test requester self-approval, wrong store, wrong action/resource/amount, expiry, duplicate consumption, simultaneous use, denial, and audit evidence. |
| Register and cash races | Concurrent open, close, duplicate movement, paid-out at drawer limit, network retry, and sale/close race. |
| Offline recovery | Lose network during sale/movement; restart browser; reconnect; replay and resolve server conflicts without duplicate posting or false success. |
| Day close and late changes | Open-shift block, force-close reason, repeated close, partial job interruption, late return, restatement, and same event processed twice. |
| Alert reliability | Duplicate simultaneous sweeps, reopen after resolution, delivery failure, retry, escalation timeout, user resolution, and stale dashboard cache. |
| Historical correctness | Change field labels/schema/receipt layout after a sale; reprint and report old bills without changing their captured values. |
| Staff lifecycle | Duplicate email, PIN lockout/unlock, missed clock-out, deactivation with active sessions, historical reports, and last-admin demotion/deactivation. |
| Export security/reliability | Oversized export, worker crash, retry, role change before download, store scope, complete-file-only download, and audit trail. |

## 7. Cross-cutting implementation requirements

- **API enforcement:** UI configuration is not authorization. Validate effective field definitions, roles, thresholds, approval tokens, and store scope in the API.
- **Atomicity:** use database transactions for ledger changes, approval consumption, day-close transitions, alert transitions, and audit records where they form one business operation.
- **Idempotency:** all replayable write operations require stable client or job keys and explicit outcomes for duplicate submissions.
- **Auditability:** include actor, scope, target, action, reason, result, and timestamp. Avoid recording raw PINs, credentials, or sensitive field values in audit payloads.
- **Historical records:** use snapshots or versioned references for completed bills, day close, and exported reports. Configuration edits affect future work unless an explicit restatement is created.
- **Availability:** retry jobs with bounded backoff, show actionable failure state, and keep an in-app/manual workflow for unavailable integrations.
- **Performance:** paginate reports/alerts, avoid N+1 rule evaluation, index common scope/status/date queries, and bound export/rule job resource usage.
- **Accessibility and usability:** show who is acting, which register/store/date applies, required reasons, approval state, offline queue state, and freshness in plain language.

## 8. Decisions to preserve

1. The authenticated user (`createdById`) and the bill handler (`handledById`) are distinct facts.
2. Store role assignment never grants permissions beyond the manager's authority or organization-approved role set.
3. Approval is bound to the action and consumed once; it does not become a reusable generic PIN bypass.
4. Completed sales, cash ledger movements, and audit entries are not rewritten to reflect later configuration changes.
5. Closing a register or business date is explicit and auditable; exceptions require a reason.
6. Organization/store configurable fields remain typed and bounded. System-owned financial calculations, identity, permissions, tenant boundaries, and ledger invariants remain enforced.
7. Dashboard, report, and export totals use consistent business-date and store-timezone semantics.

## 9. Recommended delivery order

Complete Phase 0 decisions first. Build Phase 1 approvals and staff lifecycle before Phase 2 cash controls because register movement approval depends on the same single-use authorization semantics. Complete register reconciliation before W10 day close. Build the alert lifecycle and notification outbox on top of verified operational event IDs. Run the Plan 9 configuration sweep after the shared contract is stable, then execute Phase 6 before any broad rollout. Phases may overlap only where their data contracts and migrations have been reviewed together.

## 10. Definition of complete

Plan 10 is complete when W9–W12 pass the cross-phase verification matrix; managers can configure allowed billing/product/operational behavior without developer edits; role and store boundaries are enforced by the API; reports, alerts, and exports are traceable to reliable source records; historical bills and ledger events remain intact; migrations and pilot rollback are rehearsed; and the POS feature status board accurately reflects verified—not merely implemented—capabilities.
