# Plan 5: store catalogue, POS, registers, pricing and invoice fixes

Status: PLAN ONLY, nothing implemented yet. Written 11 Oct 2026 from a read of the code and the 5 screenshots.

## What I found (root causes, by issue)

| # | Issue | Cause in the code |
|---|---|---|
| 1 | "New product" sheet will not scroll | `components/ui/sheet.tsx`: `SheetContent` is `fixed inset-y-0 flex-col` with no `overflow-y-auto`, so anything taller than the screen is cut off. It is also `max-w-md` while the variants table needs `min-w-[620px]`. |
| 2 | Filters look bad | `ProductsTable` (`features/tables.tsx`) puts 4 full-width selects + a store select in one toolbar next to the search box, and the "Columns" button is pushed under the page. Brand filters by name, status list has unused values, store picker is an auto-submitting form. |
| 3 | Store Products page crashes ("This page failed to load") | `s/[storeId]/products/page.tsx` awaits `api.storePending()` with no catch. That endpoint needs `store-catalog.verify`, so any viewer without it (e.g. an organisation admin opening a store) throws and the whole page dies. Same pattern in the POS page. Needs the real server log to confirm (step 0). |
| 4 | POS crashes ("This page couldn't load", ERROR 1485022898) | `(pos)/s/[storeId]/pos/page.tsx` fires 4 calls in one `Promise.all` with no catch: catalogue search, categories, registers, customers. `customers` needs `customer.view`; any 403 or API error takes the whole screen down. Registers page works, so it is not the registers call. Also the running containers may be stale (see `docs/redesign-status.md`). |
| 5 | Org to store: "pending" flow and categories/brands | Dispatch already creates `PENDING_VERIFICATION` store variants, but (a) the org "New product > Sell in stores" checkboxes bypass pending and make the item ACTIVE straight away; (b) the pending list is hidden unless you hold `store-catalog.verify`; (c) there are no store-level Categories/Brands views: store categories are only derived inside the POS tab list, and brands are not shown at all. |
| 6 | Registers UX is confusing | One form with every field always visible (open, cash in/out, blind count, "denominations in paise:count") and buttons that stay disabled with no explanation. Nothing says what a register or a session is. |
| 7 | Price / tax / charges rules unclear | Org sets `VariantPrice` (org-wide) and tax group on the variant; stores can add their own `VariantPrice(storeId)` (`updateStoreProduct`, `assignStoreProducts`) and a `StoreVariant.taxGroupId`. Worse, the sale engine ignores the store tax override (it reads `variant.taxGroup`), and the POS screen always treats price as tax-inclusive while the server honours `includesTax`, so the cart total can differ from the invoice. |
| 8 | No PDF invoice | Receipts only use `window.print()`. No PDF library is installed in `apps/api` or `apps/web`. |
| 9 | Adding items to a bill | Barcode works only through a timing heuristic on the search box (80 ms between keys), only against the first 100 products the page loaded (`take: 100`), and "Quick keys" shows everything. No explicit "browse list" picker. |
| 10 | POS vs Register | Not explained anywhere in the UI. See "Concepts" below. |

## Concepts (to be added as in-app help text)

- **Register** = a physical till / cash drawer (e.g. "Front Till"). Set up once per store.
- **Register session** = one shift on that till: opened with a float, closed with a cash count. Only one open session per register. Every sale must belong to an open session so cash can be reconciled.
- **POS** = the selling screen cashiers use all day. It needs an open session to take payment.
- **Registers page** = the manager's control room: open/close tills, record cash in/out, see expected vs counted cash.

## Phases

### Phase 0: diagnose before changing anything
- Run `docker compose build web api && docker compose up -d`, `pnpm --filter api db:migrate` (migrations 0011 and 0012 must be applied).
- Reproduce items 3 and 4 and read `docker compose logs web api` for the real exception behind the error digests. Record the findings at the top of this file.
- Acceptance: each crash has a named cause; no guessing.

### Phase 1: stop the crashes (items 3, 4)
- Store Products and POS pages: wrap each secondary call (pending, tax groups, brands, categories, customers) so a 403/failed call degrades to an empty section with a small inline notice instead of killing the page.
- Gate each call by the permission the viewer actually has (only call `storePending` when they hold `store-catalog.verify`; only load customers if `customer.view`).
- Make sure the Organisation Admin role carries the store-scoped permissions it needs when it opens a store.
- Add a section-level error boundary so one widget cannot blank a page.
- Acceptance: org admin, store manager and cashier can all open Store Products and POS with no error page.

### Phase 2: forms and filters (items 1, 2)
- `SheetContent`: scrollable body, sticky header and footer (Cancel / Create always visible), `size` prop (md / lg / xl). New product uses xl.
- New product form: price entered in rupees (not paise), tidy variant table, store picker moved into the pending flow (see Phase 4), validation messages inline.
- Filters redesign: search on the left; a single "Filters" popover (category, brand, status, tax group) with active-filter chips and "Clear all"; store selector moves to the page header; Columns button stays visible; works at phone width. Brand filter uses `brandId`.
- Acceptance: form scrolls on a 768px-high window; filter bar is one row on desktop and stacks cleanly on mobile.

