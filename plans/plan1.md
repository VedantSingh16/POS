# Plan 1: Organisation Administrator Foundation

## Status

Implemented through Phase 8, with close-out gaps found in the 6 October 2026 code review (listed below). The gaps are scheduled as **Plan 2, Phase 0** (`plan2.md`). This document remains the implementation runbook for the foundation.

## Implementation status

| Phase | Status | Delivered |
| --- | --- | --- |
| 0. Decisions and boundaries | Complete | Organisation tenancy, administrator ownership and platform quota boundaries |
| 1. Organisation and entitlement model | Complete | File-backed tenant-scoped data model and store entitlement enforcement |
| 2. User identity and authentication | Complete (gaps: lockout, invited state, idle timeout) | Email/password sessions, secure hashing, PIN setup and individual identity |
| 3. Roles, permissions and access checks | Complete (gap: store-scoped grants not evaluated by the guard) | Standard/custom roles, permission grants and default-deny guards |
| 4. Administrator bootstrap | Complete | Initial administrator seeded from `.env` and organisation settings |
| 5. Stores, registers and quota | Complete | Store/register APIs, stockroom scaffolding and transactional store limit |
| 6. User and role administration | Complete (gaps: credential reset, custom-role disable, effective-access review) | User, role, store assignment and last-admin protection workflows |
| 7. Catalogue and settings | Partial (create-only; bulk import 5.16 not built; moved to Plan 2 Phase 2) | Categories, UOMs, tax groups, products, variants, barcodes and base prices |
| 8. Audit and verification | Partial (no before/after audit values; isolation and concurrency tests missing) | Audit endpoint, admin UI, API e2e coverage and web build/lint verification |

### Close-out gaps (verified 6 October 2026)

These Plan 1 items are not yet met in code. Each is tracked in `plan2.md` Phase 0 under the number shown.

| Plan 1 item | Gap | Plan 2 ref |
|---|---|---|
| Phase 3 — store-scoped permissions | `PermissionsGuard` never passes a `storeId`, so STORE-scoped grants never match; store and register lists ignore store access | 0.1, 0.2 |
| Phase 2 — failed-attempt lockout | Not implemented | 0.3 |
| Phase 2 — individual identity | Login without `organizationSlug` is ambiguous across organisations | 0.4 |
| Phase 2/6 — credential reset | No administrator reset endpoint | 0.5 |
| Roles — disable unused custom roles | `updateRole` cannot change status | 0.6 |
| Phase 6 — effective-access review | No endpoint for another user's effective access | 0.7 |
| Phase 2 — Invited state, session timeout | No `INVITED` status; no idle timeout | 0.8 |
| Phase 7 — catalogue administration, 5.16 bulk import | Create-only; status values unvalidated; bulk import missing | 0.9, Plan 2 Phase 2 |
| Phase 8 — catalogue and price changes auditable | Audit entries have no before/after values; prices have no history | 0.10, Plan 2 Phase 2 |
| Persistence note below | SQLite adapter still in use; Postgres is already provisioned in `docker-compose.yaml` | 0.11 |
| Phase 8 — verification matrix | Cross-organisation, concurrency and store-scope tests missing | 0.13 |

The current local foundation uses Node's built-in SQLite support so it can run without adding another runtime dependency to the scaffold. The database path is configured through `POS_DATABASE_PATH`; a production deployment should replace this adapter with the approved durable database deployment before go-live.

## Objective

Create an organisation-level administrator who can configure and manage the POS environment for one organisation.

The Organisation Administrator manages organisation-owned resources:

- Users
- Roles and permissions
- Store access
- Stores and registers
- Product catalogue
- Pricing and tax settings
- Other organisation-level settings

The administrator must only operate inside their own organisation. The platform remains responsible for plans, quotas, billing, platform-wide feature flags and other platform-owned controls.

## Approved feature references

This plan establishes the foundation for the following approved POS capabilities:

