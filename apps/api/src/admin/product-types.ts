import { BadRequestException } from '@nestjs/common';
import type { JsonObject } from '../common/input.js';

export type AttributeKind = 'TEXT' | 'NUMBER' | 'SELECT' | 'DATE' | 'YESNO';
export type AttributeDef = { key: string; label: string; kind: AttributeKind; required: boolean; options: string[] };
export type TypeConfig = {
  /** Categories products of this type may use. Empty = any. */
  categoryIds: string[];
  /** Brands products of this type may use. Empty = any. */
  brandIds: string[];
  requireCategory: boolean;
  requireBrand: boolean;
  requireBarcode: boolean;
  attributes: AttributeDef[];
};

const KINDS: AttributeKind[] = ['TEXT', 'NUMBER', 'SELECT', 'DATE', 'YESNO'];
const KEY = /^[a-z][a-z0-9_]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !UUID.test(entry))) throw new BadRequestException(`${field} must be a list of ids`);
  return [...new Set(value as string[])];
}

/** Turns what the screen sent into a clean config, or explains what is wrong. Existence of the ids is checked by the caller. */
export function cleanTypeConfig(raw: unknown): TypeConfig {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as JsonObject;
  const attributes: AttributeDef[] = [];
  const list = input.attributes === undefined ? [] : input.attributes;
  if (!Array.isArray(list) || list.length > 20) throw new BadRequestException('A product type can have at most 20 extra fields');
  for (const entry of list as JsonObject[]) {
    const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
    if (!label) throw new BadRequestException('Every extra field needs a label');
    const key = typeof entry.key === 'string' && entry.key ? entry.key : label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 32);
    if (!KEY.test(key)) throw new BadRequestException(`"${label}" cannot be turned into a field key; use letters and numbers`);
    if (attributes.some((attribute) => attribute.key === key)) throw new BadRequestException(`Two extra fields share the key "${key}"`);
    const kind = KINDS.includes(entry.kind as AttributeKind) ? (entry.kind as AttributeKind) : 'TEXT';
    const options = kind === 'SELECT' ? [...new Set((Array.isArray(entry.options) ? entry.options : []).map((option) => String(option).trim()).filter(Boolean))] : [];
    if (kind === 'SELECT' && options.length === 0) throw new BadRequestException(`"${label}" is a choice field, so it needs at least one option`);
    attributes.push({ key, label, kind, required: entry.required === true, options });
  }
  return {
    categoryIds: ids(input.categoryIds, 'categoryIds'),
    brandIds: ids(input.brandIds, 'brandIds'),
    requireCategory: input.requireCategory === true,
    requireBrand: input.requireBrand === true,
    requireBarcode: input.requireBarcode === true,
    attributes,
  };
}

/** Reads a stored config back into a full object (older rows may miss keys). */
export function readTypeConfig(raw: unknown): TypeConfig {
  try { return cleanTypeConfig(raw); } catch { return cleanTypeConfig({}); }
}

/** Checks a product's extra-field values against its type. Returns the cleaned values. */
export function cleanAttributeValues(config: TypeConfig, raw: unknown): Record<string, string | number | boolean> {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as JsonObject;
  const known = new Set(config.attributes.map((attribute) => attribute.key));
  for (const key of Object.keys(input)) if (!known.has(key)) throw new BadRequestException(`"${key}" is not a field of this product type`);
  const out: Record<string, string | number | boolean> = {};
  for (const attribute of config.attributes) {
    const value = input[attribute.key];
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (attribute.required) throw new BadRequestException(`${attribute.label} is required for this product type`);
      continue;
    }
    switch (attribute.kind) {
      case 'NUMBER': {
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(number)) throw new BadRequestException(`${attribute.label} must be a number`);
        out[attribute.key] = number;
        break;
      }
      case 'SELECT':
        if (typeof value !== 'string' || !attribute.options.includes(value)) throw new BadRequestException(`${attribute.label} must be one of: ${attribute.options.join(', ')}`);
        out[attribute.key] = value;
        break;
      case 'DATE':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${attribute.label} must be a date (YYYY-MM-DD)`);
        out[attribute.key] = value;
        break;
      case 'YESNO':
        if (typeof value !== 'boolean') throw new BadRequestException(`${attribute.label} must be yes or no`);
        out[attribute.key] = value;
        break;
      default:
        if (typeof value !== 'string' || value.length > 500) throw new BadRequestException(`${attribute.label} must be text of at most 500 characters`);
        out[attribute.key] = value.trim();
    }
  }
  return out;
}
