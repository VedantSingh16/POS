# Plan 6: Sales and checkout, pricing, payment and invoice

Status: PLAN ONLY, nothing implemented. Written 13 Oct 2026 from a read of the code (`apps/api/src/pos`, `apps/api/prisma/schema.prisma`, `apps/web/features/pos`), the earlier plans/status docs, your three flow diagrams (W1 Build the Cart, W2 Decide the Total, W3 Take Payment and Finish the Sale) and your own suggestions.

Nothing was run: no build, no tests, no browser. Everything under "What exists today" comes from reading source.

---

## 1. Summary

You are not starting from zero. The API already prices a cart on the server, takes cash/card/UPI (including split), saves the sale in one transaction with an idempotency key, updates the cash drawer, posts stock, and produces an A4 GST invoice PDF. The big gaps against your diagrams and suggestions are:

1. **Pricing is thin.** Only "store price vs organisation price". No price rules (customer tier, quantity, time), and **promotions/coupons exist in the database and API but are never applied at checkout.**
2. **A missing price sells for ₹0.** `priceLine` uses `price?.amountCents ?? 0`. W2 says "no price found → line blocked; open price needs manager".
3. **No B2B identity.** Customers have no tax number, billing address or state, so the invoice cannot show the buyer's GSTIN/VAT number or choose CGST+SGST vs IGST.
4. **Payments are only recorded.** Nothing talks to a bank/gateway, there is no pending/failed state, and wallet/points are not payment methods (W3 lists them).
5. **Invoice reads live data.** A reprint after an address/GSTIN edit would differ from the original. It also shows "Rs." instead of ₹.
6. **Quick keys are not top sellers.** The "Quick keys" tab shows every product (`hot: true` is set on all search results in `features/api.ts`).

Recommended order: **Pricing (1) → B2B/tax identity (2) → Adding items (3) → Payment (4) → Invoice (5)**, with network-offline selling kept as an optional last phase (see decision D1).

---

## 2. Your suggestions and where they land

| Your suggestion | Verdict | How it is handled |
|---|---|---|
| Add items by tapping tiles, best sellers first, with a search bar | Keep | Phase 3: tiles ranked by real sales per store (last 30 days), manager can pin favourites; search runs on the server (today it only searches the first 100 loaded products). |
| Add items by scanning a barcode | Keep | Already works (scan box, exact server lookup). Phase 3 hardens it: duplicate-code picker, not-found message, repeat scan adds quantity, scale/weight items. |
| Pricing configured by the store manager / organisation admin | Keep, with limits | Phase 1: one "Pricing" area. Organisation admin owns base price, price rules, promotions, tax groups. Store manager may add store tax groups/charges and store-level discount limits but not the base price (this matches what you confirmed in plan 5). |
| Base price, VAT, discount per item or on the whole sale | Keep | Base price and tax group per variant (exists). Discount per line and per order (exists, ₹ only in the UI; add %). Add configurable reason codes. |
| VAT number for business-to-business | Keep, renamed | The project is India GST (INR, GSTIN, HSN). I would store one generic **Tax number** (label shown as "GSTIN" or "VAT no." from a setting) on the organisation, store and customer. Phase 2. |
| Product details configurable: brand, category, base price, barcode and so on, all editable | Keep | Most fields exist. Gaps: category edit (no endpoint), brands are partly text/partly records, no add/remove barcode UI check, no "catalogue completeness" check. Phase 3b. |
| Payment online or offline; offline must update the registers | Keep, needs your confirmation | I read **offline = at the counter (cash, or card/UPI confirmed by the cashier)** and **online = gateway-confirmed**. Cash already updates the register session; Phase 4 extends this to card/UPI expected totals. If you meant "internet is down", that is a separate, larger phase (D1). |
| Invoice PDF after payment | Keep | Exists. Phase 5 freezes the invoice data, fixes the ₹ glyph, adds buyer GSTIN, IGST, thermal layout and e-mail/SMS. |

