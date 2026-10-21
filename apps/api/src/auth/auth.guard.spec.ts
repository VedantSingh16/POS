import { describe, expect, it } from 'vitest';
import { isTillRouteAllowed } from './auth.guard.js';

describe('isTillRouteAllowed', () => {
  it('allows the POS selling paths needed by a shared till', () => {
    expect(isTillRouteAllowed('/api/auth/me', 'GET')).toBe(true);
    expect(isTillRouteAllowed('/api/pos/v1/stores/store-1/cashiers/active', 'GET')).toBe(true);
    expect(isTillRouteAllowed('/api/pos/v1/stores/store-1/cashiers/cashier-1/verify', 'POST')).toBe(true);
    expect(isTillRouteAllowed('/api/admin/stores/store-1/registers', 'GET')).toBe(true);
    expect(isTillRouteAllowed('/api/pos/v1/sales', 'POST')).toBe(true);
    expect(isTillRouteAllowed('/api/pos/v1/sessions/session-1/cash', 'POST')).toBe(true);
  });

  it('blocks admin, reports, inventory and role-management routes for a till', () => {
    expect(isTillRouteAllowed('/api/admin/users', 'GET')).toBe(false);
    expect(isTillRouteAllowed('/api/pos/v1/reports', 'GET')).toBe(false);
    expect(isTillRouteAllowed('/api/pos/v1/inventory', 'GET')).toBe(false);
    expect(isTillRouteAllowed('/api/pos/v1/approvals/approval-1', 'PATCH')).toBe(false);
    expect(isTillRouteAllowed('/api/auth/profile', 'GET')).toBe(false);
  });
});
