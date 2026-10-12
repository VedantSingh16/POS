# Docker setup

These commands run the current Plan 3 POS MVP stack with the web console, API, PostgreSQL, and Redis containers.

## First setup

From the `POS` directory:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and change `POS_ORG_ADMIN_PASSWORD` and `POSTGRES_PASSWORD` before sharing or deploying the stack.
The Compose file supplies the container-safe PostgreSQL and Redis service URLs automatically.
If an environment value contains `$`, wrap the complete value in single quotes in `.env` so Compose does not treat it as variable interpolation.

## Build and start

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

Open:

- Web console: http://localhost:3100
- API health: http://localhost:4100/healthz
- API readiness: http://localhost:4100/readyz

PostgreSQL and Redis stay private to the Compose network; only the web and API ports are exposed on the host.

The first login uses the values from `POS_ORG_ADMIN_EMAIL` and `POS_ORG_ADMIN_PASSWORD` in `.env`. In the console, choose **Create demo workspace** to create a store, register, stockroom, product, barcode, price, tax group, and approval policy.

## Logs and lifecycle

```powershell
docker compose logs -f api
docker compose logs -f web
docker compose restart api
docker compose stop
docker compose start
docker compose down
```

All POS data lives in PostgreSQL (named volume `postgres_data`); Redis uses `redis_data`. Both volumes are retained by `docker compose down`.

To rebuild after code changes:

```powershell
docker compose build --no-cache
docker compose up -d
```

To remove all local data as well as containers, use this destructive command only when a clean reset is intended:

```powershell
docker compose down -v
```

If a host port is already in use, change `POS_WEB_PORT`, `POS_API_PORT`, or `NEXT_PUBLIC_API_URL` in `.env`, then rebuild the web image so the browser bundle points at the new API port.

The API stores all data in PostgreSQL through Prisma and applies migrations (`prisma migrate deploy`) when the container starts. Redis is provisioned and health-checked for the later worker/queue phase.
