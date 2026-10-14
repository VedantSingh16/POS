# DeltCRM POS design direction

## Task and audience
The store overview answers “what needs attention before the next sale?” Cashiers need a reliable scan-to-payment path; inventory operators need quick stock search, status, and adjustment links; administrators need to distinguish organisation-owned settings from store changes.

## Design plan
- **Palette:** paper `#F5F7F4`, white `#FFFFFF`, ink `#18221E`, quiet sage `#61736B`, Delt green `#087A57`, pale mint `#E7F2EC`, restrained amber/red for operational states.
- **Type:** retain the already-loaded Geist family as the product UI face, with tabular numerals for amounts and counts. Use sentence-case headings and small, quiet metadata; no added font dependency.
- **Layout:** a light mint identity/navigation rail, narrow utility bar, full-width work area. Store overview uses a compact sales summary followed by a wider hourly chart beside payment mix, then actionable recent activity and open alerts. POS keeps search and product selection left, a persistent cart right, and a clear checkout footer.
- **Controls:** operational tables stay flat and dense; headers, filters, and actions align to the task. Forms group inherited organisation values separately from store-editable fields.
- **Principles:** preserve real data, permissions, routes, server APIs, and keyboard behavior. Green marks selection and primary actions. Borders and whitespace establish groups; avoid uniform containers, ornament, decorative metrics, and invented content.

## Review checklist
- Does the page surface the decision or action its user needs next?
- Are all values sourced from existing data and clearly scoped to the store or organisation?
- Do table and settings layouts retain existing controls, inheritance rules, and permission boundaries?
- Are focus, keyboard operation, narrow-screen behavior, and empty states preserved?
- Are accent, radius, shadow, and motion used only when they clarify hierarchy or a state?

The supplied reference images inform the practical density, light navigation, clear scan area, and fixed cart arrangement. DeltCRM keeps its own name, green palette, and existing product behavior.
