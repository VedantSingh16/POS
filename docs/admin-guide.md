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