- 12.1 Individual login / PIN
- 12.2 Role-based access control
- 12.3 Location access
- 12.4 Function permissions
- 5.1 Product master
- 5.2 Categories
- 5.4 Variants
- 5.5 Multiple barcodes
- 5.6 Units of measure
- 5.16 Bulk import / edit
- 2.1 Base retail price
- 4.1 Tax groups
- 4.2 Tax-inclusive pricing
- 4.3 Tax-exclusive pricing
- 7.1 Multiple stock locations
- 11.1 Register open and 11.2 Register close preparation

## Administrative hierarchy

```text
POS Platform
├── Platform administration
│   ├── Create or suspend organisations
│   ├── Assign plans and entitlements
│   ├── Set maximum store count
│   ├── Set platform-wide feature availability
│   └── Manage billing and support controls
│
└── Organisation
    ├── Organisation Administrator
    ├── Users
    ├── Roles and permissions
    ├── Stores
    │   └── Registers
    ├── Product catalogue
    ├── Pricing and tax settings
    └── Other organisation settings
```

The Organisation Administrator has broad access within one organisation. It is not a global Platform Administrator role.

## Organisation Administrator responsibilities

### Users

The administrator can:

- Create individual users
- Invite users or set up their login/PIN
- Edit user details
- Activate, suspend and disable users
- Reset credentials through a controlled process
- Assign users to stores
- Assign default stores
- Assign roles
- Review user status and activity

Shared cashier accounts should not be used. Sales, refunds, discounts, register actions and configuration changes must be attributable to an individual user.

### Roles and permissions

The administrator can:

- View standard roles
- Create custom roles
- Edit custom roles
- Assign permissions to roles
- Assign roles to users
- Scope roles to the organisation or a store
- Disable unused custom roles

Initial standard roles:

| Role | Scope and purpose |
| --- | --- |
| Organisation Administrator | Full organisation configuration access |
| Store Manager | Manage assigned store operations |
| Supervisor | Operational support and permitted approvals |
| Cashier | Normal sales and register operations |
| Inventory User | Catalogue and inventory-related tasks |

Example permissions:

```text
user.view
user.create
user.edit
role.manage
store.view
store.create
register.create
catalog.product.view
catalog.product.create
catalog.product.edit
catalog.product.import
price.view
price.edit
tax.view
tax.edit
sale.create
register.open
register.close
report.view
```

Permission checks must be enforced in the API/service layer. Hiding a button in the user interface is not sufficient authorization.

### Stores and registers

The administrator can:

- Create stores
- Edit store details
- Configure store address, timezone and status
- Assign users to stores
- Create registers inside stores
- Configure register names, numbers and status
- Deactivate stores or registers without deleting history
- View the current store count and platform allowance

Register creation belongs in this foundation plan. Register opening, starting float, cash movement, closing and reconciliation are later operational workflows.

### Catalogue, pricing and tax

The administrator is the organisation-level owner of the catalogue and commercial setup:

- Categories and subcategories
- Products
- Product variants and SKUs
- Barcodes
- Units of measure
- Product lifecycle status
- Product import and bulk editing
- Base retail prices
- Tax groups
- Tax-inclusive and tax-exclusive price rules

Products belong to the organisation catalogue, not directly to a store. Stores may later have different availability, stock quantities or prices for the same organisation-level product.

### Other organisation settings

The administrator is the entry point for future organisation settings, including:

- Receipt configuration
- Discount policies
- Refund and return policies
- Inventory controls
- Register settings
- Reporting access
- Notification preferences
- Approval rules

These should be separated into modules rather than placed in one unstructured settings record.

## Platform-owned boundaries

The Organisation Administrator cannot:

- Access another organisation's data
- Change the organisation's platform plan
- Increase the organisation's store limit
- Change platform-wide feature flags
- Change billing or subscription state
- Bypass security, audit or system restrictions

The platform may have a separate internal Platform Administrator role for support and provisioning. That role is not required for normal organisation setup.

## Store threshold and platform entitlement

The platform owns the maximum number of stores available to an organisation. This must be entitlement data, not a hard-coded application constant.

Example:

```text
Organisation entitlement
├── max_stores: 5
├── current_stores: 3
└── remaining_stores: 2
```

When a store is created, the server must:

