# POS administrator guide

1. Start the stack and sign in with the bootstrap administrator.
2. Complete onboarding: organisation metadata, administrator credentials/PIN, stores/registers, users, tax groups and cash rounding.
3. Load catalogue CSV data from Organisation → Catalogue → Import. Review row errors before committing.
4. Load opening stock from a store's Inventory → Opening stock page. Set reorder and safety thresholds on inventory records.
5. Configure roles and permission effects. System roles are read-only; custom roles can use Allow, Requires approval or No access.
6. Configure approval thresholds, inventory policy, receipt settings and store close hour.
7. Review audit activity, alerts and reports regularly. Export CSV only from an account with `report.export`.

## Shared till and cashier setup

For a shared checkout device, create the store's till login from Store → Staff → Shared till login. Use a password of at least 12 characters; reset credentials to revoke the till's active sessions and cashier tokens. Disabling the till prevents new sign-ins.

Create named cashiers in the same page, optionally set a cashier PIN, and use Import staff cashiers to seed names from users assigned to the Cashier role. The till user can only hold the Cashier role. A cashier is selected at the POS before billing, and the selected name is attributed to sales, holds, returns, cash movements and register open/close activity. The store settings control whether the selection stays active or is requested for every bill, whether a PIN is required, and whether idle locking clears the selection.

Grant `store.cashiers.manage` separately from `store.staff.manage` when a manager should administer till credentials and named cashier records without managing all store users. Cashier reports distinguish named cashiers (`cashier:<id>`) from person logins (`user:<id>`).

Sensitive actions are server-authorized and tenant/store scoped. If an action is refused, verify the user's role assignment and store scope rather than changing the client UI.

## Receipt printing

Store → Settings → Billing → **Receipt printing** controls what happens after **Complete sale** at the till:

- **Print receipt after a sale**: *Cashier chooses* shows a "Print receipt" switch in the payment dialog, and each till remembers the cashier's last choice. *Always print* prints every bill. *Never print automatically* hides the switch; cashiers can still press **Print receipt** on the "Sale complete" screen or in Sales history.
- **Paper**: 80 mm thermal (most counter printers), 58 mm thermal, or A4.
- **Copies** (1–3). Every copy after the first is marked **REPRINT**.
- **Receipt language**: English, Arabic, or both. Arabic receipts print right to left.
- **Receipt header** (for example a phone number), **Receipt footer**, and **Show tax summary by rate**. The header and footer are saved with each sale, so a reprint always matches the original.

Use **Print test receipt** to check the width and the paper cut before saving.

### Printer setup on each till (in the app)

The paper is a property of the printer at each counter, so it is set per register, not per store. On the till, press the **printer icon** in the cart header (or **Set up** on the "Receipt printer not set up on this till" notice):

1. Choose what is connected: **80 mm receipt printer**, **58 mm receipt printer** or **A4 office printer**. The till prints receipts for that paper from then on; the store's Paper setting is only the default for tills that have not been set up.
2. Follow the on-screen checklist for Chrome's print dialog (receipt printer as destination, roll paper size, Margins None, Headers and footers off, Scale Default) and press **Print test receipt**.
3. Answer **Did the test receipt print correctly?** "Yes" marks the till as set up (who and when is saved on the register and in the audit log, `register.printer_updated`). "No" shows fixes by symptom, for example a small receipt in the middle of a big page (wrong printer or the driver is on A4/Letter) or a date and web address on the paper (Headers and footers are on).

Choosing a different printer type clears the confirmation until a new test print is confirmed. Anyone who can bill at the store can do this; it only changes the paper size.

### Setting up a thermal receipt printer (Windows + Chrome)

1. Install the printer's Windows driver (Epson TM-T20/T82/m30, Star TSP100/143, Xprinter and similar), and set it as the **default printer**.
2. In the driver's printing preferences, choose **80 mm (or 58 mm) roll paper**, turn on **cut after document**, and, if a cash drawer is plugged into the printer, **open drawer before printing**.
3. Print a test receipt from the store settings. In Chrome's print dialog choose the receipt printer, **Margins: None**, and untick **Headers and footers** once; Chrome remembers these settings.
4. **One-press printing with no dialog (recommended for counters):** start Chrome in kiosk-printing mode, for example with a desktop shortcut:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://<server>:3100/s/<storeId>/pos`
   Receipts then go straight to the default printer.

If a print fails, the sale is still complete. Reprint it from the "Sale complete" screen or from Sales → the sale → **Print receipt**. Every print and reprint is recorded in the audit log (`sale.receipt_printed`).
