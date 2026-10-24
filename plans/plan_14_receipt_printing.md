# Plan 14 — Print the receipt straight from the till after "Complete sale"

Status: **Phases 1–3 implemented 22 Oct 2026** (Phase 4, direct ESC/POS printing, not started). Originally written from the code at commit `aa2ffad` and the screenshot of the "Take payment" dialog on http://3.237.177.106:3100/s/<storeId>/pos (DELT Store 2, OMR).

### Implementation notes (22 Oct 2026)
- **API:** `GET /pos/v1/sales/:id/receipt` and `POST /pos/v1/sales/:id/printed`. The invoice PDF and the receipt share `saleDocument()` in `pos.service.ts`. Migration `0029_receipt_printing` adds `sales.print_count` and `sales.last_printed_at`. New billing keys: `receiptHeader` (frozen in the sale snapshot), `receiptPaper`, `receiptAutoPrint`, `receiptCopies`, `receiptLanguage`, `receiptShowTaxBreakdown`. The checkout config returns `receipt: { autoPrint, paper, copies }`.
- **Web:** the receipt is a self-contained HTML document built by `features/sales/receipt-html.ts` and printed from a hidden iframe by `features/sales/print-receipt.ts`. There is no separate print route. `@page { size: 80mm auto }` is not valid CSS (Chrome falls back to Letter), so `fitRollPage()` measures the receipt and sets the exact roll length before printing.
- **Till:** a "Print receipt" switch in the payment dialog ("Complete & print"), auto-print after the server confirms the sale, and Print/Reprint with a status line on "Sale complete". Pending offline sales never print a tax receipt.
- **Not done from Plan 2/3:** store logo and QR code (there is no logo storage yet); the per-device paper override. The A4 option prints the receipt layout on A4; the full A4 tax invoice is still the PDF.
- **Tests:** `apps/api/test/plan14-receipt-printing.e2e-spec.ts` (6) and `apps/web/lib/__tests__/receipt-html.test.ts` (7).

**Goal:** when the cashier has filled in the payment dialog (tender, reference, coupon, customer, discount, split, bill handler), they press one button and the receipt comes out of the counter printer. They can reprint later. A failed print never blocks or undoes the sale.

---

## Part 1 — How real POS systems do this

### 1.1 The flow cashiers expect
Square, Shopify POS, Lightspeed, Odoo POS, Loyverse and Zoho POS all follow the same order:

1. The cashier fills in the payment screen and presses **Pay / Complete / Validate**.
2. The **server confirms the sale first**: receipt number, final totals, tax and change. You never print before that, because the receipt must show the real invoice number and the server's figures.
3. A **receipt screen** opens showing "Change due", with **Print · Email · SMS/WhatsApp · No receipt** and **New sale**.
4. If the device has **auto-print** on (the default for counter tills), the receipt prints at once, with no dialog, and the cash drawer opens.
5. If the printer fails (out of paper, offline), the sale **stays completed**. The cashier presses **Reprint** on the receipt screen or later from sales history. Reprints are marked **"DUPLICATE / REPRINT"** and counted in the audit log.

### 1.2 The printers
| Printer | Used for | How it connects |
|---|---|---|
| **80 mm thermal** (Epson TM-T20/T82/m30, Star TSP100/143, Xprinter, Rongta) | Counter receipt — by far the most common | USB, LAN (Ethernet/Wi-Fi), Bluetooth |
| 58 mm thermal | Small shops, handheld/mobile printers | Bluetooth, USB |
| A4 laser/inkjet | Full tax invoice for business customers | OS printer |

