# CRM ↔ POS connection — manual verification checklist

Run this on your machine, where Docker and pnpm are actually available (this could not be
executed from the cloud session that wrote the code — see its chat message for why).

## 0. One-time setup

```bash
# POS: install deps once if you haven't since the package.json change
cd POS && pnpm install

# Apply the new migration (adds platform_tenant_id / platform_user_id columns)
cd apps/api && pnpm db:migrate
```

If this organization already has real POS data from before CRM was wired up, link it once:
```bash
pnpm db:link-platform-tenant -- --org-slug=<your-pos-org-slug> --tenant-id=<crm-tenant-uuid> --dry-run
# then without --dry-run once it looks right
```

## 1. Start everything

```bash
# CRM (Platform + gateway)
cd b1/CRM && docker compose -f docker-compose.platform-local.yml up -d --build

# HRMS
cd b2/HRMS && docker compose -f docker-compose.hrms-local.yml up -d --build

# POS
cd POS && docker compose up -d --build
```

## 2. Health checks

```bash
curl -s http://localhost:4080/gateway-health
curl -s http://localhost:4080/api/hrms/healthz
curl -s http://localhost:4080/api/pos/healthz     # new — should now return 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4080/api/pos/v1/some-protected-route   # expect 401, no token
```

## 3. The real SSO path

1. Open `http://localhost:4080` and log into CRM as a user whose tenant has **POS** entitled.
2. Navigate to `http://localhost:4080/en/app/pos`.
   - **Expect:** you land inside POS with no second login prompt.
   - If you see POS's own `/login` page instead, the `deltcrm_access` cookie wasn't picked up — check you're on `localhost:4080` (not `:4022` or `:3100` directly), and check `GET /api/auth/platform` isn't erroring in the POS web container logs (`docker logs deltcrm_pos_web`).
3. Confirm the store overview or your landing page actually renders (storeIds should no longer be empty for an admin).

## 4. Prove the trust boundary actually holds

```bash
# An HRMS-scoped token must be rejected by POS (wrong audience)
HRMS_TOKEN=... # grab one from HRMS's own sign-in flow
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $HRMS_TOKEN" \
  http://localhost:4080/api/pos/v1/overview
# Expect: 401
```

In CRM, **suspend or disable POS** for that tenant (product registry / subscription screen), then:
```bash
curl -s http://localhost:4080/api/pos/v1/overview -H "Authorization: Bearer $POS_TOKEN"
```
**Expect:** `403` with `code: "PRODUCT_NOT_ENTITLED"` or `"TENANT_ACCESS_SUSPENDED"` — within ~30s
(the new cache's TTL), not instantly, since a cached check can serve one stale read first.

## 5. Database check

```sql
-- in the POS database
select id, slug, platform_tenant_id from organizations where platform_tenant_id is not null;
select id, email, platform_user_id, platform_membership_id from users where platform_user_id is not null;
```
Both should be populated for the tenant/user you just signed in as.

## 6. Run the automated tests

```bash
cd POS/apps/api
pnpm test          # includes platform-auth.service.spec.ts — 22 cases
pnpm typecheck
```

## If something fails

- **Stuck on POS's own `/login`**: the gateway route or the `deltcrm_access` cookie isn't reaching POS web. Check `docker network inspect deltcrm-local-integration` shows `pos-web`/`pos-api` aliases.
- **503 `PLATFORM_CONTRACT_UNAVAILABLE`**: POS API can't reach CRM's API — check `PLATFORM_INTERNAL_BASE_URL` / `host.docker.internal` resolves from inside the POS API container.
- **401 immediately after a successful CRM login**: check `PRODUCT_TOKEN_ISSUER` is identical across CRM, HRMS, and POS (`https://auth.local.blufield.test` in all three local compose files) — this exact mismatch was one of the bugs fixed in this change.
