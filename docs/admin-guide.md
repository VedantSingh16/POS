# POS administrator guide

1. Start the stack and sign in with the bootstrap administrator.
2. Complete onboarding: organisation metadata, administrator credentials/PIN, stores/registers, users, tax groups and cash rounding.
3. Load catalogue CSV data from Organisation → Catalogue → Import. Review row errors before committing.
4. Load opening stock from a store's Inventory → Opening stock page. Set reorder and safety thresholds on inventory records.
5. Configure roles and permission effects. System roles are read-only; custom roles can use Allow, Requires approval or No access.
6. Configure approval thresholds, inventory policy, receipt settings and store close hour.
7. Review audit activity, alerts and reports regularly. Export CSV only from an account with `report.export`.

Sensitive actions are server-authorized and tenant/store scoped. If an action is refused, verify the user's role assignment and store scope rather than changing the client UI.
