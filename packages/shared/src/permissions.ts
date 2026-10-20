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
  'store.cashiers.manage',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Store permissions that allow observation but never authorize a store mutation or export. */
export const STORE_READ_ONLY_PERMISSION_CODES = [
  'stores.view',
  'store.overview.view', 'store.settings.view', 'store.staff.view', 'registers.view', 'attendance.view',
  'catalog.view', 'pricing.view', 'tax.view', 'audit.view', 'report.view', 'inventory.view', 'sale.view',
  'refund.view', 'customer.view',
] as const satisfies readonly PermissionCode[];

/** Permissions that are only ever checked organisation-wide (never with a store id). Granting one of these
 * through a store-scoped role assignment has no effect anywhere: `hasPermission` only honours an
 * ORGANIZATION-scope grant when no storeId is passed, which is how every call site for these codes checks them. */
export const ORGANISATION_ONLY_PERMISSION_CODES = [
  'org.settings.manage', 'org.overview.view', 'users.view', 'users.manage',
  'roles.view', 'roles.manage', 'stores.view', 'stores.manage',
] as const satisfies readonly PermissionCode[];

export type PermissionEffect = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ConfirmLevel = 'NONE' | 'WARN' | 'TYPE_TO_CONFIRM';

const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function downgrade(level: RiskLevel): RiskLevel {
  const index = RISK_ORDER.indexOf(level);
  return RISK_ORDER[Math.max(0, index - 1)];
}

/** How risky each permission is to grant, and why. Drives the elevation-warning dialog and the server-side
 * confirmation gate; both the web app and the API import this same table so the warning a person sees is
 * exactly the rule the server enforces. */
