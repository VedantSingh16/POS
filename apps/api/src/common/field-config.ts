import { BadRequestException } from '@nestjs/common';
import type { JsonObject } from './input.js';

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'YESNO', 'SELECT'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  active: boolean;
  order: number;
  helpText: string;
  options: string[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  storeEditable: boolean;
  showOnReceipt: boolean;
  showInList: boolean;
  level: 'PRODUCT' | 'VARIANT';
};
export type FieldSet = { version: 1; allowStoreFields: boolean; fields: FieldDefinition[]; coreFields: string[] };
export type StoreFieldSet = { version: 1; overrides: Record<string, Partial<FieldDefinition>>; fields: FieldDefinition[]; coreFields?: string[] };

export const CORE_PRODUCT_FIELDS = ['name', 'description', 'productType', 'attributes', 'brand', 'category', 'sku', 'barcode', 'price', 'cost', 'uom', 'status', 'openPrice', 'floorPrice', 'includesTax', 'variants'] as const;
export const CORE_CHECKOUT_FIELDS = ['customer', 'coupon', 'discount', 'discountReason', 'paymentReference', 'splitTender', 'itemNote', 'billHandler', 'tender', 'cashTendered'] as const;
const LOCKED_CORE_FIELDS = new Set(['name', 'category', 'sku', 'price', 'uom', 'status']);
const LOCKED_CHECKOUT_FIELDS = new Set(['billHandler', 'tender', 'cashTendered']);

const DEFAULT_PRODUCT_CORE_FIELDS = ['name', 'description', 'category', 'sku', 'barcode', 'price', 'cost', 'uom', 'status'];
const DEFAULT_FIELD_SET: FieldSet = { version: 1, allowStoreFields: false, fields: [], coreFields: DEFAULT_PRODUCT_CORE_FIELDS };
const DEFAULT_STORE_FIELD_SET: StoreFieldSet = { version: 1, overrides: {}, fields: [] };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

type FieldSetDomain = 'PRODUCT' | 'CHECKOUT';

export function cleanFieldSet(value: unknown, domain: FieldSetDomain = 'PRODUCT'): FieldSet {
  if (value === undefined || value === null) return { ...structuredClone(DEFAULT_FIELD_SET), coreFields: domain === 'PRODUCT' ? [...DEFAULT_PRODUCT_CORE_FIELDS] : [...CORE_CHECKOUT_FIELDS] };
  if (!record(value)) throw new BadRequestException('Field configuration must be an object');
  if (value.version !== undefined && value.version !== 1) throw new BadRequestException('Unsupported field configuration version');
  if (!Array.isArray(value.fields) || value.fields.length > 30) throw new BadRequestException('Configure at most 30 fields');
  if (value.allowStoreFields !== undefined && typeof value.allowStoreFields !== 'boolean') throw new BadRequestException('allowStoreFields must be true or false');
  const fields = value.fields.map((item, index) => {
    const definition = cleanDefinition(item, index);
    return domain === 'PRODUCT' ? { ...definition, storeEditable: false } : definition;
  });
  const keys = fields.map((item) => item.key);
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Field keys must be unique');
  const coreFields = value.coreFields === undefined ? [...(domain === 'PRODUCT' ? DEFAULT_PRODUCT_CORE_FIELDS : coreKeys(domain))] : cleanCoreFields(value.coreFields, 'coreFields', domain);
  for (const locked of lockedCoreKeys(domain)) if (!coreFields.includes(locked)) coreFields.push(locked);
  return { version: 1, allowStoreFields: domain === 'CHECKOUT' && value.allowStoreFields === true, fields: fields.sort((a, b) => a.order - b.order), coreFields };
}

