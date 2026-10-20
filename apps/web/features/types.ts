/* Row shapes used by the tables and pages. Money is in paise. These describe API-mapped data, never fixtures. */
export type Product = { id: string; sku: string; barcode: string; name: string; category: string; priceMinor: number; taxRate: number; stock: number; status: "ACTIVE" | "INACTIVE"; hot: boolean; inStore?: boolean; includesTax?: boolean; sellWithoutStock?: boolean; openPrice?: boolean; floorPriceCents?: number };
export type StoreBase = { id: string; code: string; name: string; city: string; status: string; registers: number; staff: number };
export type UserRow = { id: string; name: string; email: string; role: string; scope: string; scopeDetails?: string; status: string; lastLogin: string; storeRoleId?: string };
export type RoleRow = { id: string; name: string; description: string; users: number; permissions: number; system: boolean; customized?: boolean; templateKey?: string | null; templateUpdateAvailable?: boolean };
export type CategoryRow = { id: string; name: string; parentId?: string | null; status?: string; products: number };
export type BrandRow = { id: string; name: string; products: number };
export type TaxGroupRow = { id: string; name: string; rate: number; products: number };
export type CustomerRow = { id: string; name: string; phone: string; tier: string; walletMinor: number; lifetimeMinor: number; lastVisit: string };
export type SaleRow = { id: string; receipt: string; at: string; cashier: string; register: string; items: number; totalMinor: number; tender: string; status: string };
export type ReturnRow = { id: string; number: string; at: string; receipt: string; reason: string; refundMinor: number; method: string; status: string };
export type InventoryRow = { id: string; sku: string; name: string; barcode?: string; onHand: number; reorderLevel: number; status: string; locationId?: string; variantId?: string; productTypeId?: string | null; productTypeName?: string };
export type LedgerRow = { id: string; at: string; sku: string; name: string; type: string; qty: number; ref: string };
export type RegisterRow = { id: string; name: string; status: string; cashier: string; openedAt: string; expectedMinor: number; sessionId: string; code?: string; registerStatus?: string };
export type ApprovalRow = { id: string; at: string; type: string; requestedBy: string; detail: string; status: string; payload?: Record<string, unknown> };
export type AlertRow = { id: string; at: string; severity: string; title: string; detail: string; status?: string; referenceId?: string | null; occurrenceCount?: number; lastSeenAt?: string; resolutionNote?: string; resolvedAt?: string | null };
export type AuditRow = { id: string; at: string; actor: string; action: string; entity: string; detail: string };

export type StoreCatalogueItem = { variantId: string; sku: string; barcodes?: string[]; name: string; brand: string; category: string; assigned: boolean; status: "ACTIVE" | "DISABLED" | null; priceCents: number; storePriceCents: number | null; storeTaxGroupId: string | null; taxGroupName: string | null; taxRatePercent: number; stock: number; productTypeId?: string | null; productTypeName?: string; customFields?: Record<string, string | number | boolean> };

export type ChargeRow = { id: string; storeId: string | null; scope: "ORGANISATION" | "STORE"; name: string; kind: "FLAT" | "PERCENT"; applies: "PER_BILL" | "PER_ITEM"; amountCents: number | null; ratePercent: number | null; taxGroupId: string | null; taxGroupName: string | null; taxRatePercent: number; status: "ACTIVE" | "DISABLED" };