Things I added that you did not ask for (drop any you do not want): missing-price block, discount reason codes and approval limits per role, invoice snapshot, held-sale expiry, gap-free invoice series by financial year, payment reconciliation job.

---

## 3. What exists today, mapped to your diagrams

Legend: **Built** = works as the diagram says. **Partial** = some of it. **Missing** = not in code.

### W1 Build the Cart

| Diagram step | Status | Evidence / gap |
|---|---|---|
| Start new sale; "cannot start": register not open → open shift | Built | Register session required; POS shows "open register" dialog and banner. |
| "Not signed in → personal PIN login" | Built | PIN unlock exists in auth. |
| Add item by scan / find / tile / grid | Built | Scan box + Browse items dialog + category tiles (`pos-screen.tsx`). |
| Item and stock OK? | Partial | Server enforces BLOCK/WARN/ALLOW stock policy on save, but the tile is disabled when stock ≤ 0 regardless of the store's policy, and the cart does not warn before payment. |
| Barcode not found → search | Partial | Toast "No product matches", no automatic fall-back to search. |
| Same code on two items → pick one | Missing | Scan takes the first hit. |
| Blocked item → refused | Built | Only ACTIVE store variants are sellable. |
| Resolve item: variant, bundle, weight | Partial | Variants are separate SKUs (no variant chooser). `Bundle` tables and API exist but a bundle cannot be added to a cart. Quantity is stored as decimal(14,3) but the UI only does whole-number +/−, so weights need typing support. |
| Open-price item → manager approves price above floor (PIN) | **Missing** | No open-price flag. Missing price silently becomes ₹0. |
| Edit cart: qty, remove, notes | Built | |
| Cart ready; hold | Partial | Hold/resume works; no expiry for old holds. Resume re-prices through the quote (good). |

### W2 Decide the Total

| Diagram step | Status | Evidence / gap |
|---|---|---|
| Line price by customer, time, channel, store, tier, qty; first matching rule wins; base price last | **Missing** (store vs org only) | `pickPrice`: store-specific beats org-wide, newest `effectiveFrom` wins. No rule table. The code still honours store-specific price rows although plan 5 decided base price is organisation-only. |
| Price found? No → base price; none at all → line blocked | **Missing** | Falls to ₹0. |
| Customer not found → create on the spot or walk-in | Built | Quick-create customer; sale works without one. |
| Promotions: code, store, stacking limits | **Missing at checkout** | `Promotion` model has code, type, min subtotal, usage limit/count, dates. `quoteSale` and `completeSale` never read it. No coupon field in the UI. |
| Expired / limit used up → removed, new total shown; two promos clash → stacking priority | Missing | No priority/stack fields. |
| Manual discount → manager approves with reason code | Partial | Discount threshold policy and manager PIN exist; reason is free text, not a code list. |
| Discount refused → removed; all manual discounts recorded | Partial | PIN failure blocks the sale; refused approvals are recorded in `approvals`. |
| Tax and charges: tax group, fees, rounding | Built | GST by tax group (store group beats org group), inclusive/exclusive prices, additional charges (flat/percent, per bill/per item, taxable), cash rounding as its own line. |
| Tax override only with manager approval + audit | Missing | No tax override exists at all. |
| Negative total held at zero, flagged | Missing | Discount is capped at subtotal, so it cannot go negative today, but nothing is flagged. |
| Total frozen and shown to customer | Partial | The quote is the source of truth, but nothing freezes it: completeSale re-prices again. |

### W3 Take Payment and Finish the Sale

