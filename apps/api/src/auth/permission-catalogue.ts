import { PERMISSION_CODES } from '@pos/shared/permissions';

/** Every permission code the API can enforce, with its description. Seeded into `permissions`. */
export const PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['org.settings.manage', 'Manage organisation settings'],
  ['org.overview.view', 'View organisation overview'],
  ['users.view', 'View organisation users'],
  ['users.manage', 'Create and manage organisation users'],
  ['roles.view', 'View roles and permissions'],
  ['roles.manage', 'Create and manage roles and permissions'],
  ['stores.view', 'View stores'],
  ['stores.manage', 'Create and manage stores'],
  ['store.overview.view', 'View assigned store overview'],
  ['store.settings.view', 'View assigned store settings'],
  ['store.settings.manage', 'Manage assigned store settings'],
  ['store.staff.view', 'View staff assigned to this store'],
  ['store.staff.manage', 'Assign approved roles to staff in this store'],
  ['registers.view', 'View registers'],
  ['registers.manage', 'Create and manage registers'],
  ['attendance.view', 'View attendance for this store'],
  ['attendance.clock', 'Clock yourself in and out at this store'],
  ['attendance.manage', 'Correct staff attendance and missed clock-outs'],
  ['catalog.view', 'View the product catalogue'],
  ['catalog.manage', 'Create and manage catalogue records'],
  ['pricing.view', 'View prices'],
  ['pricing.manage', 'Manage prices'],
  ['tax.view', 'View tax groups'],
  ['tax.manage', 'Manage tax groups'],
  ['audit.view', 'View audit activity'],
  ['report.view', 'View reports'],
  ['report.export', 'Export reports'],
  ['alert.manage', 'Acknowledge and resolve store alerts'],
  ['dayclose.manage', 'Close and restate a store business day'],
  ['sale.view', 'View sales and receipts'],
  ['sale.create', 'Create sales'],
  ['sale.hold', 'Hold and resume sales'],
  ['sale.discount', 'Apply discounts'],
  ['sale.void', 'Void sales'],
  ['register.open', 'Open a register'],
  ['register.close', 'Close a register'],
  ['cash.manage', 'Manage cash movements'],
  ['inventory.view', 'View inventory'],
  ['inventory.manage', 'Adjust inventory'],
  ['refund.view', 'View returns and credit notes'],
  ['refund.create', 'Create refunds and returns'],
  ['approval.manage', 'Approve controlled actions'],
  ['approval.request', 'Request approval for a controlled action'],
  ['customer.view', 'View customers'],
  ['customer.manage', 'Manage customers and loyalty'],
  ['promotion.manage', 'Manage promotions and bundles'],
  ['transfer.manage', 'Manage stock transfers'],
  ['catalog.manage.store', 'Create and manage products in a store'],
  ['catalog.distribute', 'Distribute products from the organisation to a store'],
  ['store-catalog.verify', 'Verify or reject pending stock sent to a store'],
];

// Keep the seed catalogue and the cross-app permission manifest tied to one source.
export const ALL_PERMISSION_CODES: string[] = [...PERMISSION_CODES];

export const ORGANISATION_ADMINISTRATOR_ROLE = 'Organisation Administrator';

export type SystemRoleDefinition = { name: string; description: string; permissions: string[]; storeAssignable?: boolean };

/** System roles created for every organisation. They are locked: they can be assigned but not edited. */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  { name: ORGANISATION_ADMINISTRATOR_ROLE, description: 'Full organisation configuration access', permissions: ALL_PERMISSION_CODES },
  { name: 'Store Manager', description: 'Manage assigned store operations', permissions: ['store.overview.view', 'store.settings.view', 'store.settings.manage', 'store.staff.view', 'store.staff.manage', 'registers.view', 'registers.manage', 'attendance.view', 'attendance.clock', 'attendance.manage', 'catalog.view', 'catalog.manage.store', 'store-catalog.verify', 'pricing.view', 'pricing.manage', 'tax.view', 'tax.manage', 'sale.view', 'sale.create', 'sale.hold', 'sale.discount', 'sale.void', 'register.open', 'register.close', 'cash.manage', 'inventory.view', 'inventory.manage', 'report.view', 'report.export', 'alert.manage', 'dayclose.manage', 'refund.view', 'refund.create', 'approval.manage', 'approval.request', 'customer.view', 'customer.manage'] },
  { name: 'Supervisor', description: 'Operational support and permitted approvals', permissions: ['store.overview.view', 'store.staff.view', 'registers.view', 'attendance.view', 'attendance.clock', 'attendance.manage', 'catalog.view', 'pricing.view', 'sale.view', 'sale.create', 'register.open', 'register.close', 'refund.view', 'refund.create', 'approval.manage', 'approval.request', 'report.view', 'alert.manage', 'customer.view'], storeAssignable: true },
  { name: 'Cashier', description: 'Normal sales and register operations', permissions: ['registers.view', 'attendance.clock', 'catalog.view', 'sale.view', 'sale.create', 'sale.hold', 'sale.discount', 'register.open', 'register.close', 'cash.manage', 'approval.request', 'customer.view', 'customer.manage'], storeAssignable: true },
  { name: 'Inventory User', description: 'Catalogue and inventory-related tasks', permissions: ['inventory.view', 'inventory.manage', 'stores.view', 'catalog.view', 'catalog.manage', 'pricing.view', 'tax.view'] },
];
