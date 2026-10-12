/**
 * Plan 3 MVP status board exposed at GET /api/pos/v1/features.
 * A phase is VERIFIED only after its implementation and verification gate are complete.
 */
export const PHASES = [
  { phase: 0, stage: 'Foundation', name: 'Baseline, data layer and guardrails', status: 'VERIFIED', features: ['Mapped Prisma schema', 'Workspace/shared package', 'Tenant/store isolation tests', 'CI and Docker baseline'] },
  { phase: 1, stage: 'Foundation', name: 'Design system, app shell and route skeletons', status: 'PARTIAL', features: ['Shared shell and navigation', 'DataTable and form patterns', 'POS layout shell', 'Route coverage needs final walkthrough'] },
  { phase: 2, stage: 'Foundation', name: 'Authentication, session and access control', status: 'PARTIAL', features: ['HttpOnly BFF session', 'Login lockout and idle timeout', 'Permission/store guards', 'Full role landing walkthrough pending'] },
  { phase: 3, stage: 'Foundation', name: 'Onboarding and organisation administration', status: 'PARTIAL', features: ['Resumable onboarding state', 'Organisation and store setup', 'Users, roles and permission effects', 'Concurrent store quota covered; full fresh-database walkthrough pending'] },
  { phase: 4, stage: 'POS_CORE', name: 'Catalogue, pricing and tax', status: 'PARTIAL', features: ['Catalogue CRUD and tax metadata', 'Brands and barcodes', 'Historical price/cost data', '500-row import/search and 10k name/SKU/barcode/brand performance gates pass; generated-variant builder implemented, browser persistence/list walkthrough remains'] },
  { phase: 5, stage: 'POS_CORE', name: 'Register and checkout', status: 'PARTIAL', features: ['Register/cash movements', 'Checkout and cash/card/UPI recording', 'Rounding and discount controls', '20-concurrent sequential invoice and sub-second regression pass; full UI walkthrough pending'] },
  { phase: 6, stage: 'POS_INVENTORY', name: 'Inventory', status: 'PARTIAL', features: ['Append-only ledger and rebuild', 'Opening stock import', 'Negative-stock policy', 'Thresholds and damaged returns', 'Scheduled low-stock sweep needs final gate'] },
  { phase: 7, stage: 'POS_REFUNDS', name: 'Sales history, returns and refunds', status: 'PARTIAL', features: ['Receipt/customer search', 'Twice-partial return caps and over-return blocking', 'Restock disposition, credit notes and cash reconciliation', 'Manager-PIN approval e2e passes; browser print walkthrough pending'] },
  { phase: 8, stage: 'Reporting', name: 'Customers, dashboards, reports and alerts', status: 'PARTIAL', features: ['Customer purchase history', 'Filtered reports and CSV export', 'GST/cash reconciliation data', 'Scheduled alerts and full dashboard verification pending'] },
  { phase: 9, stage: 'Pilot', name: 'Hardening and pilot go-live', status: 'PARTIAL', features: ['Cross-tenant/store isolation coverage', 'Dependency audit', 'Backup/restore rehearsal', 'Full-route security, Playwright, accessibility/performance and production operations evidence pending'] },
] as const;
