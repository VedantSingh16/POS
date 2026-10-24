# Plan 15 — Make the printed bill come out right on the real printer (paper size, printer setup, totals)

Status: **Phases A and D implemented 23 Oct 2026.** B, C, E and F not started. Written 23 Oct 2026 after the print preview of `TAX-2026-000001` (Golden Crust Al Hail). Builds on Plan 14 (receipt printing, implemented 22 Oct).

### Implementation notes (23 Oct 2026)
- **Phase A (totals):** `packages/shared/src/document-totals.ts` (`@pos/shared/document-totals`) builds the totals block for both the receipt (`receipt-html.ts`) and the invoice PDF (`invoice-pdf.ts`). Every row is derived from the stored total, so the block always adds up. Line amounts and totals use one basis: prices entered with VAT show "Items total (incl. VAT) … TOTAL, Total excl. VAT, VAT included"; prices entered before VAT show "Subtotal (excl. VAT), Bill discount, Charges, VAT, TOTAL". The VAT-by-rate summary now reflects whole-bill discounts. Line discounts are no longer subtracted a second time; the receipt shows them as "You saved", and the PDF shows them per line plus a "Line discounts" note. The receipt API returns `totals` (basis, rows, line amounts, saved). No stored sale data changed.
- **Phase D (printer setup per till):** migration `0030_register_printer_profile` adds `registers.printer_profile` (`{ paper, setupConfirmedAt, setupConfirmedBy }`). `GET/PATCH /pos/v1/registers/:id/printer` is allowed for `sale.create`, `registers.manage` or `store.settings.manage` on that store, and every change is audited as `register.printer_updated`. Choosing a different paper clears the confirmation. The checkout config returns `registerPrinters`. On the till there is a printer icon in the cart header, a "Receipt printer not set up on this till" notice with **Set up**, a setup dialog (printer type → Chrome checklist → test print → confirm, or fixes by symptom), and a link in "Sale complete" until the till is confirmed. Receipts use the register's paper, falling back to the store's. The A4 receipt layout is now 180 mm wide.
- **Also fixed:** the shared dialog (`components/ui/dialog.tsx`) was positioned off-screen in Arabic (`start-1/2` with a left shift); it now uses `left-1/2`.
- **Verified:**
  - API type-check and lint; 82 unit tests; 13 e2e tests (receipt printing, printer setup, your store/staff suite).
  - Web `pnpm typecheck`, lint, 45 unit tests (including the Arabic translation check).
  - A full till run in real Chromium with kiosk printing to PDF: the notice shows, setup and test print work, and confirming clears the notice. A sale printed with "Complete & print" came out as one 80 × 133 mm page with no header or URL. Arabic dialog checked by screenshot.

## 0. What the screenshot shows

| What you see | Meaning |
|---|---|
| The receipt is a small block in the middle of a full Letter/A4 page | The 80 mm page size was **not used**. Chrome printed on the destination printer's own paper and centred the receipt. |
| Date/time and receipt number at the top, the `localhost:3100/.../pos` URL and "1/1" at the bottom | Chrome's **Headers and footers** were printed. Chrome only draws these when the page has margins, so the CSS `margin: 0` was not used either. |
| Subtotal OMR 0.840 · Discount −2.760 · VAT 0.042 · TOTAL 0.882 | **Totals bug (ours):** 0.840 − 2.760 + 0.042 ≠ 0.882. The figure labelled "Subtotal" is already **after** the discount, but the discount is shown as if it still has to be taken off. |
| Line "1 × OMR 2.800 (−OMR 1.960) … OMR 0.882" | The unit price is **before** VAT but the line amount is **after** VAT. The line amounts don't add up to the subtotal either. |

### Root cause of the page size (tested, not guessed)
I tested the Plan 14 print code in a real (non-headless) Chromium 141 with kiosk printing and the "Save as PDF" destination:

