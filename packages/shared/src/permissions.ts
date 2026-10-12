export const PERMISSION_CODES = [
  'org.settings.manage', 'org.overview.view', 'users.view', 'users.manage',
  'roles.view', 'roles.manage', 'stores.view', 'stores.manage',
  'store.overview.view', 'store.settings.view', 'store.settings.manage', 'store.staff.view',
  'registers.view', 'registers.manage', 'catalog.view', 'catalog.manage',
  'pricing.view', 'pricing.manage', 'tax.view', 'tax.manage', 'audit.view',
  'report.view', 'report.export', 'sale.create', 'sale.hold', 'sale.discount',
  'sale.void', 'register.open', 'register.close', 'cash.manage',
  'inventory.view', 'inventory.manage', 'refund.create', 'approval.manage',
  'customer.view', 'customer.manage', 'promotion.manage', 'transfer.manage',
  'catalog.manage.store', 'catalog.distribute', 'store-catalog.verify',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