export function cleanStoreFieldSet(value: unknown, organization: FieldSet, domain: FieldSetDomain = 'PRODUCT'): StoreFieldSet {
  if (value === undefined || value === null) return structuredClone(DEFAULT_STORE_FIELD_SET);
  if (!record(value)) throw new BadRequestException('Store field configuration must be an object');
  if (value.version !== undefined && value.version !== 1) throw new BadRequestException('Unsupported store field configuration version');
  const incoming = value.overrides === undefined ? {} : value.overrides;
  if (!record(incoming)) throw new BadRequestException('Store field overrides must be an object');
  if (domain === 'PRODUCT') {
    if (Object.keys(incoming).length || (Array.isArray(value.fields) && value.fields.length) || value.coreFields !== undefined) {
      throw new BadRequestException('Product field schemas are owned by the organisation and cannot be changed by a store.');
    }
    return structuredClone(DEFAULT_STORE_FIELD_SET);
  }
  if (value.fields !== undefined && !Array.isArray(value.fields)) throw new BadRequestException('Store-specific fields must be a list');
  const definitions = new Map(organization.fields.map((field) => [field.key, field]));
  const overrides: StoreFieldSet['overrides'] = {};
  for (const [key, raw] of Object.entries(incoming)) {
    const definition = definitions.get(key);
    if (!definition || !definition.storeEditable) throw new BadRequestException(`Field ${key} is locked by the organisation`);
    if (!record(raw)) throw new BadRequestException(`Override for ${key} must be an object`);
    const allowed: readonly (keyof FieldDefinition)[] = ['label', 'required', 'active', 'order', 'helpText', 'showOnReceipt', 'showInList'];
    const cleaned: Record<string, unknown> = {};
    for (const field of allowed) {
      const item = raw[field];
      if (item === undefined) continue;
      if (field === 'label' || field === 'helpText') {
        if (typeof item !== 'string' || item.length > (field === 'label' ? 80 : 240)) throw new BadRequestException(`${field} for ${key} is invalid`);
        cleaned[field] = item.trim();
      } else if (field === 'order') {
        if (!Number.isInteger(item) || (item as number) < 0 || (item as number) > 10000) throw new BadRequestException(`order for ${key} must be a whole number from 0 to 10000`);
        cleaned.order = item as number;
      } else {
        if (typeof item !== 'boolean') throw new BadRequestException(`${field} for ${key} must be true or false`);
        cleaned[field] = item;
      }
    }
    if (Object.keys(raw).some((field) => !allowed.includes(field as (typeof allowed)[number]))) throw new BadRequestException(`Store cannot change the type or options of ${key}`);
    overrides[key] = cleaned as Partial<FieldDefinition>;
  }
  if (!organization.allowStoreFields && Array.isArray(value.fields) && value.fields.length) throw new BadRequestException('The organisation has not allowed store-specific fields');
  if (value.coreFields !== undefined && !organization.allowStoreFields) throw new BadRequestException('The organisation has not allowed stores to customize standard checkout fields');
  const fields = !organization.allowStoreFields ? [] : (Array.isArray(value.fields) ? value.fields : []).map((item, index) => ({ ...cleanDefinition(item, index), storeEditable: false }));
  if (fields.length > 30) throw new BadRequestException('Configure at most 30 store-specific fields');
  const keys = [...organization.fields.map((item) => item.key), ...fields.map((item) => item.key)];
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Store-specific field keys must be unique across organisation and store fields');
  // Keep accepting older stored configs, but product standard fields always inherit
  // the organization's visibility and cannot be hidden at store scope.
  const coreFields = domain === 'CHECKOUT' && value.coreFields !== undefined ? cleanCoreFields(value.coreFields, 'store coreFields', domain) : undefined;
  if (coreFields) for (const locked of lockedCoreKeys(domain)) if (!coreFields.includes(locked)) coreFields.push(locked);
  return { version: 1, overrides, fields: fields.sort((a, b) => a.order - b.order), ...(coreFields ? { coreFields } : {}) };
}

function cleanDefinition(value: unknown, index: number): FieldDefinition {
  if (!record(value)) throw new BadRequestException(`Field ${index + 1} must be an object`);
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new BadRequestException(`Field ${index + 1} needs a key using lowercase letters, numbers, or underscores`);
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label || label.length > 80) throw new BadRequestException(`Field ${key} needs a label of at most 80 characters`);
  if (typeof value.type !== 'string' || !FIELD_TYPES.includes(value.type as FieldType)) throw new BadRequestException(`Field ${key} has an unsupported type`);
  for (const flag of ['required', 'active', 'storeEditable', 'showOnReceipt', 'showInList'] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new BadRequestException(`${flag} for ${key} must be true or false`);
  }
  if (value.level !== undefined && value.level !== 'PRODUCT' && value.level !== 'VARIANT') throw new BadRequestException(`Field ${key} must apply to PRODUCT or VARIANT`);
  const type = value.type as FieldType;
  const options = value.options === undefined ? [] : value.options;
  if (!Array.isArray(options) || options.length > 40 || options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 80)) throw new BadRequestException(`Options for ${key} are invalid`);
  const uniqueOptions = [...new Set((options as string[]).map((option) => option.trim()))];
  if (type === 'SELECT' && uniqueOptions.length < 1) throw new BadRequestException(`Select field ${key} needs at least one option`);
  const order = value.order === undefined ? index : value.order;
  if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > 10000) throw new BadRequestException(`Order for ${key} must be a whole number from 0 to 10000`);
  const min = value.min === undefined || value.min === null || value.min === '' ? undefined : Number(value.min);
  const max = value.max === undefined || value.max === null || value.max === '' ? undefined : Number(value.max);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max)) || (min !== undefined && max !== undefined && min > max)) throw new BadRequestException(`Minimum or maximum for ${key} is invalid`);
  const definition: FieldDefinition = {
    key, label, type, required: value.required === true, active: value.active !== false,
    order: order as number,
    helpText: typeof value.helpText === 'string' ? value.helpText.slice(0, 240) : '',
    options: uniqueOptions, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
    storeEditable: value.storeEditable === true, showOnReceipt: value.showOnReceipt === true,
    showInList: value.showInList === true,
    level: value.level === 'VARIANT' ? 'VARIANT' : 'PRODUCT',
  };
  if (value.defaultValue !== undefined) {
    const normalized = cleanFieldValues([{ ...definition, required: false }], { [key]: value.defaultValue })[key];
    if (normalized === undefined || normalized === '') throw new BadRequestException(`Default value for ${key} must not be empty`);
    definition.defaultValue = normalized;
  }
  return definition;
}

