import type { Locale } from '@pos/shared/locale';

export type PermissionGrant = {
  permissionCode: string;
  effect: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  roleName: string;
  scopeType: 'ORGANIZATION' | 'STORE';
  scopeId: string | null;
};

export type UserContext = {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  preferredLocale: Locale;
  status: string;
  defaultStoreId: string | null;
  storeIds: string[];
  grants: PermissionGrant[];
  isOrganisationAdministrator: boolean;
  /** Set when the request was authenticated by the CRM Product Contract. */
  authSource?: 'POS_SESSION' | 'CRM_PRODUCT_TOKEN';
  platformTenantId?: string;
  platformMembershipId?: string;
  platformCapabilities?: string[];
};