- A normal page with `@page { size: 80mm 140mm }` → PDF page **80 × 140 mm**.
- The same page printed from a hidden iframe (the Plan 14 method) → **80 × 140 mm**.
- The real Plan 14 receipt (`printHtml(receiptHtml(...))`) → **80 × 143 mm**, one page, no header or footer.

So the code does request 80 mm, and Chrome applies it when the destination can print that size. In your preview the **destination printer only offers Letter/A4**, for example "Microsoft Print to PDF", a normal office printer, or a thermal printer whose driver is still on A4/Letter. The browser cannot create a paper size the printer driver doesn't offer. It falls back to the printer's paper and default margins, which brings back the header and footer. Microsoft's documentation for the paper-size policy says the same: if the chosen size isn't available on the printer, it is ignored.

**Conclusion:** printing from the browser is the right approach, but it is only correct when (1) the till prints to a printer whose driver offers roll paper, (2) our layout matches the paper that printer actually has, and (3) the till's print settings are fixed once. Today we only do part of (2) and none of (1) or (3). We also have the totals bug.

## 1. How other web POS / billing systems handle this

| System | How the bill is printed | Paper size handling | Setup they require |
|---|---|---|---|
| **Botble POS Pro** (web) | Browser print in a new tab, optional auto-print | Admin chooses **Receipt Width: 58 mm / 80 mm / A4**, and the layout follows it | Thermal printer as the OS default, margins "None", matching paper size in printer preferences. Network printing needs a separate print server. |
| **Oracle Customer Care & Billing** (web) | Browser print to an Epson TM receipt printer | Browser **Paper size: "Roll Paper 80 x 297 mm"**, and the same size in the Windows driver's Layout tab | Margins Minimum, **Headers and footers off**, Backgrounds off, Chrome Scale "Fit to page" |
| **Odoo POS** (web) | Browser print of an HTML receipt. IoT Box or Epson ePOS for direct printing. | Paper format is set in the printer driver | Forum fixes for this exact symptom: remove browser headers and footers, and set the printer's paper format |
| **ERPNext / Frappe POS** (web) | Browser print using per-document **Print Formats** (A4 invoice vs 80 mm POS receipt), or **raw printing through QZ Tray** | A separate print format for each paper. Raw printing bypasses the browser page entirely. | QZ Tray installed on the till. The printer is mapped to the print format on each computer. |
| Square, Shopify POS, Loyverse | Native apps with printer SDKs | The app knows the printer model and width | Pair the printer once |

Common patterns we should copy:
1. **The paper is a property of the till's printer**, chosen explicitly (58 / 80 / A4), and the layout follows it. A4 gets a real A4 invoice, never a tiny receipt in the middle of a sheet.
2. **A one-time printer setup on each till**, checked with a test print: destination, roll paper size, margins none, headers and footers off.
3. **Lock the settings** on counter PCs (kiosk printing, browser policies), or **skip the browser** with a local print bridge (QZ Tray, ePOS) for silent, exact printing.

## 2. Decisions to confirm (★ = recommendation)

1. **Where the paper choice lives.** ★ A **per-till printer profile** (paper 80 mm / 58 mm / A4, copies, "set up" yes/no), stored on the register (`Register.printerProfile`) so it follows the till and not the browser. The store setting from Plan 14 becomes the default for new tills.
2. **Paper chosen at print time.** ★ The Print button prints with the till's profile. A small arrow next to it offers "**Receipt 80 mm**" or "**A4 invoice**" for one-off cases, for example a business customer who wants an A4 tax invoice.
3. **The A4 layout.** ★ A4 prints a proper **A4 tax invoice** built from the same document data as the PDF (full width, table of lines, VAT summary). The 80 mm receipt is never centred on A4.
4. **How line amounts are shown.** ★ Follow the store's price mode: tax-exclusive stores show net amounts with VAT added at the bottom; tax-inclusive stores show VAT-inclusive amounts with "Prices include VAT". The rows must always add up.
5. **Direct printing.** ★ Plan it now as the recommended production option (Phase F), but ship A–E first, because they fix the problem with any printer.

