# Deploying POS: Vercel (web) + Render (API + Postgres)

## Architecture

| Piece | Where |
|---|---|
| `apps/web` (Next.js) | Vercel, Root Directory `apps/web` |
| `apps/api` (NestJS) | Render Web Service (Docker, `apps/api/Dockerfile`) |
| PostgreSQL | Render Postgres (internal connection string) |
| Redis | Not needed - the API code does not use it |

The browser only talks to the web app (`/api/auth/*`, `/api/proxy/*`). Vercel's server code calls the API
with the session token from an httpOnly cookie. So no shared custom domain is needed; the default
`*.vercel.app` + `*.onrender.com` URLs work. Add custom domains later if you want.

## Steps

1. Push this repo to GitHub (it is `Mariya-Abdul/Liqaa-POS`; deploy from a branch you have merged, not an unmerged one).
2. **Render:** New -> Blueprint -> select the repo (`render.yaml`). Enter `POS_WEB_ORIGIN` (put a placeholder now, fix after step 4), `POS_ORG_ADMIN_EMAIL`, `POS_ORG_ADMIN_PASSWORD` (12+ chars).
   Migrations and the idempotent bootstrap seed run on every start (image CMD).
3. Check `https://<your-api>.onrender.com/healthz` returns `{"status":"ok"}`.
4. **Vercel:** Import the repo, Root Directory `apps/web`, Node 22, keep "Include source files outside of the Root Directory" ON.
   Env vars (see `apps/web/.env.production.example`): `API_INTERNAL_URL=https://<your-api>.onrender.com`, `ENABLE_EXPERIMENTAL_COREPACK=1`.
5. Copy the Vercel URL into Render's `POS_WEB_ORIGIN`, redeploy the API.
6. Open the Vercel URL and sign in with `POS_ORG_ADMIN_EMAIL` / `POS_ORG_ADMIN_PASSWORD`.

## Notes

- "Create demo workspace" is blocked in production unless `ALLOW_DEMO_SEED=true` (intentional).
- `data/pos.sqlite` is a legacy local file; production uses Postgres only. Do not upload it.
- Do not use Render free web/Postgres tiers for a live till: free web services sleep, free Postgres expires.
- Keep the Render region and Vercel function region (`vercel.json` -> `sin1`) close together; change both if your users are elsewhere.
- Changing `API_INTERNAL_URL` needs a Vercel redeploy.