| Diagram step | Status | Evidence / gap |
|---|---|---|
| Choose payment: cash, card, UPI, split, wallet, points | Partial | `TenderType` = CASH, CARD, UPI, OTHER. Two-way split only. Wallet and points balances exist on `Customer` but cannot be used as tender. |
| Customer pays cash (rounded) | Built | Cash rounding unit from settings, change computed. |
| Payment accepted? | **Missing** | The cashier types a reference; nothing is verified. There are no payment states. |
| Declined → other method; timeout → check with bank, never charge twice | Missing | Needs a real payment attempt record. |
| Save the sale: sale, payment, stock, points, drawer total | Built | One transaction: sale, lines, payments, drawer `expectedCashCents`, stock ledger, loyalty points, outbox event, audit. |
| Save failed → whole save undone; press again, no duplicate | Built (for the save) | `clientSaleId` unique key returns the original sale. A card charge cannot be reversed because no card charge is made by the system. |
| Documents: receipt, tax invoice, credit note | Built | Invoice PDF endpoint, browser print, credit note on returns. |
| Receipt print / e-mail / SMS | Partial | Print and PDF only. No e-mail or SMS. |
| Printer fails → sale already final, reprint from history | Built | |
| After the sale: points, low-stock alert, tax filing in background; failure never undoes the sale | Partial | Outbox event and alert scheduler exist; tax filing is not built. |

---

## 4. Decisions I need from you (my default is used if you do not answer)

| # | Question | Default |
|---|---|---|
| D1 | "Offline" payment: (a) at the counter (cash / manual card-UPI) or (b) the till works with no internet? | (a). (b) is Phase 6, large, last. |
| D2 | Online payments: which provider? | Razorpay (UPI + cards, India) behind a provider interface so another can be added. No physical card terminal in v1. |
| D3 | Tax wording: keep India GST, with a generic "Tax number" field? | Yes. |
| D4 | Can a store manager set a store-only price? | No. Base price organisation-only (as in plan 5). Customer-tier or quantity price rules: organisation only. |
| D5 | Promotions stacking | One coupon per bill. Automatic promotions apply by priority; a promotion stacks only if flagged "stackable". |
| D6 | Who approves: manager PIN only, or also remote approval from the Approvals page? | Both (both exist already). |
| D7 | Receipt delivery channels in v1 | Print, PDF download, e-mail. SMS/WhatsApp later (needs a provider and templates). |
| D8 | GST e-invoicing (IRN/QR) for businesses over the turnover threshold | Out of scope; flagged in risks. |

---

## 5. Design

### 5.1 Pricing (W2), the engine

**One server function prices everything** (it already does: `quoteSale`). Keep that rule and extend it. Order of evaluation, per line then per bill:

1. **Price rule** (first match wins by priority, base price is the last fallback).
2. **Promotions** (automatic, then coupon), respecting stacking and limits.
3. **Manual discount** (line, then order), with reason code and approval.
4. **Tax** from the tax group (store group, else organisation group), inclusive or exclusive.
5. **Charges**, taxed by their own tax group.
6. **Rounding** shown as its own line (cash only, as today).