## 3. Phases

### Phase A — Fix the totals on the receipt and the A4 invoice PDF (bug)
- `Sale.subtotalCents` is the **net** amount after line and bill discounts and before VAT (`pos.service.ts` stores `subtotal`, with `subtotal + lineDiscount` as the gross). Both `receipt-html.ts` and `invoice-pdf.ts` (`row('Subtotal…')` then `row('Discount')`) present it as if it were before discount.
- The new totals block on both documents:
  - **Items total** (gross, before discounts) = subtotal + discount
  - **Discount** −X (with a coupon or offer name when there is one)
  - **Subtotal excl. VAT** = net
  - Charges (if any), **VAT 5%**, Rounding, **TOTAL**
- Lines: `qty × unit price`, the discount, and an **amount in the same basis as the subtotal** (net excl. VAT for exclusive stores, i.e. `lineTotalCents − taxCents`; incl. VAT for inclusive stores). Check whether the price mode is stored per line (`priceIncludesTax`) or per store, and freeze it in the document snapshot if needed.
- Tests: a unit test that **every totals block adds up** (items total − discount + charges + VAT + rounding = total) for exclusive, inclusive, 100% line discount, coupon and charge cases. Also an e2e test using the screenshot's bill (2.800 with 70% off + 0.800 with 100% off → items 3.600, discount −2.760, subtotal 0.840, VAT 0.042, total 0.882).

### Phase B — Per-till printer profile and choosing the paper when printing
- Schema: `Register.printerProfile Json` = `{ paper: "80mm" | "58mm" | "A4", copies, setupConfirmedAt?, setupBy? }`. Migration plus validation like the billing keys.
- API: `GET/PATCH /pos/v1/registers/:id/printer` (permission `registers.manage` or `store.settings.manage`). The checkout config returns the open register's profile, falling back to the store default.
- Till: Print / Reprint use the register profile. A split-button menu offers "Receipt 80 mm · Receipt 58 mm · A4 invoice" for one-off overrides.
- Sales history detail: the same split button.
- Remove the per-device paper idea from Plan 14. The register is the device.

### Phase C — A real A4 invoice layout and layout safety
- `invoiceA4Html(data)` next to `receiptHtml`: `@page { size: A4; margin: 12mm }`, full-width table (item, qty, unit price, discount, net, VAT %, VAT, amount), VAT summary and the same totals block as Phase A. Arabic and bilingual like the receipt.
- When printing a roll receipt, keep `size: <roll> <height>` with `margin: 0`. Set the frame document's `<title>` to the store name rather than the receipt number, so nothing sensitive shows if a header slips through.
- Optional safety net: a small "Printed on wrong paper? Set up this till's printer" link in the Sale complete status line after each print until the till is confirmed (setup flag false).