export function resolveFields(organization: FieldSet, store?: StoreFieldSet, domain: FieldSetDomain = 'PRODUCT'): FieldSet {
  const overrides = store?.overrides ?? {};
  const inherited = organization.fields.map((field) => ({ ...field, ...(field.storeEditable ? overrides[field.key] : {}) }));
  return {
    version: 1,
    allowStoreFields: organization.allowStoreFields,
    fields: [...inherited, ...(organization.allowStoreFields ? store?.fields ?? [] : [])].filter((field) => field.active).sort((a, b) => a.order - b.order),
    coreFields: domain === 'CHECKOUT' && store?.coreFields
      ? organization.coreFields.filter((key) => store.coreFields?.includes(key))
      : organization.coreFields,
  };
}

function coreKeys(domain: FieldSetDomain): readonly string[] {
  return domain === 'CHECKOUT' ? CORE_CHECKOUT_FIELDS : CORE_PRODUCT_FIELDS;
}

function lockedCoreKeys(domain: FieldSetDomain): ReadonlySet<string> {
  return domain === 'CHECKOUT' ? LOCKED_CHECKOUT_FIELDS : LOCKED_CORE_FIELDS;
}

function cleanCoreFields(value: unknown, name: string, domain: FieldSetDomain): string[] {
  const allowed = coreKeys(domain);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.includes(item))) throw new BadRequestException(`${name} must be a list of supported ${domain === 'CHECKOUT' ? 'checkout' : 'product'} field keys`);
  return [...new Set(value as string[])];
}

export function cleanFieldValues(fields: FieldDefinition[], value: unknown, options: { preserveUnknown?: boolean } = {}): Record<string, string | number | boolean> {
  if (value === undefined || value === null) value = {};
  if (!record(value)) throw new BadRequestException('Custom field values must be an object');
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const cleaned: Record<string, string | number | boolean> = options.preserveUnknown ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) as Record<string, string | number | boolean> : {};
  for (const key of Object.keys(value)) if (!byKey.has(key) && !options.preserveUnknown) throw new BadRequestException(`Unknown custom field: ${key}`);
  for (const field of fields) {
    if (!field.active) continue;
    const supplied = value[field.key];
    const raw = supplied === undefined || supplied === null || supplied === '' ? field.defaultValue : supplied;
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      delete cleaned[field.key];
      if (field.required) throw new BadRequestException(`${field.label} is required`);
      continue;
    }
    let result: string | number | boolean;
    switch (field.type) {
      case 'TEXT':
        if (typeof raw !== 'string' || raw.length > 500) throw new BadRequestException(`${field.label} must be text of at most 500 characters`);
        result = raw.trim();
        if (field.required && !result) throw new BadRequestException(`${field.label} is required`);
        break;
      case 'NUMBER':
        if (typeof raw !== 'number' || !Number.isFinite(raw) || (field.min !== undefined && raw < field.min) || (field.max !== undefined && raw > field.max)) throw new BadRequestException(`${field.label} must be a valid number${field.min !== undefined || field.max !== undefined ? ` between ${field.min ?? '-∞'} and ${field.max ?? '∞'}` : ''}`);
        result = raw;
        break;
      case 'DATE':
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) throw new BadRequestException(`${field.label} must be a YYYY-MM-DD date`);
        result = raw;
        break;
      case 'YESNO':
        if (typeof raw !== 'boolean') throw new BadRequestException(`${field.label} must be yes or no`);
        result = raw;
        break;
      case 'SELECT':
        if (typeof raw !== 'string' || !field.options.includes(raw)) throw new BadRequestException(`${field.label} must be one of the configured options`);
        result = raw;
        break;
    }
    cleaned[field.key] = result;
  }
  return cleaned;
}

export function objectField(value: unknown): JsonObject {
  return record(value) ? value as JsonObject : {};
}