export const PERMISSION_RISK: Record<PermissionCode, { level: RiskLevel; reason: string }> = {
  'org.settings.manage': { level: 'CRITICAL', reason: 'Changes organisation-wide configuration, including tax and billing setup.' },
  'org.overview.view': { level: 'LOW', reason: 'Read-only visibility into the organisation overview.' },
  'users.view': { level: 'LOW', reason: 'Read-only visibility into the people in this organisation.' },
  'users.manage': { level: 'CRITICAL', reason: 'Can create, disable or change the access of any person in the organisation.' },
  'roles.view': { level: 'LOW', reason: 'Read-only visibility into roles and their permissions.' },
  'roles.manage': { level: 'CRITICAL', reason: 'Can grant any permission to any role, including to itself.' },
  'stores.view': { level: 'LOW', reason: 'Read-only visibility into the list of stores.' },
  'stores.manage': { level: 'CRITICAL', reason: 'Can create, close or reconfigure any store in the organisation.' },
  'store.overview.view': { level: 'LOW', reason: 'Read-only visibility into one store’s overview.' },
  'store.settings.view': { level: 'LOW', reason: 'Read-only visibility into one store’s settings.' },
  'store.settings.manage': { level: 'HIGH', reason: 'Can change how this store bills, taxes and checks out customers.' },
  'store.staff.view': { level: 'LOW', reason: 'Read-only visibility into who is assigned to this store.' },
  'store.staff.manage': { level: 'HIGH', reason: 'Can assign approved roles to people working at this store.' },
  'store.cashiers.manage': { level: 'HIGH', reason: 'Can add, rename or deactivate cashier names and reset the shared till login for this store.' },
  'registers.view': { level: 'LOW', reason: 'Read-only visibility into this store’s registers.' },
  'registers.manage': { level: 'HIGH', reason: 'Can create or reconfigure the registers that record cash and sales.' },
  'attendance.view': { level: 'LOW', reason: 'Read-only visibility into staff attendance.' },
  'attendance.clock': { level: 'LOW', reason: 'Can clock only themself in and out.' },
  'attendance.manage': { level: 'HIGH', reason: 'Can correct other people’s attendance and missed clock-outs.' },
  'catalog.view': { level: 'LOW', reason: 'Read-only visibility into the product catalogue.' },
  'catalog.manage': { level: 'HIGH', reason: 'Can create or change catalogue records organisation-wide.' },
  'catalog.manage.store': { level: 'MEDIUM', reason: 'Can create or change products within this store only.' },
  'catalog.distribute': { level: 'HIGH', reason: 'Can push catalogue changes from the organisation out to a store.' },
  'store-catalog.verify': { level: 'MEDIUM', reason: 'Can verify or reject stock sent to this store.' },
  'pricing.view': { level: 'LOW', reason: 'Read-only visibility into prices.' },
  'pricing.manage': { level: 'HIGH', reason: 'Can change the prices customers are charged.' },
  'tax.view': { level: 'LOW', reason: 'Read-only visibility into tax groups.' },
  'tax.manage': { level: 'HIGH', reason: 'Can change how tax is calculated on every sale.' },
  'audit.view': { level: 'HIGH', reason: 'Can see the full activity trail, including other people’s actions.' },
  'report.view': { level: 'LOW', reason: 'Read-only visibility into reports.' },
  'report.export': { level: 'HIGH', reason: 'Can export sales and financial data out of the system.' },
  'alert.manage': { level: 'MEDIUM', reason: 'Can acknowledge and resolve store alerts.' },
  'dayclose.manage': { level: 'HIGH', reason: 'Can close and restate a store’s business day, which locks in its figures.' },
  'approval.request': { level: 'LOW', reason: 'Can ask a manager to approve a controlled action.' },
  'sale.view': { level: 'LOW', reason: 'Read-only visibility into sales and receipts.' },
  'sale.create': { level: 'LOW', reason: 'Can ring up a sale at this store.' },
  'sale.hold': { level: 'LOW', reason: 'Can hold and resume an in-progress sale.' },
  'sale.discount': { level: 'MEDIUM', reason: 'Can reduce what a customer is charged.' },
  'sale.void': { level: 'HIGH', reason: 'Can remove a completed sale from the day’s revenue.' },
  'register.open': { level: 'MEDIUM', reason: 'Can start a till session with an opening float.' },
  'register.close': { level: 'MEDIUM', reason: 'Can close a till session and record the counted cash.' },
  'cash.manage': { level: 'HIGH', reason: 'Can move cash in or out of the drawer outside of a sale.' },
  'inventory.view': { level: 'LOW', reason: 'Read-only visibility into stock on hand.' },
  'inventory.manage': { level: 'HIGH', reason: 'Can adjust recorded stock levels.' },
  'refund.view': { level: 'LOW', reason: 'Read-only visibility into returns and credit notes.' },
  'refund.create': { level: 'HIGH', reason: 'Can refund money back to a customer.' },
  'approval.manage': { level: 'HIGH', reason: 'Can approve controlled actions, including ones from other people.' },
  'customer.view': { level: 'LOW', reason: 'Read-only visibility into customers.' },
  'customer.manage': { level: 'MEDIUM', reason: 'Can create or change customer records and loyalty balances.' },
  'promotion.manage': { level: 'MEDIUM', reason: 'Can create or change discounts and promotions store-wide.' },
  'transfer.manage': { level: 'HIGH', reason: 'Can move stock between stores.' },
};

export type RoleTemplateKey = 'org_admin' | 'store_manager' | 'supervisor' | 'cashier' | 'inventory_user';

export type RoleTemplateDefinition = {
  key: RoleTemplateKey;
  name: string;
  description: string;
  /** Bump when the default permission set for this template changes, so customised roles can be offered a review instead of a silent overwrite. */
  version: number;
  permissions: PermissionCode[];
  storeAssignable?: boolean;
};

/** The safe level for each system role: its default permission set. Shared by the API (startup reconcile,
 * server-side elevation check) and the web role editor (template picker, "Default: No access" markers). */