### Phase D — Printer setup on each till (one time)
Page: Registers → *register* → **Printer setup** (also reachable from the till's menu, and shown automatically on the first print from an unconfirmed till).
1. Choose what is connected: 80 mm receipt printer / 58 mm receipt printer / A4 office printer.
2. Instructions for that choice in the Chrome print dialog: **Destination** = the receipt printer (not "Save as PDF" or "Microsoft Print to PDF"). **More settings → Paper size** = "Roll paper 80 × 297 mm" or the driver's "80 × Receipt" (Epson) or "72mm × Receipt" (Star). **Margins** = None. **Headers and footers** = off. **Scale** = Default. Also the Windows driver: Printing Preferences → Layout/Paper = roll paper 80 mm, cut after document, open drawer.
3. **Print test receipt**, then ask "Did it come out the full width of the paper, with no date or web address on it?"
   - **Yes** → save `setupConfirmedAt` on the register.
   - **No** → troubleshooting by symptom:
     - Small receipt in the middle of a big page → wrong printer, or the driver is on A4/Letter.
     - Right side cut off → 58 mm paper with the 80 mm profile.
     - Date or URL printed → headers and footers are on.
     - Tiny text → Scale is set to "Fit to page" with the wrong paper.
4. The till shows a one-line notice "Receipt printer not set up on this till" until it is confirmed.

### Phase E — Lock the settings on counter PCs
- The admin guide plus a script in `tools/till-setup/` (Windows `.bat`) that:
  - creates a desktop shortcut `chrome.exe --kiosk-printing --app=http://<server>/s/<storeId>/pos`, so receipts print with no dialog to the default printer;
  - optionally writes Chrome/Edge policies for managed tills: `PrintHeaderFooter = false`, `PrintingPaperSizeDefault = {"name":"custom","custom_size":{"width":80000,"height":297000}}` (micrometres; the browser ignores it if the printer doesn't support that size), and `PrintingBackgroundGraphicsDefault` off.
- Set the receipt printer as the Windows default printer (kiosk printing always uses the default).

### Phase F — Direct printing (recommended for production, was Plan 14 Phase 4)
- Register printer profile `kind: BROWSER | QZ_TRAY | EPSON_EPOS`, plus the printer name or IP.
- Draw the receipt to a 576-dot raster (80 mm at 203 dpi), which also handles Arabic, then send it with paper cut and drawer kick. QZ Tray (the same approach as ERPNext) or Epson ePOS-Print. If direct printing fails, fall back to browser print automatically.
- This removes the dependence on browser paper settings entirely, and it is what makes printing "always right" on a busy counter.

## 4. Verification
- **Automated print check (new, in CI):** a Chromium run (xvfb + `--kiosk-printing` + "Save as PDF") that prints through the real `printHtml` path and checks the PDF: the 80 mm profile gives an 80 mm wide page, 58 mm gives 58 mm, and A4 gives 210 × 297 mm. Also one page per copy, and no URL or date text in the PDF. (This harness was used to diagnose this issue and should be committed under `apps/web/e2e/print-paper.mjs`.)
- Totals unit tests (Phase A) for the receipt and the invoice PDF.
- **By hand on real printers:**
  - an Epson TM-T20/T82 with the driver on roll paper;
  - a generic 80 mm (Xprinter-type) printer;
  - a 58 mm printer;
  - an A4 office printer, which with the A4 profile should give a proper A4 invoice;
  - "Microsoft Print to PDF", which with the 80 mm profile reproduces today's symptom and should show the setup warning.

## 5. Order and size
| Phase | What | Size |
|---|---|---|
| A | Totals fix on the receipt and invoice PDF, with tests | ~0.5 day |
| B | Register printer profile, API, split print button | ~1 day |
| C | A4 invoice HTML layout | ~1 day |
| D | Printer setup wizard and test print flow | ~1 day |
| E | Kiosk shortcut, policies script, docs | ~0.5 day |
| F | Direct printing (QZ Tray or ePOS) | ~3–5 days per transport |

Do **A first** (wrong numbers on a tax invoice are the most serious problem), then **D and E**, which fix today's preview with no code changes to printing, then **B and C**, then F.

## Sources
- Botble POS Pro printer setup: https://docs.botble.com/pos-pro/usage-printer-setup.html
- Oracle CC&B receipt printing preferences: https://docs.oracle.com/en/industries/energy-water/shared/24a/cs-implementation-guide/CS_IMPLEMENTATION_24A/CCS_Receipt_Printing.28.4.html
- Odoo forum, page size when printing POS receipts: https://odoo.com/forum/help-1/page-size-when-printing-pos-receipts-5443
- ERPNext raw printing (QZ Tray): https://docs.frappe.io/erpnext/raw-printing
- PrintingPaperSizeDefault policy (ignored if the printer doesn't support the size): https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/printingpapersizedefault
