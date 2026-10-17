# Golden Crust production seed

`apps/api/prisma/seed-bakery.ts` creates a repeatable sample tenant called **Golden Crust Bakery**. It is intended for a new installation, a staging environment, or an explicitly approved production bootstrap. The script is idempotent: running it again updates the same records and does not create another tenant or duplicate the sample transactions.

The seed includes five stores, 35 bakery products in every store, staff and role assignments, opening hours, registers, tax groups, pricing, barcodes, stock balances and movements, customers, loyalty ledger data, charges, discount reasons, price rules, promotions, bundles, historical register sessions, sales, payments and payment attempts, a return, held sale, approval, transfer, distribution, attendance record, day close, report export, low-stock alert, audit entry, outbox event, and document sequences.

## Required guard

The script refuses to run unless `SEED_CONFIRM` is exactly `GOLDEN_CRUST_BAKERY`. Set the admin and staff passwords through environment variables for a real deployment; the defaults are suitable only for local development.

### PowerShell

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DB"
$env:SEED_CONFIRM = "GOLDEN_CRUST_BAKERY"
$env:SEED_ADMIN_EMAIL = "owner@your-domain.example"
$env:SEED_ADMIN_PASSWORD = "use-a-unique-strong-password"
$env:SEED_STAFF_PASSWORD = "use-a-different-strong-password"
pnpm --filter api db:migrate
pnpm --filter api db:seed:bakery
```

### Bash

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB'
export SEED_CONFIRM='GOLDEN_CRUST_BAKERY'
export SEED_ADMIN_EMAIL='owner@your-domain.example'
export SEED_ADMIN_PASSWORD='use-a-unique-strong-password'
export SEED_STAFF_PASSWORD='use-a-different-strong-password'
pnpm --filter api db:migrate
pnpm --filter api db:seed:bakery
```

### Docker Compose

```bash
docker compose exec -e SEED_CONFIRM=GOLDEN_CRUST_BAKERY \
  -e SEED_ADMIN_EMAIL=owner@your-domain.example \
  -e SEED_ADMIN_PASSWORD='use-a-unique-strong-password' \
  -e SEED_STAFF_PASSWORD='use-a-different-strong-password' \
  api node_modules/.bin/prisma migrate deploy
docker compose exec -e SEED_CONFIRM=GOLDEN_CRUST_BAKERY \
  -e SEED_ADMIN_EMAIL=owner@your-domain.example \
  -e SEED_ADMIN_PASSWORD='use-a-unique-strong-password' \
  -e SEED_STAFF_PASSWORD='use-a-different-strong-password' \
  api node_modules/.bin/tsx prisma/seed-bakery.ts
```

The seed does not delete existing tenants or rows. Run it against the intended database after taking the normal production backup, and change the generated credentials after the first sign-in.