export const ROLE_TEMPLATES: Record<RoleTemplateKey, RoleTemplateDefinition> = {
  org_admin: {
    key: 'org_admin',
    name: 'Organisation Administrator',
    description: 'Full organisation configuration access',
    version: 1,
    permissions: [...PERMISSION_CODES],
  },
  store_manager: {
    key: 'store_manager',
    name: 'Store Manager',
    description: 'Manage assigned store operations',
    version: 2,
    permissions: [
      'store.overview.view', 'store.settings.view', 'store.settings.manage', 'store.staff.view', 'store.staff.manage', 'store.cashiers.manage',
      'registers.view', 'registers.manage', 'attendance.view', 'attendance.clock', 'attendance.manage',
      'catalog.view', 'catalog.manage.store', 'store-catalog.verify', 'pricing.view', 'pricing.manage', 'tax.view', 'tax.manage',
      'sale.view', 'sale.create', 'sale.hold', 'sale.discount', 'sale.void', 'register.open', 'register.close', 'cash.manage',
      'inventory.view', 'inventory.manage', 'report.view', 'report.export', 'alert.manage', 'dayclose.manage',
      'refund.view', 'refund.create', 'approval.manage', 'approval.request', 'customer.view', 'customer.manage',
    ],
  },
  supervisor: {
    key: 'supervisor',
    name: 'Supervisor',
    description: 'Operational support and permitted approvals',
    version: 1,
    permissions: [
      'store.overview.view', 'store.staff.view', 'registers.view', 'attendance.view', 'attendance.clock', 'attendance.manage',
      'catalog.view', 'pricing.view', 'sale.view', 'sale.create', 'register.open', 'register.close',
      'refund.view', 'refund.create', 'approval.manage', 'approval.request', 'report.view', 'alert.manage', 'customer.view',
    ],
    storeAssignable: true,
  },
  cashier: {
    key: 'cashier',
    name: 'Cashier',
    description: 'Normal sales and register operations',
    version: 1,
    permissions: [
      'registers.view', 'attendance.clock', 'catalog.view', 'sale.view', 'sale.create', 'sale.hold', 'sale.discount',
      'register.open', 'register.close', 'cash.manage', 'approval.request', 'customer.view', 'customer.manage',
    ],
    storeAssignable: true,
  },
  inventory_user: {
    key: 'inventory_user',
    name: 'Inventory User',
    description: 'Catalogue and inventory-related tasks',
    version: 1,
    permissions: ['inventory.view', 'inventory.manage', 'stores.view', 'catalog.view', 'catalog.manage', 'pricing.view', 'tax.view'],
  },
};

/** Pairs of permissions that let one person both perform and approve/undo the same kind of action with
 * nobody else involved. Flagged as a conflict, never blocked outright: some small stores genuinely need it. */
const CONFLICT_PAIRS: { pair: [PermissionCode, PermissionCode]; message: string }[] = [
  { pair: ['refund.create', 'approval.manage'], message: 'This role could create a refund and approve its own refund, with nobody else involved.' },
  { pair: ['sale.void', 'approval.manage'], message: 'This role could void a sale and approve its own void, with nobody else involved.' },
  { pair: ['cash.manage', 'dayclose.manage'], message: 'This role could move cash out of the drawer and then close the business day that cash belongs to.' },
];

function isGranted(effect: PermissionEffect | undefined): effect is PermissionEffect {
  return effect === 'ALLOW' || effect === 'REQUIRE_APPROVAL';
}

export type RoleChangeFlag = { code: PermissionCode; level: RiskLevel; reason: string; effect: PermissionEffect };

export type RoleChangeAssessment = {
  /** Permissions granted in `after` that sit above the role's safe (template) level. */
  elevated: RoleChangeFlag[];
  /** HIGH or CRITICAL permissions newly granted compared with `before`, even when inside the template. */
  newlyHighRisk: RoleChangeFlag[];
  /** Organisation-only permissions that would do nothing for a store-assignable role. */
  ineffective: { code: PermissionCode; message: string }[];
  /** Separation-of-duties pairs both granted in `after`. */
  conflicts: { codes: PermissionCode[]; message: string }[];
  /** True when the new permission set likely exceeds what most store managers could assign under their own access. */
  storeAssignabilityLost: boolean;
  /** Hard stops: the save must be refused outright, never just confirmed. */
  blocked: string[];
  confirmLevel: ConfirmLevel;
  requiresReason: boolean;
};

