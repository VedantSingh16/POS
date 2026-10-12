# Phase 0 baseline

Prepared: 7 October 2026

## Snapshot

- The pre-Phase-0 implementation is preserved in commit `5f1c507` on branch `baseline`.
- Phase-0 work is on branch `phase0`.
- The initial repository had one commit (`682d186`) and the Plan 1/2 implementation was uncommitted.
- The local `_to_delete/` archive is intentionally not source-controlled. It remains on disk.
- Prisma's generated client is ignored and must be regenerated with `pnpm --filter api db:generate` after checkout.

## Baseline findings

The pre-Phase-0 tree had separate app workspace/lock files, a root lockfile with a stale pnpm-only YAML document, no root `packages/` workspace, and no root development workflow skills. The current Prisma schema was mapped to the PostgreSQL-native tables, but the generated client on disk was stale; the first API build failed until the client was regenerated. No boot-time `ensureSchema()` implementation remains in the checked-in API source.

## Verification record

Commands are run from the repository root unless a package is specified.

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS | Single root lockfile installs all four workspace projects. |
| `pnpm --filter api exec prisma validate` | PASS | Prisma schema is valid. |
| `pnpm --filter api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script --exit-code` | PASS | Empty migration after applying against a disposable PostgreSQL shadow database. |
| Fresh database `pnpm --filter api db:migrate` | PASS | The Phase-0 baseline recorded migrations 0001, 0002 and 0003; current Plan 3 development has since added migrations 0004–0010. |
| `pnpm --filter api exec prisma migrate status` | PASS | Database schema is up to date. |
| `pnpm --filter api test:e2e` | PASS | 7 files, 31 tests. |
| `pnpm lint` | PASS | API has no lint errors; web has one existing React Compiler warning for TanStack Table. |
| `pnpm typecheck` | PASS | API and web typecheck successfully. |
| `pnpm build` | PASS | Nest API and Next.js web builds succeed. |
| `pnpm test` | PASS | API: 2 files/4 tests; web: 1 file/10 tests. |
| `docker compose config` | PASS | Compose resolves root build contexts and services. |
| `docker compose build` | PASS | API and web images build from the repository root context after the workspace and standalone-runtime fixes. |
| `docker compose up -d api web` | PASS | With `POSTGRES_PORT=15432` and the disposable local password override, Postgres, API, Redis, and web start successfully. |
| `GET http://localhost:4100/healthz` | PASS | API returns HTTP 200 from the running container. |
| `GET http://localhost:3100/` | PASS | Next.js web container returns HTTP 200 and reports healthy in Compose. |

A PASS here means the command actually completed successfully. Preview UI data, source-file presence, and declared feature status are not treated as verification. The Compose runtime check uses the disposable local Postgres volume and does not replace a production backup/restore test.