### Phase 3: price, tax and charges (item 7). Do before Phases 5 and 6
Confirmed rules:
- **Base price is always one organisation-wide value.** If the organisation adds it, that is the price. If a store adds a product with a base price, that price is saved as the organisation base price too (never a store-only price). After creation only the organisation catalogue edits it; stores see it read-only ("Set by organisation").
- **Tax groups and additional charges can be added by both the organisation and stores.** Organisation-level ones are defaults available to every store. Store-level ones apply only in that store (other stores do not see them).
- Resolution at sale time: store tax group for the product, else the organisation's, else 0%. Charges = organisation charges that apply + that store's charges.

Work:
- Remove store-only price writes (`VariantPrice.storeId`) in `updateStoreProduct`, `assignStoreProducts` and `createStoreProduct`; a store-entered price creates the org price (`storeId = null`). Old store-price rows stay readable but are ignored; produce a report of affected variants first.
- Tax groups: add `storeId` (nullable) to `TaxGroup`; org screens list org groups, store screens list org + own groups and can add new ones. Store picks a group per product (`StoreVariant.taxGroupId`). Fix the sale engine and catalogue search, which currently read only the org group.
- Additional charges (new table `Charge`, nullable `storeId`): name, flat or percent, applies per product or per bill, optional tax group. UI in org Settings and store Settings. Charge lines stored on the sale and shown on the cart and invoice.
- One shared server function returns unit price, tax rule, charges, tax and totals for catalogue search, POS cart preview, sale creation and invoice. Remove client-side tax maths from `pos-screen.tsx`.
- Permissions: store managers may add tax groups and charges for their store but cannot edit the base price.
- Acceptance: unit test shows POS preview, saved sale and invoice agree to the paisa for inclusive and exclusive prices, with a store tax group and with charges. A store-created product price shows up as the org price.

### Phase 4: org to store flow, pending, categories, brands (item 5)
- Org "Sell in stores" and the Distributions page both create a distribution that lands in the store as **Pending**. No more silent direct assign.
- Store Products page: a clear "Pending from organisation" panel visible to anyone who may verify, with an **Add to store** button (and Reject). Replace the confusing wording.
- On Add: the product becomes ACTIVE and its category and brand become visible in that store automatically (derived from the store's active products, so nothing to duplicate).
- New store pages **Categories** and **Brands** (read-only, derived), brand filter on store products, brand + category used in POS tabs and search.
- Acceptance: send a new product from the org to Luck, see it pending, add it, see its category and brand listed in Luck, and sell it in POS.

### Phase 5: billing, two ways to add items (item 9)
- Scan: dedicated scan field, always focused, accepts scanner "Enter" (no timing heuristic). Exact barcode lookup calls the API (`/catalog/search?q=`), so any store product is found, not just the first 100. Sound / flash on add, clear "barcode not found" message, repeat scan increments the quantity.
- List: "Add item" opens a searchable picker (category and brand filters, stock shown, tap to add), plus the existing tiles.
- Both paths feed the same cart. Stock and "out of stock" rules unchanged.
- Acceptance: scan 3 products and pick 2 from the list in one bill; totals match the server.

### Phase 6: PDF invoice (item 8)
- API: `GET /pos/v1/sales/:id/invoice.pdf` (permission `sale.create` or report view), generated server-side with `pdfkit` (or `pdf-lib`). GST tax invoice: store and organisation details, invoice number, date, customer, line items with HSN, rate, taxable value, CGST/SGST split, totals in words, payment mode, footer from receipt settings.
- Web: after "Complete sale" show a success dialog with **Download invoice (PDF)**, **Print 80 mm** and **New sale**; add "Download PDF" on the sale detail page and the sales list. Keep browser print as a fallback.
- Acceptance: PDF opens, numbers equal the sale, credit notes get the same treatment later.

### Phase 7: Registers UX (items 6, 10)
- Registers page becomes one card per register with a status badge and only the actions valid for its state: Closed shows **Open register** (float); Open shows **Cash in / Cash out** and **Close register**.
- Close flow: a short wizard with a denomination counter (₹2000, 500, 200, 100, 50, 20, 10 rows, no "paise:count" text) or a single counted total, then a variance summary.
- A "How registers work" panel using the Concepts above; POS shows a banner "Till closed: open a register to start selling" with a direct button.
- Acceptance: a new cashier can open a till, sell, record a drop and close with a count without help.

### Phase 8: verification
- Unit tests: price/tax calculator, filter logic, barcode lookup.
- API e2e (needs PostgreSQL): distribution to pending to add to store, store price write blocked, invoice endpoint returns a PDF.
- Playwright: org creates product and sends to store, store adds it, cashier opens till, scans + picks, completes, downloads invoice.
- Run `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter api test:e2e && pnpm build`, then rebuild Docker and walk the flow in the browser.

## Decisions I assumed (change me if wrong)
1. CONFIRMED: base price is org-wide (a store-entered price becomes the org price); org and stores can both add tax groups and additional charges. Assumption: charges can be flat or percent, per product or per bill.
2. CONFIRMED: org "Sell in stores" always goes through Pending at the store. (Alternative: org can force-add directly.)
3. CONFIRMED: store-created products: the store manager enters a price once at creation and it becomes the organisation base price; after that it is org-controlled.
4. CONFIRMED: invoice is a GST tax invoice A4 PDF, with an 80 mm receipt layout available later.

## Risks
- Existing store-level prices and tax overrides in the database: Phase 3 keeps old rows but ignores them; a one-off report of affected variants is needed before switching off.
- The two crashes are not yet confirmed from logs (Phase 0).
- node_modules in the repo are Windows builds, so lint/test/build must run on your machine, not here.