Safety rules (from W2): no price anywhere → line blocked unless the item is flagged open-price (then a manager PIN sets the price, never below the item's floor price); negative total is held at zero and an alert is raised; tax override only with approval + audit entry.

**The quote returns a full breakdown per line** (base price, rule that won, promo, discount, tax). The cashier sees why a price is what it is, and the invoice uses the same numbers. The quote carries a `quoteId`/hash; checkout rejects (with the new total shown) if the cart no longer prices to the same figure. That is the "total frozen" step.

**Configurable by the organisation (and store where stated):**

- Base price per variant, cost, tax group, HSN (exist).
- Price rules: scope (variant / category / brand), store (or all), customer group, minimum quantity, date/time window, price or % off base, priority.
- Promotions: add scope, `autoApply`, `priority`, `stackable`, per-customer limit; keep code, dates, usage limit.
- Discount reason codes and, per role, the discount limit that needs approval (extends `ApprovalPolicy`).
- Tax groups and charges (exist; stores may add their own).
- Open-price flag and floor price per variant.

### 5.2 B2B and tax identity

- `Store.taxNumber` (plan 3 said "GSTIN if different"; the column does not exist yet).
- `Customer`: `taxNumber`, `legalName`, billing address, state code, `isBusiness`. Validate GSTIN format and checksum.
- Place of supply = store state vs customer state. Same state → CGST+SGST; different → IGST. `splitGst(…, intraState)` already exists in `packages/shared`; the invoice currently always splits in half.
- Invoice shows Bill-to (name, GSTIN, address), place of supply and an HSN summary.

### 5.3 Adding items (W1)

- **Tiles:** a per-store "top sellers, last 30 days" query (cached, refreshed hourly), with manager-pinned favourites first. Replaces `hot: true` for everything.
- **Search:** server-side, debounced, covers the full store catalogue (today `take: 100`).
- **Scan:** keep the always-focused scan box. Add: duplicate-barcode picker, "not found → open search with that text", repeat scan increments quantity, optional beep.
- **Variants, bundles, weights:** variant chooser when a product has several variants; bundles addable (stock check per component, warning if a part is out); decimal quantity keypad for weighed items.
- **Stock:** the UI follows the store's stock policy (block / warn / allow) instead of disabling tiles.
- **Holds:** expiry (setting, default 24 h), expired holds listed as expired.

### 5.4 Catalogue configurability

Everything below must be editable by the organisation, with an audit entry on every change: brand (record, not just text), category (add edit/rename/move endpoint), unit of measure, tax group, HSN, base price, cost, barcodes (several per variant, add/remove, internal EAN-13 generator), status, open-price flag. Product/variant CSV import exists; add CSV export. A "needs attention" list shows products with no price, no tax group, no barcode or no category.

### 5.5 Payment (W3)

Definitions, so the screen and the code agree:

- **Counter payment ("offline")**: cash, or card/UPI taken on a separate terminal or QR and confirmed by the cashier with a reference. Cash updates the register's expected cash immediately (exists). Card/UPI update the register's expected totals per method so close-of-day can be matched to the terminal settlement.
- **Online payment**: the system creates a payment attempt with the provider and waits for confirmation (webhook or poll). Sale is saved only when every payment is confirmed.

Design:

- New `PaymentAttempt` record: method, amount, status (PENDING, CAPTURED, FAILED, VOIDED, UNKNOWN), provider, provider reference, idempotency key, error. `SalePayment` is created from captured attempts.
- Rules from W3: not enough paid → add another method, nothing saved; declined → try another method or cancel; **no reply (timeout) → status UNKNOWN, look it up with the provider before allowing a retry**; save fails after money was captured → automatic void/refund job plus an alert; pressing again never creates a second sale (`clientSaleId`, exists).
- Payment methods enabled per organisation/store (cash, card, UPI, wallet, points, gift card later, credit for B2B accounts later).
- Wallet and points as tenders using the existing customer ledger, with balance checks.
- Any number of tenders in one sale (today: two).
- After the sale (background via the existing outbox): points, low-stock alerts, accounting export. A failure there never undoes the sale.

### 5.6 Invoice PDF

- **Freeze at sale time:** store seller name/address/GSTIN, buyer details and the document layout choice in a JSON snapshot on the sale, so a reprint is identical to the original.
- Fix the rupee sign (embed a font; the current generator draws "Rs." because standard PDF fonts lack ₹).
- Layouts: A4 tax invoice, 80 mm thermal receipt, credit note.
- Invoice number: gap-free series per store per financial year (today `TAX-YYYYMMDD-####` built from the UTC date, so a sale after midnight IST but before 05:30 gets yesterday's date).
- Delivery: print, download, e-mail (PDF attached), SMS/WhatsApp link later.

---

## 6. Phases

Sizes are relative: S ≈ 1–2 days, M ≈ 3–5, L ≈ 1–2 weeks.

### Phase 0: confirm and baseline (S)
- Answer D1–D8.
- Rebuild Docker, run `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter api test:e2e` on your machine to get a green baseline (the status docs say several of these were never run).
- **Fix now:** block a sale line with no price instead of selling it at ₹0.
- Acceptance: green baseline recorded in `docs/`; a variant with no price cannot be added or sold.

### Phase 1: pricing engine and Pricing screens (L)
- `PriceRule` table and resolver; ignore legacy store-only price rows (report them first).
- Apply promotions and coupons in `quoteSale`/`completeSale`; extend `Promotion`; increment usage inside the sale transaction.
- Discount reason codes; per-role limits; line and order discount in % and ₹.
- Open-price items with floor price and manager PIN.
- Quote breakdown and freeze (`quoteId`).
- Navigation: add the Pricing & Promotions pages (the redesign notes say they are not in the nav because the pages do not exist).
- Acceptance: unit tests show the same total in quote, saved sale and invoice to the paisa for inclusive and exclusive prices with a rule, a coupon, a manual discount and a charge; expired coupon, used-up coupon and two clashing promotions behave as W2 says.

### Phase 2: B2B and tax identity (M)
- Schema: store tax number; customer tax/billing fields.
- GSTIN validation; place of supply; IGST path; HSN summary.
- Customer screen and POS quick-create capture the tax number for business customers.
- Acceptance: an intra-state B2B invoice shows CGST+SGST and the buyer's GSTIN; an inter-state one shows IGST only; invalid GSTIN is rejected with a clear message.

### Phase 3: adding items and catalogue (M)
- Section 5.3 and 5.4 work.
- Acceptance: scan 3 items and pick 2 from tiles in one bill; tiles show this store's real top sellers; searching a product outside the first 100 finds it; two items sharing a barcode ask which one; a weighed item takes 0.350; a held sale older than the limit shows as expired.

### Phase 4: payment (L)
- `PaymentAttempt`, payment methods per store, wallet/points tender, N-way split, per-method register totals.
- Provider interface + first online adapter (D2), webhook endpoint, pending/unknown handling, void/refund job for capture-then-save-failure, reconciliation sweep.
- Acceptance: simulated declined payment lets the cashier switch method; simulated timeout cannot be retried until the status is resolved; a forced save failure after capture is automatically reversed and alerted; closing the register shows expected cash, card and UPI separately.

### Phase 5: invoice (M)
- Section 5.6 work.
- Acceptance: reprint after changing the organisation address is byte-for-byte equal in content to the original; ₹ shows; thermal and A4 both open; e-mail delivers the PDF; invoice numbers are gap-free per store per financial year.

### Phase 6 (optional): selling with no internet (L+)
Only if D1 is (b). Outline: service worker and IndexedDB for catalogue/price snapshot and a queue of unsent sales; invoice numbers reserved in ranges per register; `clientSaleId` already makes re-sending safe; rules for price/stock changes made while offline; cash/UPI-manual only while offline; sync screen. The README and plan 3 currently list this as out of scope.

### Phase 7: verification (M, runs alongside)
- Unit: price engine (property tests for rounding), GST split, GSTIN validator.
- API e2e (needs PostgreSQL): promotions and usage limits under concurrency, payment states, invoice snapshot.
- Playwright: full day: open register, scan + tiles, coupon, B2B customer, split payment, invoice download, close register.
- Accessibility and 80 mm print check by eye.

---

## 7. Data changes (summary)

| Table | Change |
|---|---|
| `price_rules` | new |
| `promotions` | add scope, auto-apply, priority, stackable, per-customer limit |
| `product_variants` | add open-price flag, floor price |
| `discount_reasons` | new |
| `stores` | add tax number |
| `customers` | add tax number, legal name, billing address, state code, is-business |
| `payment_attempts` | new |
| `sale_payments` | link to attempt, provider reference |
| `sales` | add document snapshot (JSON), quote hash |
| `held_sales` | add expires-at |
| `pinned_items` (or flag on `store_variants`) | new: manager-pinned quick keys |
| `document_sequences` | add financial-year dimension |

Each is an additive migration (0014 onward); no existing sale data is rewritten.

---

## 8. Risks

- **Existing data:** legacy store-only price rows and missing-price variants must be reported before the engine starts ignoring/blocking them.
- **Concurrency:** coupon usage limits and gap-free invoice numbers need row locking inside the sale transaction; both need a concurrency test.
- **Payments are money:** the online adapter needs a sandbox run and a manual reconciliation rehearsal before any real card is charged.
- **E-invoicing (IRN/QR):** not planned; large sellers may be legally required to use it.
- **Tooling:** `node_modules` are Windows builds, so lint/test/build must be run on your machine (as the status docs already note).

---

## Implementation status (13 Oct 2026)

**Built and tested (API, against real Postgres):** price rules (customer group, quantity tier, priority), coupons and automatic offers (limits, per-customer limit, stacking, atomic last-use claim), `quoteHash` / `PRICE_CHANGED`, open-price items with floor price and manager PIN, discount reasons, B2B customers with GSTIN validation, CGST/SGST vs IGST on the PDF, frozen invoice snapshot, `TAX-<FY>-<number>` invoice numbers, online payment attempts (captured / declined / no-reply / pending / void / idempotent replay / automatic reversal and alert), N-way split with wallet and points, enabled tenders, hold expiry, top-seller and pinned items, store GSTIN setting.
**Built, checked by type-check, lint, unit tests and a production build only (not clicked through in a browser):** till screen (coupon box, offer lines, price-changed prompt, open-price entry, online charge button, top-seller keys), Offers & price rules page, business-customer fields, store GSTIN field.
**Not built:** real payment gateway and webhooks (a sandbox provider stands in), e-mail/SMS of the invoice, thermal-receipt layout, HSN summary on the invoice, per-role discount limits, offline queue when the network is down, wallet/points buttons and N-way split in the till screen, item-specific price rules in the admin screen (API supports them).
**Before use:** run `pnpm --filter api db:migrate` and `db:generate`, rebuild shared (`pnpm --filter @pos/shared build`) and the Docker images.

---

## Follow-up: organisation currency, product types, store billing (13 Oct 2026)

**Built and tested (API, real Postgres):** organisation currency (default Omani rial, 3 decimals; also AED, SAR, QAR, KWD, BHD, INR, USD, EUR, GBP) used by prices, offers, receipts and the invoice PDF; locked after the first sale. Product types (org-only): allowed categories/brands, required category/brand/barcode/tax group, extra typed fields. Store billing overrides (payment methods, cash rounding, discount reason, hold lifetime, point value, receipt footer) over organisation defaults; quote tells the till which tenders to show. Tests: `apps/api/test/plan7-currency-types-billing.e2e-spec.ts` (9), currency unit test; full e2e 74/78 pass, the 4 failures (plan2, plan3, plan4, plan5) fail the same way without these changes.
**Built, checked by type-check, build, unit test and lint only (not clicked through in a browser):** Organisation settings → General (currency), Billing & receipts (defaults), Catalogue → Product types page, type picker and extra fields on new/edit product, Store settings → Billing with "Set for this store" switches, till tender buttons, all money inputs/labels now follow the organisation currency.
**Known limits:** currency is process-wide in the web app (one organisation per deployment); products created in stores or imported by CSV do not use types; existing amounts are read as the new default currency's smallest unit (old rupee prices appear as OMR with 3 decimals unless the org sets INR); remaining India wording: invoice FY label, default time zone, GST names in reports and tax groups, GSTIN fields.
**Before use:** `pnpm --filter api db:migrate` (0015) and `db:generate`, `pnpm --filter @pos/shared build`, rebuild Docker images. If the organisation already trades in rupees, set the currency to INR before the next sale.
