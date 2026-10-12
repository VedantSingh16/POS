# POS ↔ CRM (Platform) ↔ Product_Contract — Complete Connection Plan

Goal: connect POS to Platform through the contract cleanly enough, the first time, that there is no ongoing "connection problem" to debug later — and once connected, POS's team can build features independently without touching CRM or Product_Contract again. No code is implemented here; this is the runbook to follow when you do.

Grounded in: `Product_Contract/docs/{HOW-IT-WORKS,ADD-A-PRODUCT,USAGE,INSTALLATION,RELEASE-AND-TROUBLESHOOTING}.md`, the live `b2/HRMS/product/manifest.v2.json` + ADRs, and `b2/HRMS/docs/plans/multi-product-platform/PRODUCT-ONBOARDING-AND-PLATFORM-INTEGRATION-STANDARD.md` (the canonical standard, Sections 6-9, 26, 28, 31).

---

## 0. One contradiction to resolve FIRST — this is the #1 source of future connection problems

Two governing documents describe **two different registration mechanisms**, and building against the wrong one is exactly the kind of mistake that surfaces later as "POS can't register" or "Platform rejects the manifest":

- **`Product_Contract/docs/ADD-A-PRODUCT.md`** (current, schema-v2): POS owns a self-contained manifest in its *own* repo (`product/manifest.v2.json`, exactly like HRMS's live one). Capabilities and permissions are declared *inside that manifest*. **No change to the shared SDK/contract package is required.** This matches how HRMS is actually implemented today.
- **`PRODUCT-ONBOARDING-AND-PLATFORM-INTEGRATION-STANDARD.md` §7-9** (broader governance standard): before any implementation, POS must get an architecture proposal approved, and then a team must open a reviewed change **against `@mariya-abdul/deltcrm-product-contracts` itself** to add `POS` to `ProductKey`/`ProductAudience`/`PRODUCT_AUDIENCE_BY_KEY`, and add complete `PRODUCT_CAPABILITY_KEYS`/`PRODUCT_PERMISSION_KEYS` lists — i.e. a central-registry model, contractVersion "1.0" style. It does note `POS`/`pos-api` are already reserved with an *empty* capability/permission registry.

**Action before doing anything else:** ask the Platform/contract owner which model is actually authoritative in production right now — schema-v2 self-contained manifests (matches HRMS's real code) or the centralized-registry model (matches the written standard). Get this in writing (Slack thread, one line in the architecture-proposal doc is enough) before writing POS's manifest. Everything below assumes schema-v2 (self-contained manifest, no SDK change) since that's what the live HRMS system actually runs on — but confirm it, because if the answer is "both" (manifest AND a registry entry), skipping the registry step is what would cause "Platform doesn't recognize POS" later.

---

## 1. Pre-work: get the boundary approved before writing any code

Per the onboarding standard §7, before implementation starts, submit a short architecture proposal and get sign-off from Platform, Security, DevOps, and the POS product owner. This is a paperwork step but it's the one that prevents "we built it and now the product key can't be changed" — product keys, capability keys, permission keys, and event names become **immutable public identifiers** the moment they're registered.

The proposal must state:
- Product key: `POS` (uppercase, immutable).
- Audience: `pos-api` (immutable).
- Product owner + technical owner (names, not "TBD").
- What POS owns (catalog, inventory, registers, sales, payments, refunds, receipts, POS reports) vs. explicitly does NOT own (identity, subscriptions, tenant membership, other products' data).
- Route prefixes: web `/{locale}/app/pos`, API `/api/pos/v1`.
- Capability keys: `POS_CORE`, `POS_INVENTORY`, `POS_REFUNDS`, `POS_CUSTOMERS`, `POS_REPORTING_ADVANCED`, `POS_MULTI_LOCATION` (get these five confirmed — three are still marked "new, not yet confirmed" in the POS plan).
- Permission keys: the full `pos.*` list from the manifest draft.
- Events consumed: the four standard `platform.product.*-requested.v1` lifecycle events.
- Events published: `pos.product.activated.v1` / `.suspended.v1` / `.reactivated.v1` / `.deleted.v1`.
- Tenant provisioning defaults, suspension/reactivation behavior, data classification/retention, backup RPO/RTO, expected traffic/storage.

Do not let engineering start on the trust-boundary code until this is signed off — a later rename of the product key or audience is a breaking, immutable-identifier problem, not a normal code change.

---

## 2. Resolve the version mismatch before pinning anything

Already flagged in the POS plan: the contract package's `package.json` says `2.2.0`, its runtime constant `PRODUCT_CONTRACT_VERSION` in `src/contracts.ts` says `2.1.0`, and HRMS's own `apps/api/package.json` pins `2.0.1`. Before POS installs anything:

1. Ask the contract owner which version is the one POS should build against.
2. Confirm what's actually published and loadable:
   ```bash
   npm view @mariya-abdul/deltcrm-product-contracts version
   node -e "console.log(require('@mariya-abdul/deltcrm-product-contracts').PRODUCT_CONTRACT_VERSION)"
   ```
3. Lock POS's `minimumContractVersion` in its manifest to whatever this resolves to — not to the highest number available, but to the version the contract owner actually endorses for a new product today.

Doing this now avoids the exact failure mode `RELEASE-AND-TROUBLESHOOTING.md` warns about: "Platform and products compile against different contracts without a reviewed upgrade."

---

## 3. Install the contract package correctly (this is where most silent breakage starts)

In the POS repo:

1. `.npmrc` at repo root:
   ```ini
   @mariya-abdul:registry=https://registry.npmjs.org/
   ```
   (Preserve any existing pnpm/proxy/certificate settings already in POS's `.npmrc` if one exists.)
2. Verify registry access before installing anything: `npm view @mariya-abdul/deltcrm-product-contracts version`.
3. Install the exact version resolved in Step 2, with `--save-exact`:
   ```bash
   pnpm add @mariya-abdul/deltcrm-product-contracts@<resolved-version> --save-exact
   ```
4. **Never** use `latest`, a git branch, or `workspace:*`. Commit both `package.json` and the lockfile in the same PR.
5. Import only stable entry points:
   ```ts
   import {
     ProductIntegrationClient,
     createRemoteJwksProductTokenVerifier,
     type ProductManifestV2,
     type ProductTokenClaims,
     type StableIdentifiers,
     type EffectiveEntitlements,
     type ProductPlatformPort,
   } from '@mariya-abdul/deltcrm-product-contracts';
   import { ProductIntegrationClient } from '@mariya-abdul/deltcrm-product-contracts/generated';
   ```
   Never import `/dist/...` or `/src/...` internal paths — those aren't stable across patch releases.
6. Verify resolution after install:
   ```bash
   pnpm why @mariya-abdul/deltcrm-product-contracts
   pnpm list @mariya-abdul/deltcrm-product-contracts --depth 0
   ```

---

## 4. Write POS's manifest — the actual connection artifact

Create `product/manifest.v2.json` in the POS repo (not in Product_Contract — it must never live there). Use the draft already agreed in the POS plan, but do not treat any of it as final until Step 1's sign-off happens:

```json
{
  "schemaVersion": 2,
  "productKey": "POS",
  "manifestVersion": "0.1.0",
  "minimumContractVersion": "<resolved from Step 2>",
  "displayName": "DeltCRM POS",
  "description": "Point of sale, inventory, registers, and receipts",
  "audience": "pos-api",
  "routes": { "webPath": "/{locale}/app/pos", "apiPrefix": "/api/pos/v1" },
  "navigation": {
    "key": "pos", "labelKey": "products.pos.name", "iconKey": "store",
    "order": 30, "requiredPermission": "pos.sales.read", "requiredCapability": "POS_CORE"
  },
  "permissions": [ /* full pos.* list from the POS plan, Section 5 */ ],
  "capabilities": [ /* POS_CORE + confirmed add-ons, with dependencyKeys */ ],
  "limits": [ "POS_LOCATIONS", "POS_REGISTERS", "POS_SALES_PER_MONTH" ],
  "lifecycle": {
    "mode": "EVENT",
    "consumes": ["platform.product.activation-requested.v1", ".suspension-requested.v1", ".reactivation-requested.v1", ".deletion-requested.v1"],
    "publishes": ["pos.product.activated.v1", ".suspended.v1", ".reactivated.v1", ".deleted.v1"]
  },
  "health": { "livenessPath": "/healthz", "readinessPath": "/readyz" },
  "localization": { "supportedLocales": ["en", "ar"], "namespaces": ["pos"] }
}
```

**Immutability warning** (from `ADD-A-PRODUCT.md` and the standard, §9): the product key, audience, permission keys, capability keys, and route prefixes are locked the moment this manifest is registered against Platform for the first time. Validate everything in this file — including the three unconfirmed capabilities — before the first registration, not after.

Validate it locally before touching Platform at all:
```bash
pnpm exec deltcrm-product validate product/manifest.v2.json
```

---

## 5. Configure environment — the actual runtime wiring to Platform

POS's API service needs these environment variables (never committed, always via secret management):

```env
PLATFORM_INTERNAL_BASE_URL=<Platform's internal service base URL>
PLATFORM_PUBLIC_BASE_URL=<Platform's public API base URL, for browser-context calls>
PLATFORM_JWKS_URL=<Platform's JWKS endpoint, e.g. .../.well-known/jwks.json>
PRODUCT_TOKEN_ISSUER=<Platform's token issuer, e.g. https://auth.blufield.cloud>
POS_PLATFORM_SERVICE_KEY=<POS-specific service credential, issued by Platform ops, rotated via secret manager>
```

This mirrors exactly what HRMS runs (`HRMS_PLATFORM_SERVICE_KEY`, same three Platform URLs) — the pattern is proven, just needs POS-specific values. **Never** put `POS_PLATFORM_SERVICE_KEY` in a browser bundle, log line, URL, or client-side code — it is server-to-server only.

---

## 6. Build the trust boundary — this is the piece that must work perfectly before anything else

Two files, built and tested before any POS business feature:

### 6.1 The token guard (`pos-product-token.guard.ts`)

```ts
const verifyProductToken = createRemoteJwksProductTokenVerifier({
  issuer: process.env.PRODUCT_TOKEN_ISSUER,
  audience: 'pos-api',
  productKey: 'POS',
  jwksUrl: process.env.PLATFORM_JWKS_URL,
});
const claims = await verifyProductToken(token);
```
Requirements (from `USAGE.md`):
- Decode only to read `kid` first — never trust unverified claims.
- Fetch/cache Platform JWKS; refresh once, automatically, when an unknown `kid` is seen (handles key rotation without downtime).
- Verify signature, algorithm (RS256), issuer, audience (`pos-api` exactly — reject `hrms-api`/`mail-api` tokens), and expiry.
- Attach verified claims to request context; nothing downstream re-derives `tenantId`/`userId` from anywhere else.

### 6.2 The platform adapter (`pos-platform-contract.adapter.ts`)

Wrap `ProductIntegrationClient` behind a `ProductPlatformPort` interface so POS's business code never talks to raw HTTP:

```ts
const client = new ProductIntegrationClient({
  baseUrl: process.env.PLATFORM_INTERNAL_BASE_URL!,
  serviceProductKey: 'POS',
  serviceKey: process.env.POS_PLATFORM_SERVICE_KEY!,
  getCorrelationContext: () => ({ requestId, traceId, traceparent }),
});

class PosPlatformAdapter implements ProductPlatformPort {
  getIdentityStatus(identity: StableIdentifiers) { return client.identityStatus(identity.tenantId, identity.userId, identity.membershipId); }
  getEntitlements(tenantId: string) { return client.productEntitlements(tenantId, 'POS'); }
  getProvisioningStatus(tenantId: string) { return client.provisioningStatus(tenantId, 'POS'); }
  listTenantMembers(tenantId: string, query = {}) { return client.tenantMembers(tenantId, query); }
}
```

### 6.3 Permission and capability enforcement (every protected route)

```ts
function requirePermission(claims: ProductTokenClaims, permission: string) {
  if (!claims.permissions.includes(permission)) throw new ForbiddenError('PRODUCT_PERMISSION_REQUIRED');
}
function requireCapability(entitlements: EffectiveEntitlements, capability: string) {
  const pos = entitlements.products.find(p => p.key === 'POS');
  if (!pos?.active || !pos.capabilities[capability]) throw new ForbiddenError('PRODUCT_CAPABILITY_REQUIRED');
}
```
Never infer a capability from a role, or a permission from a subscription — check each layer explicitly: subscription → entitlement → capability → permission → tenant-scoped operation.

### 6.4 Tenant-scoped queries (every single database access, no exceptions)

```ts
posDb.sale.findMany({ where: { tenantId: claims.tenantId } });
```
No repository method may accept a caller-supplied tenant ID that didn't come from verified claims. This has to be true in controllers, workers, caches, search, and file/export paths — not just the obvious API endpoints.

### 6.5 Error handling

Map the generated client's errors, don't leak internals:
```ts
try {
  await client.productEntitlements(tenantId, 'POS');
} catch (error) {
  if (isContractError(error) && error.statusCode === 403) throw new ForbiddenError(error.code);
  throw new ServiceUnavailableError('PLATFORM_CONTRACT_UNAVAILABLE'); // fail closed, never fall back to a browser-supplied tenant ID
}
```

---

## 7. Register the manifest through CI — not by hand, not by editing Platform

```bash
export PLATFORM_REGISTRY_URL=https://platform-internal.example
export PRODUCT_REGISTRATION_CI_KEY=<secret from CI, registration-only credential>
export PRODUCT_REGISTRATION_IDENTITY=pos-github-actions
export PRODUCT_MANIFEST_SIGNATURE=<base64 signature>
export PRODUCT_MANIFEST_SIGNING_KEY_ID=pos-release-key
pnpm exec deltcrm-product register product/manifest.v2.json --activate
```
The CI identity is registration-only — never a Platform operator password, never a credential stored in source. After this succeeds, a Platform operator records the approved internal deployment endpoint and configures plan grants, core capability, add-ons, and limits for POS in Platform's commercial config — that's ops work, not an app code change.

---

## 8. Wire the provisioning lifecycle (so activation actually reaches POS's database)

1. POS's worker consumes `platform.product.activation-requested.v1` / `.suspension-requested.v1` / `.reactivation-requested.v1` / `.deletion-requested.v1`, idempotently by `eventId` (dedupe table or equivalent) — duplicate delivery must create exactly one tenant projection in POS's DB, not two.
2. On successful activation, POS creates its own tenant-owned rows (empty catalog/register defaults) and publishes `pos.product.activated.v1` (or `.activation-failed.v1` on failure) back.
3. Suspension/reactivation/deletion follow the same versioned, auditable pattern — suspension must **never delete data**, only block access; deletion follows whatever retention window Platform's provisioning contract specifies.
4. Poison/unprocessable events must land in a visible dead-letter state, not silently vanish.
5. Every event carries: event ID, versioned type, producer, tenant ID, actor ID (if available), correlation ID, occurrence time, schema version, typed payload. Never widen an event's payload in place — an incompatible change is a new event type (`.v2`), never a mutation of `.v1`.

---

## 9. The exact test matrix to run before declaring the connection "done"

This is the concrete list from `USAGE.md` + the onboarding standard §26 — run every line before moving on to POS features, because this is precisely what "no connection problems later" means in practice:

**Token/auth:**
```
Valid token + active entitlement + permission        -> allowed
Wrong token audience (hrms-api/mail-api sent to POS)  -> 401
Expired or invalid signature                          -> 401
Wrong issuer                                           -> 401
Revoked/disabled user                                  -> 401/denied
Suspended tenant or membership                         -> denied
Rotated signing key (unknown kid)                       -> one JWKS refresh, then succeeds
Product-token exchange cannot request another audience -> rejected
```

**Entitlement/authorization:**
```
Inactive POS entitlement                    -> 403
Missing POS_INVENTORY/REFUNDS/etc capability -> 403 (only for that capability, others unaffected)
Missing operation permission (read vs manage)-> 403
Quotas correct under concurrent requests
Entitlement removal takes effect immediately, no stale-cache access
Historical POS data preserved while access is blocked
Reactivation restores access without re-provisioning duplicate state
```

**Tenant isolation:**
```
Tenant A token cannot read/mutate Tenant B's sales, catalog, registers, reports
Tenant A worker never processes Tenant B job context
Tenant A cannot download Tenant B's exports/receipts
Cache keys include tenant context
Search, pagination, bulk actions, reports all remain tenant-scoped
```

**Provisioning/events:**
```
Duplicate activation delivery creates exactly one tenant projection
Retry after partial provider failure is safe (no double-provisioning)
Outbox survives a restart
Poison event reaches a visible dead-letter state
Suspension and reactivation converge correctly
Correlation IDs traceable across the whole lifecycle
```

**Platform availability/failure:**
```
Platform required authorization endpoint unavailable -> fail closed (never accept a browser-provided tenant ID as fallback)
Platform temporarily unavailable during a request      -> service-unavailable, POS shell/health reports it, doesn't silently reroute
```

**Routing/shell/localization:**
```
en and ar routes both reach the POS deployment
Language switch preserves deep links and query params
Browser refresh works on nested POS routes (/en/app/pos/registers/3 etc.)
API routes are locale-independent
Unsupported locale falls back per tenant policy
Mobile/tablet/desktop layouts and all supported themes render correctly
```

If every row above passes, POS is genuinely connected — not "looks connected in the happy path."

---

## 10. Observability — so a future connection problem is visible instead of silent

Instrument from day one (per `RELEASE-AND-TROUBLESHOOTING.md`):
- Token issuance/verification failures, broken down by reason (bad audience, expired, bad signature, unknown kid).
- Entitlement/permission denial counts.
- Platform integration call latency and failure rate.
- Provisioning state transitions and retry counts.
- Lifecycle event lag and dead-letter counts.
- POS's own `/healthz` and `/readyz`.
- Which contract package version and manifest version are actually running in each environment.

Propagate `X-Request-Id`, `X-Trace-Id`, `traceparent` through gateway → Platform → POS logs so a support ticket can be traced end to end. Never log the service key, product tokens, or raw card/payment data.

---

## 11. Rollback readiness (so a bad deploy doesn't become a platform-wide incident)

Before POS's first production deployment, prove:
- A previous Platform version and a previous POS version can run together during any compatibility window.
- Any POS database change is forward-compatible (additive migrations only — never `prisma migrate reset`, `db push`, truncate, or drop against a real tenant database).
- The gateway can be pointed back at a previous POS deployment without data loss.
- Lifecycle event consumers can safely replay events after a rollback (idempotency by `eventId` makes this safe).
- Tenant data remains intact through the whole rollback path.

---

## 12. Runtime troubleshooting reference (keep this next to the on-call runbook)

| Symptom | First things to check |
|---|---|
| `INVALID_PRODUCT_TOKEN` | Token audience matches `pos-api`; Platform issuer/algorithm; token expiry & clock sync; JWKS reachable; unknown `kid` triggers one refresh; gateway preserves the `Authorization` header |
| `PRODUCT_NOT_ENTITLED` | Tenant subscription state; POS entitlement actually active; provisioning state is `READY`; stale entitlement cache not invalidated |
| `PRODUCT_PERMISSION_REQUIRED` | Platform role→permission assignment; token actually contains the expected `pos.*` permission; permission is declared in POS's *active* registered manifest; never "fix" this by just hiding a UI button |
| `PLATFORM_CONTRACT_UNAVAILABLE` | Platform readiness; internal DNS/gateway routing; `POS_PLATFORM_SERVICE_KEY` validity; correlate via request/trace IDs; fail closed always |
| Provisioning stuck pending | Lifecycle event actually delivered; event schema version + product key correct; idempotency/dead-letter queue; POS DB connectivity; retry without duplicating tenant state |

---

## 13. Once this is done, what POS can build independently — and what it still can never touch

**POS's team can, without asking Platform again:**
- Add/change POS business logic, screens, schema, jobs, and reports entirely inside its own repo and database.
- Add new POS-internal permissions/capabilities in a *future* manifest revision (still needs registration + compatibility check, but no cross-team code review of Platform internals).
- Scale, redeploy, and roll back POS independently of Platform and HRMS.
- Change POS's tech stack internals (as long as `/healthz`, `/readyz`, and the manifest contract keep working).

**POS's team can never, ever do — regardless of how independent it becomes:**
- Query Platform's or HRMS's database directly.
- Import Platform or HRMS application code.
- Trust `tenantId`/`userId`/permissions/capabilities from a request payload instead of verified token claims.
- Change its product key, audience, or route prefixes after first production registration.
- Send `POS_PLATFORM_SERVICE_KEY` anywhere client-side.
- Add POS's product key/permissions/capabilities into the `Product_Contract` repository itself (if the schema-v2 self-contained-manifest model from Step 0 is confirmed) — that package stays generic forever.

---

## Summary checklist (paste into a tracker)

- [ ] Step 0: Confirm schema-v2 self-contained manifest vs. centralized-registry model with the contract owner.
- [ ] Step 1: Architecture proposal approved by Platform/Security/DevOps/product owner; product key `POS` and audience `pos-api` locked.
- [ ] Step 2: Contract version mismatch resolved; `minimumContractVersion` decided.
- [ ] Step 3: `@mariya-abdul/deltcrm-product-contracts` installed at the resolved exact version, `--save-exact`, lockfile committed.
- [ ] Step 4: `product/manifest.v2.json` written and passes `deltcrm-product validate`.
- [ ] Step 5: Platform env vars + `POS_PLATFORM_SERVICE_KEY` configured via secret management, never committed.
- [ ] Step 6: Token guard, platform adapter, permission/capability enforcement, tenant-scoped queries, error handling all implemented and unit-tested.
- [ ] Step 7: Manifest registered through CI with a registration-only credential; Platform ops configured plan/capability/limit grants.
- [ ] Step 8: Lifecycle event consumption wired, idempotent, with dead-letter handling.
- [ ] Step 9: Full test matrix (Section 9 above) passing.
- [ ] Step 10: Observability wired (token failures, entitlement denials, latency, lifecycle lag, health).
- [ ] Step 11: Rollback path proven in a rehearsal, not just described.
- [ ] Step 12: Runtime troubleshooting reference handed to on-call.

Once every box above is checked, the connection is done — POS's engineers can build the actual product (catalog, registers, sales, payments, etc.) entirely inside their own repo without ever needing to touch CRM or Product_Contract again for a routine feature.
