# Plan 12 — Broken pages, Oman defaults, product fields and catalogue structure

Status: plan only, nothing implemented. Written 17 Oct 2026 from the code at commit `4070f7e` and the screenshots of the deployed app (http://3.237.177.106:3100).

Do the phases in order. Phase 0 is a hotfix and can ship alone.

---

## Phase 0 — Pages that fail to load (hotfix)

### 0.1 Store overview, Org "Reports & analytics" and four detail pages
**Root cause (confirmed in code):** commit `b784a6f` ("Add Arabic locale and RTL support") changed `Money` in `apps/web/components/data/primitives.tsx` to call `useLocale()`. That file has no `"use client"`. When a **server** page renders `<Money>`, React's server build has no context, so the render throws. Because the error is the same every time, both organisations show the same reference `1862288343`.

Pages that render `<Money>` from a server component, so they all break:
- `/s/[storeId]` (Store overview)
- `/org/reports`
- `/org/catalog/products/[id]`: this is why clicking a product in the catalogue fails
- `/org/customers/[id]`
- `/s/[storeId]/sales/[id]`
- `/s/[storeId]/registers/[sessionId]`
- `/dev/ui`

**Fix**
1. Move `Money` into its own file, `components/data/money.tsx`, marked `"use client"`. Re-export it from `primitives.tsx` so existing imports keep working. `KpiTile`, `StatusBadge`, `ErrorState` and the rest stay server-safe.
2. Don't add `"use client"` to the whole of `primitives.tsx`. `KpiTile` takes an `icon` component prop, and a server component can't pass a function to a client component, so that would create a new error.

### 0.2 Store reports (reference `962189492`)
**Root cause:** the same mistake in `components/ui/button.tsx`. `Button` calls `useTranslate()` with no `"use client"`. The reports page renders `<Button>Apply filters</Button>` on the server. `/dev/ui` does the same.

**Fix:** split the file. Put `buttonVariants` (a plain function that server pages use for `<Link className=…>`) in `components/ui/button-variants.ts` with no directive. Make `button.tsx` `"use client"` and have it import the variants. Don't just add `"use client"` to `button.tsx`: then `buttonVariants()` becomes a client reference and every server page that styles a link with it breaks.

### 0.3 Point of sale: "This page couldn't load"
**Root cause (very likely; confirm with the browser console):** `features/pos/pos-screen.tsx:154` calls `crypto.randomUUID()` during the first render (`useRef(crypto.randomUUID())`). Browsers only provide `crypto.randomUUID` on **secure origins** (HTTPS or localhost). The app runs on plain `http://3.237.177.106`, so the call throws in the browser. Server rendering works, because Node has the function, but the page crashes during hydration. The `(pos)` route group has no `error.tsx`, so Next.js shows its bare root error screen.
`features/registers/register-actions.tsx:137` (cash in/out) fails the same way on HTTP.

**Fix**
1. Add `lib/uuid.ts`. It uses `crypto.randomUUID` when available and otherwise builds a v4 UUID from `crypto.getRandomValues`, which works on HTTP too. Replace the four call sites. Create the ref lazily: `useRef<string>()`, filled in on first use.
2. Add `app/(pos)/s/[storeId]/pos/error.tsx` and `app/global-error.tsx`, showing the reference and a "Back to store" link.
3. **Infrastructure (strongly recommended):** serve the app over HTTPS with a domain, using Caddy or Nginx with Let's Encrypt in front of port 3100. Plain HTTP also means the session cookie can't be `Secure`, and camera barcode scanning, the clipboard and other secure-context APIs won't work. Then set `POS_WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` to the HTTPS address.

### 0.4 Confirm on the server before and after the fix
- `docker logs deltcrm_pos_web 2>&1 | grep -iE "error|digest|\[api\]"`: the digest lines show the exact message for each reference.
- Open the POS page with DevTools → Console and look for `crypto.randomUUID is not a function`.

### 0.5 Stop it from coming back
- Add a unit test (or an ESLint `no-restricted-syntax` rule) that fails when a file without `"use client"` calls `use[A-Z]…()` hooks. A grep over `components/ features/ app/ lib/` found only these two files today.
- Extend `apps/web/e2e/plan1-routes.mjs` to open **every** route, including the detail pages above, as org admin, store manager and cashier, against a plain-HTTP origin. It should fail on any error screen. Run it in CI.

---

## Phase 1 — Oman as the default market, Omani address format

### 1.1 Where "India" comes from today
| Place | Current value |
|---|---|
| `apps/api/prisma/schema.prisma` Organization | `countryCode @default("IN")`, `currency @default("INR")`, `timezone @default("Asia/Kolkata")` |
| schema Store / VariantPrice | `timezone @default("Asia/Kolkata")`, `currency @default("INR")` |
| `apps/api/src/auth/auth.service.ts:125` | sign-up creates the organisation with `countryCode: 'IN', currency: 'INR'` |
| `apps/api/src/admin/admin.service.ts:593, 1507` | store time-zone fallback `'Asia/Kolkata'` |
| `packages/shared/src/markets.ts` | India listed first; "Other" falls back to INR |
| `apps/web/lib/format.ts` | number/date locale is `en-IN` |
| `app/(app)/s/[storeId]/page.tsx` | time-zone fallback `Asia/Kolkata` |
| `packages/shared/src/fiscal.ts` | Indian April–March financial year |
| Reports, onboarding, receipts | GST / GSTIN / HSN wording |

### 1.2 Changes
- Default to **Oman / OMR / Asia/Muscat** everywhere above. Migration `0022_oman_defaults` changes only the column defaults and leaves existing rows alone. For the current test organisations ("Store 1", "North") that are already saved as India, give a one-off admin action or SQL script rather than a silent rewrite.
- `MARKETS`: list Oman first, then the other GCC countries, then the rest. India stays as an option. "Other" falls back to OMR.
- Formatting locale: `en-GB` for English and `ar-OM` for Arabic, not `en-IN`. The 3-decimal OMR handling already exists in `packages/shared/src/currency.ts`.
- Country-aware tax wording and validation (new `packages/shared/src/tax-profile.ts`):
  - India: GST / GSTIN (current behaviour), HSN, April–March year.
  - Oman: **VAT 5%**, VAT number `OM` + 10 characters (e.g. `OM1100012379`), "HS code" instead of HSN, "VAT summary" instead of "GST summary", January–December financial year.
- Phone: `+968` followed by 8 digits.

### 1.3 Omani address fields (store and organisation)
Oman's national addressing standard uses: building/unit number, street (Way), sub-unit (flat/shop), area, administrative area (wilayat, governorate), an optional post code, and country. Post codes are 3 digits and optional. P.O. Boxes are still widely used, and so are landmarks.

Proposed form when the country is Oman:
| Field | Required | Notes |
|---|---|---|
| Governorate | yes | Select from the 11: Muscat, Dhofar, Musandam, Al Buraimi, Ad Dakhiliyah, Al Batinah North, Al Batinah South, Ash Sharqiyah North, Ash Sharqiyah South, Ad Dhahirah, Al Wusta |
| Wilayat | yes | Select filtered by governorate (about 63 wilayats, English and Arabic names in the shared package) |
| Area / locality | yes | e.g. Al Khuwair, Ruwi |
| Way / street | no | e.g. "Way 3015" or a street name |
| Building / house no. | no | |
| Unit / shop / floor | no | |
| Landmark | no | e.g. "Near Lulu Hypermarket" |
| P.O. Box | no | digits |
| Postal code | no | exactly 3 digits |
| Map location | no | optional lat/long or a Google Maps link |

Implementation:
- `packages/shared/src/address-formats.ts` holds a per-country field definition (labels in English and Arabic, required flags, validators) plus the Oman governorate → wilayat data. The onboarding step, store profile and organisation settings forms all render from it, so India keeps its current form (street, city, state, 6-digit PIN).
- Database: add nullable columns to `stores` and `organizations`: `governorate`, `wilayat`, `area`, `way`, `building`, `unit`, `landmark`, `po_box`. Keep `postal_code` and `address`. Keep `address` as the composed one-line address for receipts and invoices, built on the server from the parts. Map `city` → `wilayat` and `region` → `governorate` for Oman, so existing reports don't break.
- The API validates against the same shared definition.

---

## Phase 2 — Product fields chosen by the organisation; brand off by default

### 2.1 What exists
`apps/api/src/common/field-config.ts` already has standard fields that can be switched on and off (`CORE_PRODUCT_FIELDS`), plus organisation custom fields (text, number, date, yes/no, select). Only `name`, `sku` and `price` are locked. Every standard field, **brand included**, is on by default. SKU is already unique per organisation (`@@unique([organizationId, sku])`). Brand also appears as a fixed sidebar item in the store's **Stock** section.

### 2.2 Recommended field set
**Always required (locked, can't be switched off):**
1. Product name
2. **Category**: newly locked
3. **Product code (SKU)**: unique per organisation (already enforced); offer an auto-generate button such as `CAT-000123`
4. **Selling price**
5. **Tax rate / VAT group**: without it the till can't calculate VAT correctly. Default to "VAT 5%" for Oman.
6. Unit of measure: defaults to "pcs", so it costs the user nothing
7. Status (active/inactive)

**On by default, can be switched off:** barcode (unique, used for scanning), cost price (needed for the gross-margin report), description.

**Off by default, switched on by the organisation:** **brand**, product type and attributes, variants (size/colour), price includes tax, open price and floor price, Arabic name (useful for bilingual receipts in Oman), product image, expiry or batch number.

### 2.3 Changes
- `field-config.ts`: add `category` (and the tax group) to `LOCKED_CORE_FIELDS`. Remove `brand`, `productType`, `attributes`, `openPrice`, `floorPrice` and `includesTax` from the **default** `coreFields` for new organisations. Existing organisations keep their saved settings.
- Migration: assign products with no category to a new "Uncategorised" category, then make the API require `categoryId` on create, update and import (including `import-wizard` template validation).
- When brand is off: hide it in the new-product and edit forms, the products table columns and filters, the import template, the POS search placeholder ("Search name, SKU, brand or barcode") and the product detail. Don't delete stored brand data.
- Navigation: add `requiresField?: "brand"` to `NavItem` and filter it in `visibleNav` (`/api/me` must return the active product-field set). **Remove "Brands" from the store Stock section entirely** (see 3.2). On the organisation side, show Brands only inside Catalogue setup, and only when the field is on.
- Catalogue setup → **Product fields** screen in three groups: *Always required* (locked badges with a short reason), *Standard fields* (on/off and required toggles), *Custom fields* (the existing builder).

---

## Phase 3 — Catalogue structure and the product detail view

### 3.1 How established POS systems organise this
Lightspeed Retail, Square for Retail, Shopify POS and Odoo POS all follow the same pattern:
- One **Products/Items** area with sub-tabs: Items, Categories (a tree you manage), and optional extras that appear only when used (brands/vendors, attributes, units), plus Import.
- **Stock / Inventory** is separate: on-hand per location, adjustments, transfers, stock counts, purchase orders.
- Categories are a **management tree**: parent/child, product counts, click through to that category's products. They aren't a second product list.
- Custom attributes are defined once (text, number, selection, toggle) and filled in on each item.
- Clicking an item opens a **full detail view** with sections: overview, pricing, stock by location, variants, attributes, sales and stock history.

### 3.2 Changes for DeltPOS
**Organisation sidebar:** replace the three items "Product catalogue / Categories / Catalogue setup" with one **Catalogue** item. Its page has tabs: Products · Categories · (Brands, if on) · Units · Tax · Import · Setup.
- **Categories tab** becomes a real tree. The schema already supports `parentId`, so this is add sub-category, rename, move, deactivate, product count, and "View products" (opens the Products tab filtered by category). This is what makes it look different from the product list. Today both are flat tables built from the same `NamedTable`.

**Store sidebar → Stock:** keep only **Products** (what this store sells: price, tax, availability, quick keys) and **Inventory** (on hand, adjust, ledger, opening stock).
- Remove the store **Brands** and **Categories** pages. They're read-only lists derived from the products (`storeTaxonomy`) and look identical. Replace them with a category filter and a "by category" count summary at the top of the store Products page. Keep the old routes as redirects to `/s/[id]/products?category=…`.

### 3.3 Product detail (click a product → full details in a panel)
- One shared `ProductDetailSheet`: a right-hand panel on desktop, full screen on mobile. Use a Next.js **intercepting route** (`@modal/(.)products/[id]`), so the URL can be shared, browser Back closes it, and opening the link directly shows the full page.
- Opens from: the org Products table, store Products, Inventory rows, and an ⓘ button on POS product tiles (read-only there).
- Sections:
  1. **Header**: name (and Arabic name if on), SKU, status, category path, brand (only if on), image
  2. **Pricing**: organisation price, this store's price, VAT group and rate, inclusive/exclusive, cost and margin (permission `cost.view`)
  3. **Stock**: on hand, quarantine and reorder level for each store and stockroom (from `InventoryBalance`); at store level, this store first
  4. **Barcodes and variants**
  5. **Custom fields and type attributes**: only the fields the organisation has switched on
  6. **Activity**: the last 10 stock movements (ledger) and the last 10 sales lines, with links to the full ledger and sales lists
  7. **Actions**, by permission: Edit, Adjust stock, Print label, Deactivate
- API: add `GET /pos/v1/stores/:storeId/products/:variantId` (store view) and extend the existing organisation product detail (`api.product(id)`) with stock by location and recent activity, so the panel loads with one request.

---

## Phase 4 — Verification
- Unit tests: the UUID fallback, Oman address validation (3-digit post code, wilayat belongs to the governorate), VAT number format, locked core fields (category can't be switched off), brand hidden when off.
- API e2e: creating a product without a category fails; a duplicate SKU fails; sign-up defaults are OM, OMR and Asia/Muscat.
- Browser route smoke (0.5) in English and Arabic, over plain HTTP and HTTPS, for each role.
- Manual run: onboarding → first store with an Omani address → add a product → open its detail panel → sell it at the POS → store overview and reports show the sale.

## Decisions needed before implementing
1. Should the existing test organisations be switched to Oman, or recreated?
2. Is a domain available for HTTPS? This decides whether 0.3 step 3 is done now.
3. For existing organisations, should brand be switched off too, or only for new ones?
4. Should the tax group be locked as required alongside category, SKU and price (recommended)?

## Sources
- Oman National Addressing System, address elements: https://addressoman.avinet.no/standard:address-elements
- Oman address format, governorates and 3-digit post codes: https://www.geopostcodes.com/country/oman/address-format/
- Oman VAT number format and 5% rate: https://lookuptax.com/validate/oman/vat
- Square custom attributes: https://squareup.com/help/article/7168
- Secure-context requirement for `crypto.randomUUID`: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