1. Verify that the organisation is active.
2. Read the current active store count.
3. Read the platform-assigned maximum store count.
4. Atomically verify that the limit has not been reached.
5. Create the store only if capacity remains.
6. Return a clear limit-reached response when capacity is exhausted.

The limit must be enforced server-side and transactionally so simultaneous requests cannot exceed the entitlement.

A warning threshold, such as notifying the administrator at 80% usage, may be added later. The hard maximum remains platform-controlled.

## Core data model

The first implementation should establish these organisation-scoped records:

```text
Organisation
├── Organisation entitlement
├── Organisation settings
├── Users
├── Roles
│   └── Permissions
├── User-role assignments
├── User-store assignments
├── Stores
│   ├── Registers
│   └── Stock locations
├── Categories
├── Products
│   └── Variants / sellable SKUs
├── Barcodes
├── Units of measure
├── Tax groups
└── Prices
```

Important ownership rules:

- Every organisation-owned record contains an organisation identifier.
- Users, roles, stores and catalogue records are scoped to one organisation.
- A store owns its registers and store-level operational settings.
- A stock location owns inventory quantities.
- The platform owns plan entitlements and limits.
- Historical transactions retain references to the user, store, register and product version used at the time.

## Phased implementation plan

Work through the phases in order. Do not begin a later phase until its exit criteria are met.

### Phase 0 — Decisions and boundaries

**Goal:** Confirm the rules that cannot safely change after implementation begins.

Decide and document:

- Organisation is the tenant/security boundary.
- The initial administrator is created during organisation provisioning.
- More than one Organisation Administrator is allowed.
- The last active Organisation Administrator cannot be disabled.
- Store limit is a platform entitlement.
- Store creation is blocked at the entitlement maximum.
- Users may be assigned to multiple stores.
- Roles may be organisation-scoped or store-scoped.
- Organisation administrators cannot modify platform-owned settings.
- The initial authentication method is individual login/PIN.
- The permission naming convention is action-based.

**Exit criteria:** These decisions are written down and accepted as the foundation rules.

### Phase 1 — Organisation, tenancy and entitlement model

**Goal:** Establish the organisation boundary and platform-controlled store limit.

Define the data model for:

- Organisation
- Organisation status
- Organisation settings
- Organisation entitlement
- Maximum stores
- Active store count
- Entitlement status

Define the isolation rule:

```text
Every organisation query must be scoped by organisation ID.
```

Define the store-limit behavior for successful creation, limit reached, suspended organisation and concurrent creation requests.

**Exit criteria:** The organisation boundary and store entitlement rules are documented, testable and ready for the later store-management phase.

### Phase 2 — User identity and authentication

**Goal:** Give every employee an individual, traceable identity.

Define and build the user lifecycle:

```text
Invited → Active → Suspended → Disabled
```

Cover:

- User profile
- Employee identifier
- Login/PIN setup
- Secure PIN hashing
- Credential reset
- Failed-attempt lockout
- Session timeout
- Logout
- Last-login tracking
- Active/inactive access control

Do not store raw PINs. Do not allow disabled or suspended users to authenticate.

**Exit criteria:** A user can authenticate individually, and every authenticated session identifies the organisation and user.

### Phase 3 — Roles, permissions and access checks

**Goal:** Create one reusable authorization mechanism for all future POS features.

Implement the role and permission model:

```text
User → Role assignment → Permission → Organisation/store scope
```

Define:

- Standard roles
- Custom roles
- Permission catalogue
- Organisation-scoped permissions
- Store-scoped permissions
- User-role assignments
- Default-deny behavior
- Permission evaluation errors

Use a reusable authorization check for every protected operation. Future discounts, refunds, voids, price overrides, inventory adjustments and approvals must use the same mechanism.

**Exit criteria:** A protected operation is allowed only when the authenticated user has the required permission and location scope.

### Phase 4 — Organisation bootstrap and administrator setup

**Goal:** Ensure every new organisation has a valid initial administrator.

Define the provisioning flow:

```text
Create organisation
    ↓
Assign platform plan and store limit
    ↓
Create initial Organisation Administrator
    ↓
Require credential setup
    ↓
Open organisation setup area
```

The initial administrator should be able to configure organisation profile settings but should not be able to change platform entitlements.

Protect the organisation from becoming ownerless by preventing the last active administrator from being deleted or disabled without replacement.

**Exit criteria:** A newly provisioned organisation can be securely handed to an initial administrator.

### Phase 5 — Stores, registers and quota enforcement

**Goal:** Allow the Organisation Administrator to establish physical POS locations.

Implement the organisation-admin setup scope for:

- Stores
- Store status
- Store address and timezone
- Registers
- Register number/name
- Register status
- Store assignments
- Stock-location placeholders

Implement the platform limit check on the server, including the concurrent-request case.

Deactivate stores and registers instead of deleting records that may later be referenced by transactions.

**Exit criteria:** The administrator can create stores and registers, but cannot exceed the platform-defined store limit.

### Phase 6 — User and role administration

**Goal:** Allow the Organisation Administrator to configure the organisation's workforce access.

Provide the administrative workflows for:

- Create user
- Invite or activate user
- Assign role
- Assign one or more stores
- Set default store
- Edit user
- Suspend or disable user
- Reset credentials
- Create or edit custom role
- Assign permissions
- Review effective access

The access-review view should show why a user has a permission, for example:

```text
User: Rahul
Permission: register.open
Source: Cashier role
Scope: Mumbai Store
```

**Exit criteria:** The administrator can configure users and access without changing application code.

### Phase 7 — Catalogue and organisation settings entry points

**Goal:** Give the Organisation Administrator control over the organisation's remaining foundation configuration.

Add the administration areas for:

- Categories
- Products
- Variants
- Barcodes
- Units of measure
- Product status
- Bulk import
- Base prices
- Tax groups
- Tax-inclusive pricing
- Tax-exclusive pricing
- Organisation-level operational settings

Catalogue and pricing implementation should remain organisation-scoped. Store-specific availability and price overrides should be modelled as relationships, not duplicated products.

**Exit criteria:** The administrator can prepare a valid catalogue and commercial configuration for future checkout development.

### Phase 8 — Audit, security hardening and verification

**Goal:** Prove the foundation is safe to use as the base for checkout and inventory.

Verify:

- Organisation A cannot access Organisation B data.
- Disabled users cannot log in.
- Shared accounts are not required.
- Permission denial works at the API/service layer.
- Store-scoped users cannot access unassigned stores.
- The last administrator cannot be removed accidentally.
- Store creation cannot exceed the platform limit.
- Concurrent store creation cannot bypass the limit.
- Deactivated records retain history.
- Administrative changes contain actor and timestamp information.
- Catalogue and price changes are auditable.

**Exit criteria:** The Organisation Administrator foundation passes the security, isolation, permission and quota test matrix.

## Initial administration screens

The first administration area should provide:

1. Organisation overview
2. Organisation settings
3. Users
4. Roles and permissions
5. Stores
6. Registers
7. Catalogue
8. Pricing and tax
9. Audit activity

The interface should show the current store usage clearly:

```text
Stores: 3 of 5 used
```

## Deferred items

Prepare extension points, but implement these separately:

- Manager approval states and approval thresholds
- Clock-in and clock-out
- Shift scheduling
- Break tracking
- Commissions
- Tip distribution
- Billing and subscription management
- Platform-wide feature flags
- Cross-organisation support operations
- Full register opening and closing workflows
- Checkout and payment processing

## Final foundation outcome

At the end of this plan:

```text
Platform provisions organisation
    ↓
Organisation Administrator is created
    ↓
Administrator configures organisation settings
    ↓
Administrator creates stores and registers within quota
    ↓
Administrator creates roles and permissions
    ↓
Administrator creates users and assigns store access
    ↓
Administrator loads catalogue, pricing and tax data
    ↓
Organisation is ready for checkout implementation
```

The result is a controlled, organisation-scoped foundation that later checkout, inventory, returns, reporting and approval features can reuse without redesigning users, permissions, stores or catalogue ownership.
