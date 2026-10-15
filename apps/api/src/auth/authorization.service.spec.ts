import { describe, expect, it } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { PermissionGrant, UserContext } from './auth.types.js';

const STORE = 'store-a';
const ORG = 'org-a';
const grant = (permissionCode: string, scopeType: PermissionGrant['scopeType'], effect: PermissionGrant['effect'] = 'ALLOW', scopeId: string | null = null): PermissionGrant => ({
  permissionCode,
  effect,
  roleName: scopeType === 'ORGANIZATION' ? 'Organisation Administrator' : 'Store Manager',
  scopeType,
  scopeId,
});
const context = (overrides: Partial<UserContext> = {}): UserContext => ({
  userId: 'user-a',
  organizationId: ORG,
  email: 'user@example.com',
  displayName: 'Test User',
  preferredLocale: 'en',
  status: 'ACTIVE',
  defaultStoreId: STORE,
  storeIds: [STORE],
  grants: [],
  isOrganisationAdministrator: false,
  ...overrides,
});
const service = new AuthorizationService({} as never);

describe('AuthorizationService store scope', () => {
  const admin = context({
    isOrganisationAdministrator: true,
    grants: [
      grant('catalog.view', 'ORGANIZATION'),
      grant('sale.view', 'ORGANIZATION'),
      grant('refund.view', 'ORGANIZATION'),
      grant('report.view', 'ORGANIZATION'),
      grant('catalog.manage.store', 'ORGANIZATION'),
      grant('store-catalog.verify', 'ORGANIZATION'),
      grant('sale.create', 'ORGANIZATION'),
      grant('report.export', 'ORGANIZATION'),
    ],
  });

  it('keeps organization administration broad in organization scope', () => {
    expect(service.hasPermission(admin, 'catalog.manage.store')).toBe(true);
    expect(service.hasPermission(admin, 'sale.create')).toBe(true);
    expect(service.permissionEffect(admin, 'sale.create')).toBe('ALLOW');
  });

  it('grants organization administrators only the explicit store read set by default', () => {
    expect(service.hasPermission(admin, 'catalog.view', STORE)).toBe(true);
    expect(service.hasPermission(admin, 'sale.view', STORE)).toBe(true);
    expect(service.hasPermission(admin, 'refund.view', STORE)).toBe(true);
    expect(service.hasPermission(admin, 'report.view', STORE)).toBe(true);
    expect(service.hasPermission(admin, 'catalog.manage.store', STORE)).toBe(false);
    expect(service.hasPermission(admin, 'store-catalog.verify', STORE)).toBe(false);
    expect(service.hasPermission(admin, 'sale.create', STORE)).toBe(false);
    expect(service.hasPermission(admin, 'report.export', STORE)).toBe(false);
    expect(service.permissionEffect(admin, 'catalog.manage.store', STORE)).toBeNull();
  });

  it('allows a separate explicit store role and keeps its store boundary', () => {
    const dualRole = context({
      isOrganisationAdministrator: true,
      grants: [grant('catalog.manage.store', 'ORGANIZATION'), grant('catalog.manage.store', 'STORE', 'ALLOW', STORE)],
    });
    expect(service.hasPermission(dualRole, 'catalog.manage.store', STORE)).toBe(true);
    expect(service.hasPermission(dualRole, 'catalog.manage.store', 'store-b')).toBe(false);
  });

  it('preserves deny and approval effects in the target store', () => {
    const denied = context({
      isOrganisationAdministrator: true,
      grants: [grant('catalog.manage.store', 'ORGANIZATION'), grant('catalog.manage.store', 'STORE', 'DENY', STORE)],
    });
    expect(service.hasPermission(denied, 'catalog.manage.store', STORE)).toBe(false);
    expect(service.permissionEffect(denied, 'catalog.manage.store', STORE)).toBe('DENY');

    const approval = context({ grants: [grant('sale.discount', 'STORE', 'REQUIRE_APPROVAL', STORE)] });
    expect(service.hasPermission(approval, 'sale.discount', STORE)).toBe(true);
    expect(service.permissionEffect(approval, 'sale.discount', STORE)).toBe('REQUIRE_APPROVAL');
  });

  it('allows an organization read grant to apply to store views without promoting it to write access', () => {
    const reader = context({ grants: [grant('catalog.view', 'ORGANIZATION'), grant('catalog.manage.store', 'ORGANIZATION')] });
    expect(service.hasPermission(reader, 'catalog.view', STORE)).toBe(true);
    expect(service.hasPermission(reader, 'catalog.manage.store', STORE)).toBe(false);
  });
});
