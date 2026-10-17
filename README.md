# DeltPOS MVP

This repository contains the Plan 3 POS MVP: a NestJS/Prisma API, Next.js web app, PostgreSQL and Redis Compose stack, and a shared package for money, GST and permissions.

## Run locally

```powershell
pnpm install
Copy-Item .env.example .env
pnpm --filter api db:migrate
pnpm --filter api db:generate
pnpm --filter api db:seed
# terminal 1
pnpm --filter api start:dev
# terminal 2
pnpm --filter web dev
```

Use the bootstrap credentials from `.env`. The API listens on the configured port and the web app uses the server-side BFF proxy; the session token is kept in an httpOnly cookie.

## Verify

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test
$env:POS_TEST_DATABASE_URL='postgresql://...'; pnpm test:e2e
```

Run the Docker checks from `DOCKER.md`. The current, evidence-based phase status is in [docs/plan3-status.md](docs/plan3-status.md); the historical Plan 2 document is not the source of truth for Plan 3. The organisation/store redesign and what was verified is in [docs/redesign-status.md](docs/redesign-status.md).

## MVP boundaries

Cash, card and UPI are recorded; no payment-terminal integration is included. Receipts and credit notes use browser printing. Offline selling, purchase orders, stock counts, e-commerce and food-service flows remain out of scope.