export function assessRoleChange(input: {
  templateKey?: string | null;
  before: Partial<Record<PermissionCode, PermissionEffect>>;
  after: Partial<Record<PermissionCode, PermissionEffect>>;
  storeAssignable: boolean;
  /** True when this role is (or would be) assigned to a shared till login. Tills may never hold CRITICAL permissions. */
  isTillRole?: boolean;
}): RoleChangeAssessment {
  const template = input.templateKey ? ROLE_TEMPLATES[input.templateKey as RoleTemplateKey] : undefined;
  const safeSet = new Set<PermissionCode>(template ? template.permissions : []);
  const blocked: string[] = [];

  if (template?.key === 'org_admin') {
    blocked.push('The administrator role always has every permission and cannot be edited.');
  }

  const elevated: RoleChangeFlag[] = [];
  const newlyHighRisk: RoleChangeFlag[] = [];
  const ineffective: { code: PermissionCode; message: string }[] = [];

  for (const code of PERMISSION_CODES) {
    const afterEffect = input.after[code];
    const beforeEffect = input.before[code];
    if (!isGranted(afterEffect)) continue;
    const risk = PERMISSION_RISK[code];
    const effectiveLevel = afterEffect === 'REQUIRE_APPROVAL' ? downgrade(risk.level) : risk.level;

    if (!safeSet.has(code)) {
      elevated.push({ code, level: effectiveLevel, reason: risk.reason, effect: afterEffect });
    }
    if ((risk.level === 'HIGH' || risk.level === 'CRITICAL') && !isGranted(beforeEffect)) {
      newlyHighRisk.push({ code, level: effectiveLevel, reason: risk.reason, effect: afterEffect });
    }
    if (input.storeAssignable && (ORGANISATION_ONLY_PERMISSION_CODES as readonly string[]).includes(code)) {
      ineffective.push({ code, message: 'This permission only ever applies organisation-wide, so it will do nothing for a role assigned at store level.' });
    }
    if (input.isTillRole && effectiveLevel === 'CRITICAL') {
      blocked.push(`${code} cannot be granted to a role used on a shared till login.`);
    }
  }

  const conflicts = CONFLICT_PAIRS
    .filter(({ pair }) => pair.every((code) => isGranted(input.after[code])))
    .map(({ pair, message }) => ({ codes: pair as PermissionCode[], message }));
  if (template?.key !== 'org_admin' && isGranted(input.after['users.manage']) && isGranted(input.after['roles.manage'])) {
    conflicts.push({ codes: ['users.manage', 'roles.manage'], message: 'This role could both create people and grant itself any permission, which removes any check on its own access.' });
  }

  const storeAssignabilityLost = input.storeAssignable && elevated.some((flag) => flag.level === 'HIGH' || flag.level === 'CRITICAL');

  const highestElevated = [...elevated, ...newlyHighRisk].reduce<RiskLevel | null>((max, flag) => {
    if (!max) return flag.level;
    return RISK_ORDER.indexOf(flag.level) > RISK_ORDER.indexOf(max) ? flag.level : max;
  }, null);

  const confirmLevel: ConfirmLevel = blocked.length > 0
    ? 'NONE'
    : highestElevated === 'CRITICAL'
      ? 'TYPE_TO_CONFIRM'
      : (elevated.length > 0 || newlyHighRisk.length > 0 || conflicts.length > 0)
        ? 'WARN'
        : 'NONE';

  const requiresReason = highestElevated === 'HIGH' || highestElevated === 'CRITICAL';

  return { elevated, newlyHighRisk, ineffective, conflicts, storeAssignabilityLost, blocked, confirmLevel, requiresReason };
}
