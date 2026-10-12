# Plan 2 implementation status (historical)

> Plan 3 supersedes this document for the current MVP. Use [docs/plan3-status.md](plan3-status.md) for verified implementation status. The table below records the earlier Plan 2 pilot and is not evidence that the corresponding Plan 3 exit criteria are complete.

This workspace implements Plan 2 as an incremental pilot. The API and UI intentionally expose the phase boundary so the product can be reviewed without pretending that advanced or optional integrations are complete.

## Shipped in this slice

| Phases | Status | Evidence |
|---|---|---|
| 0 | Live | PostgreSQL persistence (Prisma, native types and foreign keys), store-scoped permissions, lockout, idle sessions, operational permission catalogue, audit events |
| 1 | Demo boundary | `/api/pos/v1`, `/healthz`, `/readyz`, capability manifest, local auth and plan2 feature board |
| 2 | Live | Catalogue search, products/variants, prices, GST groups, barcode data |
| 3 | Live | Register sessions, opening float, cash movements, X/Z summary, blind close and variance |
| 4 | Live | Server-side tax calculation, idempotent checkout, split-tender data model, hold/resume, receipts and outbox event |
| 5 | Live | Approval records and discount threshold enforcement |
| 6 | Demo boundary | Lifecycle-capable manifest and outbox-ready event model; external Platform registration remains environment-dependent |
| 7 | Live | Append-only inventory movements, condition balances, sale/return posting and locations |
| 8 | Live | Partial return caps, damaged/sellable restock, cash refund reconciliation and credit notes |
| 9 | Live | Sales/tax/returns/tender reports and cash-variance alerts |
| 10 | Demo boundary | Pilot checklist surface is represented by the Roadmap screen; load/backup/rollback evidence remains deployment work |
| 11 | Live | Customers, groups, wallet ledger and points ledger |
| 12 | Live foundation | Coupon and usage-limit records, bundle component definitions |
| 13 | Live foundation | Stock locations and transfer request/status lifecycle |
| 14–21 | Backlog | Visible in the Roadmap screen with explicit `BACKLOG` status; no false implementation claim |

## Verification commands

Run from `POS/apps/api`:

```text
pnpm build
pnpm test
pnpm test:e2e
```

Run from `POS/apps/web`:

```text
pnpm build
```

The e2e suite covers the original foundation, full catalogue → register → sale → inventory → refund → report flow, checkout idempotency, duplicate register opens, customers, coupons, locations, transfers, and hold/resume.

## Pilot walkthrough

1. Start the API and web app.
2. Sign in with the local bootstrap credentials from the API environment.
3. Select **Create demo workspace** on Home.
4. Use Till to open a register, search the seeded SKU, complete a cash sale, and open Returns.
5. Use Registers to inspect or close the session, Inventory to inspect movements, Reports to reconcile totals, and Roadmap to review all phases.

Data is stored in PostgreSQL via Prisma migrations (`0003_postgres_native` replaced the earlier SQLite-style tables). Real Platform token/JWKS wiring remains the explicit deployment boundary from Plan 2 Phase 0/1.