Thermal printers speak **ESC/POS** (Epson's command language; most cheap clones copy it). Star printers use StarPRNT but most also run in ESC/POS mode. The **cash drawer** plugs into the printer's RJ11 port and opens when the printer receives a "drawer kick" command.

### 1.3 The four ways a web POS reaches the printer
Your POS is a browser app (Next.js), so these are the real options:

| # | Method | Silent (no dialog)? | Cuts paper / opens drawer? | Setup per till | Who uses it |
|---|---|---|---|---|---|
| A | **Browser print** — open a receipt page formatted for 80 mm (`@page { size: 80mm auto }`) and call `print()` | Only if Chrome runs with `--kiosk-printing`; otherwise the print dialog shows (Enter prints) | Cut: usually yes (driver setting). Drawer: only via the Windows driver option "open drawer before/after print" | Install the printer's Windows/macOS driver, set it as the default printer | Odoo (default), Zoho, most web POS v1 |
| B | **Local print bridge** — a small app on the till PC (QZ Tray, PrintNode, Odoo IoT Box, or your own agent) receives raw ESC/POS from the browser over a local WebSocket | Yes | Yes | Install the bridge once, trust a certificate | Odoo IoT, many SaaS POS |
| C | **Printer's own web API** — Epson ePOS-Print (TM-m30, TM-T88VI…) and Star WebPRNT accept print jobs over HTTP(S) directly from the browser | Yes | Yes | Printer on the LAN with a fixed IP; on an HTTPS site the printer needs HTTPS too | Shopify POS web, Lightspeed, many in Gulf retail |
| D | **WebUSB / Web Serial / Web Bluetooth** — the browser talks to the USB printer itself | Yes after a one-time permission | Yes | Chrome/Edge only; on Windows the vendor driver must be swapped (Zadig) for WebUSB | Small/hobby POS — fragile |

**What everyone does:** ship **A** first, because it works with any printer and no install. Add **B or C** for stores that want silent printing, a paper cut and the cash drawer.

### 1.4 What goes on the receipt
Header: logo, store name, address, phone, **VAT/tax number**. Then the receipt number, date and time (store timezone), register, cashier / bill handler, and customer if one is attached. Then the lines (name, qty × price, line discount, line total), subtotal, bill discount / coupon, charges, the **tax breakdown per rate**, rounding and **TOTAL**. Then each payment (tender, reference, amount), cash tendered and **change**. Then the footer text, an optional QR code (e-invoice / receipt lookup link), "Thank you", and **"REPRINT"** when it is not the first print.

**Arabic matters for you (Oman):** cheap ESC/POS printers often have no usable Arabic code page and do not shape or order RTL text. Real systems handle this in one of two ways. Browser print (A) avoids the problem because the browser renders the text. Direct ESC/POS (B/C/D) renders the receipt **as an image (raster)** and sends that.

---

## Part 2 — What your code does today (confirmed in source)

| Area | Today |
|---|---|
| Payment dialog (`apps/web/features/pos/pos-screen.tsx:544`) | All fields from the screenshot. Footer has only **Cancel** and **Complete sale** → `complete()`. |
| `complete()` (`pos-screen.tsx:404-468`) | `POST /pos/v1/sales`. On success `setDone({ id, receiptNumber, totalCents, changeCents })` (`:442`), clears the cart and closes the dialog. On network loss, cash sales are queued as **pending** (`:460`). |
| "Sale complete" dialog (`pos-screen.tsx:546`) | Shows the total and change, **Download invoice (PDF)** and **New sale**. **No print button.** |
| Invoice PDF (`apps/api/src/pos/invoice-pdf.ts`, `GET /pos/v1/sales/:id/invoice.pdf` at `pos.controller.ts:220`) | Hand-written, dependency-free **A4 only**. Standard Helvetica, so **no Arabic**. Built from `Sale.documentSnapshot` (frozen seller/buyer/footer), so reprints match the original. |
| Sales history detail (`app/(app)/s/[storeId]/sales/[id]/page.tsx` + `features/sales/print-actions.tsx`) | A **"Print 80 mm"** button that runs `window.print()` on the **whole app page** (cards, layout, sidebar hidden by `print:hidden`). It is not laid out as a receipt and has no store header or tax breakdown. |
| Print CSS (`apps/web/app/globals.css:218`) | `.print:hidden` and `.print-receipt` colour reset only. |
| Settings | Only `receiptFooter` (billing settings, org + store override, `api/src/common/billing-settings.ts`). No paper width, auto-print, logo or printer settings. |
| `Register` model (`schema.prisma:399`) | No printer configuration. |
| Audit | No record of prints or reprints. |
| Plan 6 notes | "thermal-receipt layout" listed as **Not built**; "Printer fails → sale already final, reprint from history" listed as the rule. |
| Site | Served over **HTTP** on an IP address. This matters for option C (mixed content) and for WebUSB (needs a secure context). |

**Gap:** there is no real receipt layout, no print action at the moment of sale, and no way to print without the browser dialog.

---

## Part 3 — Decisions to confirm before coding (★ = my recommendation)

1. **Button design in the payment dialog.** ★ Keep **Complete sale** and add a **"Print receipt" toggle** next to it. The toggle's default comes from the setting and the last choice is remembered on that device. The alternative, two buttons ("Complete sale" / "Complete & print"), is also fine but adds clutter on small screens.
2. **When printing happens.** ★ Only **after the server confirms the sale** (needs the receipt number and server totals). The print starts automatically from the "Sale complete" dialog, which also gets a **Print receipt / Reprint** button.
3. **Paper width.** ★ Store setting `receiptPaper`: `80mm` (default) | `58mm` | `A4`. An optional per-device override, since the printer belongs to the PC.
4. **Silent printing v1.** ★ Browser print (method A). Document the Chrome `--kiosk-printing` shortcut so counters get one-press silent printing with no install. Direct ESC/POS (method B or C) is **Phase 4, optional**.
5. **Pending (offline) sales.** ★ Do **not** print a tax receipt for a pending sale. Show "Receipt will be available after sync". Optionally print a "PROVISIONAL – NOT A TAX INVOICE" slip (off by default).
6. **Reprints.** ★ Allowed for anyone with `sale.view`. Second and later prints show **"REPRINT"** and are audited. A separate permission `sale.reprint` is not needed now.
7. **Language of the receipt.** ★ Store setting `receiptLanguage`: `en` | `ar` | `both` (bilingual labels such as "Total / الإجمالي"). Default `en`.
8. **Copies.** ★ `receiptCopies` 1–3 (default 1). For example, merchant copy for card sales.

---

## Phase 1 — Receipt data from the API (backend)

### 1.1 One receipt view-model shared by PDF and print
- In `pos.service.ts`, take the snapshot → `InvoiceData` mapping out of `invoicePdf()` (`:1475-1540`) into `private async buildDocumentData(context, saleId)`. `invoicePdf()` then calls it and `buildInvoicePdf(data)`. **No change to PDF output.**
- New `async receipt(context, saleId)` returns that data as JSON plus:
  - `tax breakdown per rate` (group lines by `taxRateBps`),
  - `payments` with tender, reference, amount, `changeCents`,
  - `printCount` (see 1.2), `isReprint = printCount > 0`,
  - `receiptSettings` resolved for the store (paper, language, copies, showLogo, showTaxBreakdown, showQr, footer),
  - `currency` (code + decimals) so the web formats exactly like the PDF.
- Permission: `sale.view` + `assertStoreAccess`, the same as the PDF.

### 1.2 Print tracking
- Migration `0029_receipt_printing`: `Sale.printCount Int @default(0) @map("print_count")` and `Sale.lastPrintedAt DateTime? @map("last_printed_at")`.
- `POST /pos/v1/sales/:saleId/printed` `{ copies, channel: "BROWSER" | "ESCPOS", reprint: boolean }` → increments `printCount` and writes the audit event `sale.receipt_printed` (actor, cashierId, register, copies, reprint).
- The browser calls it **after** `afterprint` fires (best effort; failures are ignored on the till).

### 1.3 Settings
- Add to `BILLING_KEYS` / `DEFAULT_BILLING_SETTINGS` (`common/billing-settings.ts`) with validation:
  `receiptPaper` (`80mm|58mm|A4`, default `80mm`), `receiptAutoPrint` (`ASK|ALWAYS|NEVER`, default `ASK`), `receiptCopies` (1–3), `receiptLanguage` (`en|ar|both`), `receiptShowLogo`, `receiptShowTaxBreakdown` (default true), `receiptShowQr` (default false), `receiptHeaderText` (≤ 200 chars).
- Store logo: reuse the org/store logo if one exists; otherwise add `Store.logoUrl` (optional, later).
- These are store-overridable like the other billing keys, so the existing "Set for this store" switch UI works for them.

### 1.4 Controller
- `GET  /pos/v1/sales/:saleId/receipt` → JSON (1.1)
- `POST /pos/v1/sales/:saleId/printed` → 204 (1.2)

**Exit criteria:** e2e test `apps/api/test/plan14-receipt.e2e-spec.ts`. The receipt JSON totals equal the sale totals and the PDF data. The tax breakdown sums to `taxCents`. After changing the org address, the receipt still shows the snapshot address. `printed` increments and audits. Another store's sale → 403/404.

---

## Phase 2 — The receipt page and the print action (web)

### 2.1 Receipt component
- `apps/web/features/sales/receipt.tsx`: a pure component `<Receipt data={…} paper="80mm|58mm|A4" />`.
  - Monospace-friendly layout, black only, widths 72 mm (80 mm paper printable area) / 48 mm (58 mm).
  - Uses `dir="rtl"` blocks for Arabic. Bilingual labels when `receiptLanguage = both`.
  - QR via a small library (for example `qrcode` → SVG) when `receiptShowQr`.
  - "REPRINT" banner when `isReprint`.
- `globals.css` print rules: `@page { size: 80mm auto; margin: 0 }`, hide everything except `.receipt-root`, `-webkit-print-color-adjust: exact`, page-break avoidance.

### 2.2 Print route without app chrome
- `apps/web/app/(print)/s/[storeId]/sales/[id]/receipt/page.tsx` in a new **`(print)` route group** with a bare layout (no sidebar, header, toaster). Server component loads `/pos/v1/sales/:id/receipt` through the existing proxy/session, calls `requirePermission("sale.view", storeId)` and renders `<Receipt>`.
- Query flags: `?autoprint=1&copies=N&paper=80mm`.

### 2.3 `printReceipt()` helper
`apps/web/features/sales/print-receipt.ts`:
1. Creates a **hidden iframe** pointing at the receipt route (same origin, so no popup blocker; the till screen stays put).
2. Waits for `load` and for fonts/images (`document.fonts.ready`, logo/QR loaded).
3. Calls `iframe.contentWindow.print()` `copies` times (or renders N copies with page breaks in one job, which is better: one dialog).
4. On `afterprint` → `POST …/printed`, removes the iframe.
5. Times out after ~15 s with a toast "Printer did not respond — use Reprint".

### 2.4 Replace the old "Print 80 mm"
- `features/sales/print-actions.tsx` uses `printReceipt()` instead of `window.print()` on the detail page. Keep the PDF download. Add "Print A4" (opens the existing PDF).

**Exit criteria:** opening `/s/<store>/sales/<id>/receipt` shows a clean 80 mm receipt. Chrome print preview at 80 mm fits on one strip with nothing cut off on the right. Arabic renders correctly. Reprint shows "REPRINT".

---

## Phase 3 — Print from the till (the feature in the screenshot)

### 3.1 Payment dialog (`pos-screen.tsx:544`)
- In the sticky footer, left of **Cancel / Complete sale**: a **"Print receipt"** checkbox/switch (printer icon).
  - Default: `receiptAutoPrint === "ALWAYS"` → on; `NEVER` → off and hidden; `ASK` → the last value saved on this device (`localStorage` key `pos.printReceipt.<storeId>`, wrapped in try/catch), else on.
- Optional keyboard: `P` toggles it while the dialog is open. **F12 → Enter** stays "pay and complete".

### 3.2 After success (`complete()`, `:436-443`)
- Store `printRequested` with `done`: `setDone({ …, print: printToggle })`.
- In a `useEffect` on `done`: if `done.print` → `printReceipt(storeId, done.id, { copies, paper })`.
- **Pending/offline branch (`:460`)**: never print. The "Sale complete" dialog says "Pending sync – receipt available after sync". When the pending sale syncs (`:374-378`), show a toast with a **Print** action.

### 3.3 "Sale complete" dialog (`:546`)
- Buttons: **Print receipt** (label becomes **Reprint** once printed) · **Download invoice (PDF)** · **New sale**.
- Show a small status line: "Printing…", "Sent to printer", or "Printer did not respond — Reprint".
- Keyboard: `Enter` = New sale, `R` = Reprint.
- Closing the dialog never cancels anything; the sale is already final.

### 3.4 Settings UI
- `features/settings/billing-form.tsx` → "Receipt" section: paper width, auto-print, copies, language, show logo / tax breakdown / QR, header text, footer (already there).
- Add a **"Print test receipt"** button that prints a sample receipt with the store header, so the store can check width and the cut without making a sale.
- `docs/admin-guide.md` + `docs/cashier-quick-card.md`: how to set the thermal printer as the default printer, paper 80 mm × receipt, "cut after page", "open drawer" in the driver, and the **Chrome kiosk-printing shortcut**:
  `chrome.exe --kiosk-printing --app=http://<server>/s/<storeId>/pos`, which prints to the default printer with no dialog.

**Exit criteria:** with the toggle on, Complete sale → receipt prints (one dialog, or none with kiosk printing) and shows the server receipt number, tender, reference and change. With the toggle off → nothing prints and Reprint works. Unplugged printer → sale still completed and Reprint works later. Pending sale → no tax receipt. Arabic store prints Arabic correctly. Playwright e2e: complete sale with print on → iframe loaded with `autoprint=1`, `/printed` called (stub `print`).

---

## Phase 4 (optional, later) — Silent printing, paper cut and cash drawer (ESC/POS)

Do this only if stores ask for no dialog without kiosk mode, or for the cash drawer to open from the POS.

- **Printer profile per register:** new table `RegisterPrinter { registerId, kind: BROWSER | EPSON_EPOS | STAR_WEBPRNT | QZ_TRAY, address, paper, openDrawer: boolean }`. Settings page under Registers.
- **Rendering:** one function draws the receipt to a canvas at 576 dots wide (80 mm @ 203 dpi) using the same `<Receipt>` layout (html-to-canvas or a canvas renderer). It is then sent as a **raster image**, which fixes Arabic. It adds `GS V` (cut) and `ESC p` (drawer kick).
- **Transports** (implement one first):
  - **Epson ePOS-Print SDK** (`epos-2.x.js`) → printer IP. Needs the printer to support ePOS (TM-m30, TM-T88VI/VII, TM-T82X-i…). When the site moves to HTTPS, the printer needs its own certificate.
  - **QZ Tray** on the till PC → any USB/LAN printer. Needs QZ's certificate signing (server endpoint to sign requests) and a QZ licence for production.
- **Fallback:** if the direct print fails, fall back to browser print automatically and show a toast.
- **Drawer:** open on CASH tenders only; also a "No sale / open drawer" button that is permission-gated and audited.

---

## Order of work and estimate
| Phase | Work | Size |
|---|---|---|
| 1 | API: shared document data, receipt JSON, print tracking + audit, settings keys, migration, e2e | ~1–1.5 days |
| 2 | Receipt component, `(print)` route, `printReceipt()` helper, CSS, replace old Print 80 mm | ~1.5 days |
| 3 | Till toggle, auto-print after sale, Reprint in Sale complete, pending handling, settings UI, test print, docs | ~1 day |
| 4 | ESC/POS direct printing (optional) | ~3–5 days per transport, plus hardware testing |

Phases 1–3 give the full "fill everything → Complete sale → receipt prints" flow with any printer.

## Risks and checks
- **Browser print dialog:** without `--kiosk-printing`, Chrome always shows the dialog (Enter confirms). Kiosk printing is the standard zero-cost fix. Say this plainly in the admin guide.
- **Printing from code after an `await`:** `iframe.contentWindow.print()` after the sale API returns works in Chrome/Edge. Safari may ignore it without a click. The **Print receipt** button in the Sale complete dialog is the click-based fallback. Test on the actual till browser.
- **80 mm driver margins:** some drivers default to an A4/Letter page and shrink the receipt. The test-print button and the admin guide cover setting the paper size.
- **Totals must match the PDF:** both come from the same `buildDocumentData()`. Add a test comparing them.
- **Reprint after edits:** use `documentSnapshot` only, never live store/org data (same rule as plan 6).
- **Security:** the receipt route and `/printed` check `sale.view` and store access. No public receipt URLs in v1. A QR lookup link, if added, needs a signed token.

## Verification gate
- `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
- API e2e `plan14-receipt.e2e-spec.ts` passes on real Postgres
- Web e2e: complete sale with print on/off, reprint, pending sale
- **By hand on a real 80 mm thermal printer** (Windows + Chrome): normal print, kiosk-print, unplugged printer, Arabic receipt, 2 copies, reprint banner, test print from settings
