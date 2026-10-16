# DeltCRM POS: UI/UX redesign (proposal)

Mockups of the proposed UI/UX fixes. Nothing in `apps/web` has been changed yet.

- `images/`: PNG of each screen (1440 px wide), ready to view or share.
- `source/`: the editable design files from the Claude design canvas (`canvas.json` plus one `.dc.html` per screen).

| # | Screen | Main fixes shown |
|---|--------|------------------|
| 01 | Organisation overview | Setup banner with progress; "Ready to sell" explains why; readiness + Open store per store; activity as sentences; compact deep-green sidebar; org name only in sidebar; language/theme moved to account menu |
| 02 | Stores | Readiness column; explicit Open store; manager with initials; toolbar hidden for small tables; plan slots in footer |
| 03 | Stock movement | Transfers + Distributions merged with tabs; disabled action explains itself; requirements checklist |
| 04 | Team members | "Organisation-wide" no longer amber; roles as chips; row actions; invite nudge |
| 05 | Products | Real empty state with New product + Import; duplicate "Catalogue setup" button removed |
| 06 | Catalogue setup | One ordered list with status per item; "Product setup rules" renamed "Product types" |
| 07 | Organisation settings | Horizontal tabs; GST as option cards; styled selects; sticky save bar for unsaved changes |
| 08 | Sign in | Same tokens/font/radius as the app; crisp product preview instead of faded photo |
| 09 | Create organisation | `deltcrm.app/` URL prefix auto-filled from name; show password; live length check |
| 10 | Point of sale | Customer, discount, coupon moved into the cart; typeable quantity; shortcut hints always visible |
| 11 | Take payment | Only amount, method, cash received; quick-cash buttons; large change-to-return |

Design tokens used: canvas `#F7F5EF`, surface `#FFFFFF`, border `#E6E1D7`, ink `#14201B`, muted `#5B6660`, primary `#047857` (hover `#065F46`), sidebar `#0E3B2E`, warning text `#7A4A00` on `#FBEFD9`, success `#166B47` on `#E3F2EA`. One font: Manrope. Body 14px, page title 28px.

Product names and prices on the POS screens are placeholders in [brackets]. The F8 "add customer" shortcut is a proposal.
