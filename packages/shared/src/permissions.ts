export const PERMISSION_CODES = [
  'org.settings.manage', 'org.overview.view', 'users.view', 'users.manage',
  'roles.view', 'roles.manage', 'stores.view', 'stores.manage',
  'store.overview.view', 'store.settings.view', 'store.settings.manage', 'store.staff.view', 'store.staff.manage',
  'registers.view', 'registers.manage', 'attendance.view', 'attendance.clock', 'attendance.manage', 'catalog.view', 'catalog.manage',
  'pricing.view', 'pricing.manage', 'tax.view', 'tax.manage', 'audit.view',
  'report.view', 'report.export', 'alert.manage', 'dayclose.manage', 'approval.request', 'sale.view', 'sale.create', 'sale.hold', 'sale.discount',
  'sale.void', 'register.open', 'register.close', 'cash.manage',
  'inventory.view', 'inventory.manage', 'refund.view', 'refund.create', 'approval.manage',
  'customer.view', 'customer.manage', 'promotion.manage', 'transfer.manage',
  'catalog.manage.store', 'catalog.distribute', 'store-catalog.verify',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Store permissions that allow observation but never authorize a store mutation or export. */
export const STORE_READ_ONLY_PERMISSION_CODES = [
  'stores.view',
  'store.overview.view', 'store.settings.view', 'store.staff.view', 'registers.view', 'attendance.view',
  'catalog.view', 'pricing.view', 'tax.view', 'audit.view', 'report.view', 'inventory.view', 'sale.view',
  'refund.view', 'customer.view',
] as const satisfies readonly PermissionCode[];
