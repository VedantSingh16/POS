-- Plan 11: move billing, checkout configuration, promotions, tax groups, and discounts to store scope.
-- Historical sale snapshots are intentionally not modified.

BEGIN;

ALTER TABLE "tax_groups" ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "promotions" ADD COLUMN "store_id" UUID;
ALTER TABLE "discount_reasons" ADD COLUMN "store_id" UUID;

ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_reasons"
  ADD CONSTRAINT "discount_reasons_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "tax_groups_organization_id_code_key";
CREATE UNIQUE INDEX "tax_groups_organization_id_store_id_code_key"
  ON "tax_groups"("organization_id", "store_id", "code");
CREATE INDEX "tax_groups_organization_id_store_id_status_idx"
  ON "tax_groups"("organization_id", "store_id", "status");

DROP INDEX "promotions_organization_id_code_key";
CREATE UNIQUE INDEX "promotions_organization_id_store_id_code_key"
  ON "promotions"("organization_id", "store_id", "code");
CREATE INDEX "promotions_organization_id_store_id_status_idx"
  ON "promotions"("organization_id", "store_id", "status");

DROP INDEX "discount_reasons_organization_id_code_key";
CREATE UNIQUE INDEX "discount_reasons_organization_id_store_id_code_key"
  ON "discount_reasons"("organization_id", "store_id", "code");
CREATE INDEX "discount_reasons_organization_id_store_id_status_idx"
  ON "discount_reasons"("organization_id", "store_id", "status");
CREATE INDEX "price_rules_organization_id_store_id_status_idx"
  ON "price_rules"("organization_id", "store_id", "status");

-- Keep durable diagnostics for records that need an operator's attention.
CREATE TABLE "plan11_migration_conflicts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "store_id" UUID,
  "object_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan11_migration_conflicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "plan11_migration_conflicts_organization_id_store_id_idx"
  ON "plan11_migration_conflicts"("organization_id", "store_id");

-- Product-field schemas and values that used to live at store scope remain archived for review.
INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT s."organization_id", s."id", 'LEGACY_STORE_PRODUCT_FIELD_SCHEMA', s."id",
  jsonb_build_object(
    'fieldCount', jsonb_array_length(COALESCE(s."field_settings" -> 'productFields' -> 'fields', '[]'::jsonb)),
    'fieldKeys', COALESCE((SELECT jsonb_agg(field ->> 'key') FROM jsonb_array_elements(COALESCE(s."field_settings" -> 'productFields' -> 'fields', '[]'::jsonb)) AS field), '[]'::jsonb),
    'preservedAt', 'stores.field_settings.legacyProductFieldSettings'
  )
FROM "stores" s
WHERE s."field_settings" ? 'productFields';

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT sv."organization_id", sv."store_id", 'LEGACY_STORE_VARIANT_PRODUCT_FIELD_VALUES', sv."id",
  jsonb_build_object(
    'variantId', sv."variant_id",
    'fieldKeys', COALESCE((SELECT jsonb_agg(key) FROM jsonb_object_keys(sv."custom_fields") AS keys(key)), '[]'::jsonb),
    'preservedOn', 'store_variants.custom_fields'
  )
FROM "store_variants" sv
WHERE jsonb_typeof(sv."custom_fields") = 'object' AND sv."custom_fields" <> '{}'::jsonb;

-- Materialize the old organization defaults + store overrides into a full value for every store.
WITH defaults("key", "value") AS (
  VALUES
    ('receiptFooter', '""'::jsonb),
    ('enabledTenders', '["CASH","CARD","UPI"]'::jsonb),
    ('cashRounding', '0'::jsonb),
    ('requireDiscountReasonCode', 'false'::jsonb),
    ('holdTtlHours', '24'::jsonb),
    ('pointValueCents', '1'::jsonb),
    ('cashMovementApprovalCents', '0'::jsonb),
    ('cashVarianceToleranceCents', '0'::jsonb),
    ('requireBillHandler', 'false'::jsonb),
    ('lineDiscountEnabled', 'true'::jsonb),
    ('billDiscountEnabled', 'true'::jsonb),
    ('lineDiscountMaxPercent', '100'::jsonb),
    ('billDiscountMaxPercent', '100'::jsonb),
    ('allowDiscountStacking', 'true'::jsonb)
), effective AS (
  SELECT s."id", d."key",
    COALESCE(NULLIF(s."billing_settings" -> d."key", 'null'::jsonb),
             NULLIF(os."settings" -> d."key", 'null'::jsonb), d."value") AS "value"
  FROM "stores" s
  LEFT JOIN "organization_settings" os ON os."organization_id" = s."organization_id"
  CROSS JOIN defaults d
)
UPDATE "stores" s
SET "billing_settings" = configured."billing"
FROM (
  SELECT "id", jsonb_object_agg("key", "value") AS "billing"
  FROM effective
  GROUP BY "id"
) configured
WHERE s."id" = configured."id";

-- Copy the effective checkout controls into the store. Keep the former local product schema in an archive key;
-- StoreVariant.custom_fields are left intact as legacy values and are not merged into the organization catalog.
WITH sources AS (
  SELECT s."id",
    COALESCE(NULLIF(os."settings" -> 'checkoutFields', 'null'::jsonb),
      '{"version":1,"allowStoreFields":false,"fields":[],"coreFields":["customer","coupon","discount","discountReason","paymentReference","splitTender","itemNote","billHandler","tender","cashTendered"]}'::jsonb) AS "organization_checkout",
    COALESCE(NULLIF(s."field_settings" -> 'checkoutFields', 'null'::jsonb), '{}'::jsonb) AS "store_checkout",
    s."field_settings"
  FROM "stores" s
  LEFT JOIN "organization_settings" os ON os."organization_id" = s."organization_id"
), built AS (
  SELECT src."id",
    COALESCE((
      SELECT jsonb_agg(field || COALESCE(src."store_checkout" -> 'overrides' -> (field ->> 'key'), '{}'::jsonb))
      FROM jsonb_array_elements(COALESCE(src."organization_checkout" -> 'fields', '[]'::jsonb)) AS field
    ), '[]'::jsonb) || COALESCE(src."store_checkout" -> 'fields', '[]'::jsonb) AS "fields",
    COALESCE(src."store_checkout" -> 'coreFields', src."organization_checkout" -> 'coreFields',
      '["customer","coupon","discount","discountReason","paymentReference","splitTender","itemNote","billHandler","tender","cashTendered"]'::jsonb) AS "core_fields",
    src."field_settings"
  FROM sources src
)
UPDATE "stores" s
SET "field_settings" =
  (built."field_settings" - 'productFields') ||
  jsonb_strip_nulls(jsonb_build_object('legacyProductFieldSettings', built."field_settings" -> 'productFields')) ||
  jsonb_build_object('checkoutFields', jsonb_build_object(
    'version', 1,
    'allowStoreFields', true,
    'fields', built."fields",
    'coreFields', built."core_fields"
  ))
FROM built
WHERE s."id" = built."id";

-- Store product definitions are organization-owned. Disable old local customization metadata without deleting values.
UPDATE "organization_settings" os
SET "settings" =
  (os."settings" - ARRAY[
    'receiptFooter', 'enabledTenders', 'cashRounding', 'requireDiscountReasonCode', 'holdTtlHours',
    'pointValueCents', 'cashMovementApprovalCents', 'cashVarianceToleranceCents', 'requireBillHandler',
    'lineDiscountEnabled', 'billDiscountEnabled', 'lineDiscountMaxPercent', 'billDiscountMaxPercent',
    'allowDiscountStacking', 'checkoutFields'
  ]) || jsonb_strip_nulls(jsonb_build_object(
    'legacyStoreOwnedSettings', jsonb_strip_nulls(jsonb_build_object(
      'receiptFooter', os."settings" -> 'receiptFooter',
      'enabledTenders', os."settings" -> 'enabledTenders',
      'cashRounding', os."settings" -> 'cashRounding',
      'requireDiscountReasonCode', os."settings" -> 'requireDiscountReasonCode',
      'holdTtlHours', os."settings" -> 'holdTtlHours',
      'pointValueCents', os."settings" -> 'pointValueCents',
      'cashMovementApprovalCents', os."settings" -> 'cashMovementApprovalCents',
      'cashVarianceToleranceCents', os."settings" -> 'cashVarianceToleranceCents',
      'requireBillHandler', os."settings" -> 'requireBillHandler',
      'lineDiscountEnabled', os."settings" -> 'lineDiscountEnabled',
      'billDiscountEnabled', os."settings" -> 'billDiscountEnabled',
      'lineDiscountMaxPercent', os."settings" -> 'lineDiscountMaxPercent',
      'billDiscountMaxPercent', os."settings" -> 'billDiscountMaxPercent',
      'allowDiscountStacking', os."settings" -> 'allowDiscountStacking',
      'checkoutFields', os."settings" -> 'checkoutFields'
    )),
    'productFields', CASE
      WHEN jsonb_typeof(os."settings" -> 'productFields') = 'object' THEN
        jsonb_set(
          jsonb_set(os."settings" -> 'productFields', '{fields}', COALESCE((
            SELECT jsonb_agg(field || '{"storeEditable":false}'::jsonb)
            FROM jsonb_array_elements(COALESCE(os."settings" -> 'productFields' -> 'fields', '[]'::jsonb)) AS field
          ), '[]'::jsonb)),
          '{coreFields}', COALESCE(os."settings" -> 'productFields' -> 'coreFields', '[]'::jsonb) - 'taxGroup'
        ) || '{"allowStoreFields":false}'::jsonb
      ELSE NULL
    END
  ));

-- Product-type schema no longer controls tax ownership.
UPDATE "product_types"
SET "config" = "config" - 'requireTaxGroup'
WHERE jsonb_typeof("config") = 'object' AND "config" ? 'requireTaxGroup';

-- Copy every legacy organization tax group per store, using unique migration codes while retaining names/rates/HSN.
CREATE TEMP TABLE "plan11_tax_group_map" (
  "source_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  CONSTRAINT "plan11_tax_group_map_pkey" PRIMARY KEY ("source_id", "store_id")
) ON COMMIT DROP;

INSERT INTO "plan11_tax_group_map" ("source_id", "store_id", "target_id")
SELECT tg."id", s."id", gen_random_uuid()
FROM "tax_groups" tg
JOIN "stores" s ON s."organization_id" = tg."organization_id"
WHERE tg."store_id" IS NULL;

INSERT INTO "tax_groups" ("id", "organization_id", "store_id", "code", "name", "hsn_code", "rate_bps", "includes_tax", "status", "created_at", "updated_at")
SELECT map."target_id", old."organization_id", map."store_id",
  'MIG_' || old."code" || '_' || right(replace(old."id"::text, '-', ''), 8),
  old."name", old."hsn_code", old."rate_bps", old."includes_tax", 'ACTIVE', old."created_at", CURRENT_TIMESTAMP
FROM "plan11_tax_group_map" map
JOIN "tax_groups" old ON old."id" = map."source_id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT duplicates."organization_id", duplicates."store_id", 'DUPLICATE_STORE_TAX_GROUP_NAME', duplicates."first_id",
  jsonb_build_object('name', duplicates."name", 'taxGroupIds', duplicates."ids")
FROM (
  SELECT "organization_id", "store_id", lower("name") AS "name", (array_agg("id" ORDER BY "id"))[1] AS "first_id", jsonb_agg("id") AS "ids"
  FROM "tax_groups"
  WHERE "store_id" IS NOT NULL
  GROUP BY "organization_id", "store_id", lower("name")
  HAVING count(*) > 1
) duplicates;

UPDATE "store_variants" sv
SET "tax_group_id" = map."target_id"
FROM "tax_groups" old, "plan11_tax_group_map" map
WHERE sv."tax_group_id" = old."id" AND old."store_id" IS NULL
  AND map."source_id" = old."id" AND map."store_id" = sv."store_id";

UPDATE "store_variants" sv
SET "tax_group_id" = map."target_id"
FROM "product_variants" pv, "tax_groups" old, "plan11_tax_group_map" map
WHERE sv."tax_group_id" IS NULL AND pv."id" = sv."variant_id"
  AND pv."tax_group_id" = old."id" AND old."store_id" IS NULL
  AND map."source_id" = old."id" AND map."store_id" = sv."store_id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT tg."organization_id", sv."store_id", 'STORE_VARIANT_TAX_GROUP_CROSS_STORE', sv."id",
  jsonb_build_object('taxGroupId', tg."id", 'taxGroupStoreId', tg."store_id", 'variantId', sv."variant_id")
FROM "store_variants" sv
JOIN "tax_groups" tg ON tg."id" = sv."tax_group_id"
WHERE tg."store_id" IS NOT NULL AND tg."store_id" <> sv."store_id";

UPDATE "store_variants" sv SET "tax_group_id" = NULL
FROM "tax_groups" tg
WHERE tg."id" = sv."tax_group_id" AND tg."store_id" IS NOT NULL AND tg."store_id" <> sv."store_id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT sv."organization_id", sv."store_id", 'ACTIVE_STORE_VARIANT_WITHOUT_TAX_GROUP', sv."id",
  jsonb_build_object('variantId', sv."variant_id", 'status', sv."status")
FROM "store_variants" sv
WHERE sv."status" = 'ACTIVE' AND sv."tax_group_id" IS NULL;

UPDATE "distribution_lines" dl
SET "suggested_tax_group_id" = map."target_id"
FROM "distributions" d, "tax_groups" old, "plan11_tax_group_map" map
WHERE d."id" = dl."distribution_id" AND old."id" = dl."suggested_tax_group_id"
  AND old."store_id" IS NULL AND map."source_id" = old."id" AND map."store_id" = d."to_store_id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT d."organization_id", d."to_store_id", 'DISTRIBUTION_TAX_GROUP_CROSS_STORE', dl."id",
  jsonb_build_object('taxGroupId', tg."id", 'taxGroupStoreId', tg."store_id")
FROM "distribution_lines" dl
JOIN "distributions" d ON d."id" = dl."distribution_id"
JOIN "tax_groups" tg ON tg."id" = dl."suggested_tax_group_id"
WHERE tg."store_id" IS NOT NULL AND tg."store_id" <> d."to_store_id";

UPDATE "distribution_lines" dl SET "suggested_tax_group_id" = NULL
FROM "distributions" d, "tax_groups" tg
WHERE d."id" = dl."distribution_id" AND tg."id" = dl."suggested_tax_group_id"
  AND tg."store_id" IS NOT NULL AND tg."store_id" <> d."to_store_id";

-- Copy organization-wide additional charges to each store. Store-specific tax groups stay local.
INSERT INTO "charges" ("id", "organization_id", "store_id", "name", "kind", "scope", "value", "tax_group_id", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), old."organization_id", s."id", old."name", old."kind", old."scope", old."value",
  CASE
    WHEN tax."store_id" IS NULL THEN tax_map."target_id"
    WHEN tax."store_id" = s."id" THEN tax."id"
    ELSE NULL
  END,
  old."status", old."created_at", CURRENT_TIMESTAMP
FROM "charges" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
LEFT JOIN "tax_groups" tax ON tax."id" = old."tax_group_id"
LEFT JOIN "plan11_tax_group_map" tax_map ON tax_map."source_id" = tax."id" AND tax_map."store_id" = s."id"
WHERE old."store_id" IS NULL;

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT old."organization_id", s."id", 'GLOBAL_CHARGE_CROSS_STORE_TAX_GROUP', old."id",
  jsonb_build_object('taxGroupId', tax."id", 'taxGroupStoreId', tax."store_id", 'chargeName', old."name")
FROM "charges" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
JOIN "tax_groups" tax ON tax."id" = old."tax_group_id"
WHERE old."store_id" IS NULL AND tax."store_id" IS NOT NULL AND tax."store_id" <> s."id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT c."organization_id", c."store_id", 'STORE_CHARGE_CROSS_STORE_TAX_GROUP', c."id",
  jsonb_build_object('taxGroupId', tg."id", 'taxGroupStoreId', tg."store_id", 'chargeName', c."name")
FROM "charges" c JOIN "tax_groups" tg ON tg."id" = c."tax_group_id"
WHERE c."store_id" IS NOT NULL AND tg."store_id" IS NOT NULL AND tg."store_id" <> c."store_id";

UPDATE "charges" c SET "tax_group_id" = NULL
FROM "tax_groups" tg
WHERE tg."id" = c."tax_group_id" AND c."store_id" IS NOT NULL
  AND tg."store_id" IS NOT NULL AND tg."store_id" <> c."store_id";

-- Clone organization price rules to each store before retiring the organization-wide rows.
INSERT INTO "price_rules" ("id", "organization_id", "name", "priority", "scope", "scope_id", "store_id", "customer_group", "min_quantity", "starts_at", "ends_at", "mode", "value", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), old."organization_id", old."name", old."priority", old."scope", old."scope_id", s."id", old."customer_group", old."min_quantity", old."starts_at", old."ends_at", old."mode", old."value", old."status", old."created_at", CURRENT_TIMESTAMP
FROM "price_rules" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
WHERE old."store_id" IS NULL;

-- Clone reason codes unless a store already owns the same code; record collisions for manual resolution.
INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT old."organization_id", s."id", 'DISCOUNT_REASON_CODE_COLLISION', old."id",
  jsonb_build_object('code', old."code", 'existingReasonId', local."id", 'organizationReasonName', old."name", 'storeReasonName', local."name")
FROM "discount_reasons" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
JOIN "discount_reasons" local ON local."organization_id" = old."organization_id" AND local."store_id" = s."id" AND local."code" = old."code"
WHERE old."store_id" IS NULL;

INSERT INTO "discount_reasons" ("id", "organization_id", "store_id", "code", "name", "status", "created_at")
SELECT gen_random_uuid(), old."organization_id", s."id", old."code", old."name", old."status", old."created_at"
FROM "discount_reasons" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
WHERE old."store_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "discount_reasons" local WHERE local."organization_id" = old."organization_id" AND local."store_id" = s."id" AND local."code" = old."code");

-- Clone global promotions per store. Redemptions are moved to their store copy so use counts and customer limits stay local.
CREATE TEMP TABLE "plan11_promotion_map" (
  "source_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  CONSTRAINT "plan11_promotion_map_pkey" PRIMARY KEY ("source_id", "store_id")
) ON COMMIT DROP;

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT old."organization_id", s."id", 'PROMOTION_CODE_COLLISION', old."id",
  jsonb_build_object('code', old."code", 'existingPromotionId', local."id", 'organizationPromotionType', old."type", 'organizationPromotionValue', old."value", 'storePromotionType', local."type", 'storePromotionValue', local."value")
FROM "promotions" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
JOIN "promotions" local ON local."organization_id" = old."organization_id" AND local."store_id" = s."id" AND local."code" = old."code"
WHERE old."store_id" IS NULL;

INSERT INTO "plan11_promotion_map" ("source_id", "store_id", "target_id")
SELECT old."id", s."id", gen_random_uuid()
FROM "promotions" old
JOIN "stores" s ON s."organization_id" = old."organization_id"
WHERE old."store_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "promotions" local WHERE local."organization_id" = old."organization_id" AND local."store_id" = s."id" AND local."code" = old."code");

INSERT INTO "promotions" ("id", "organization_id", "store_id", "code", "type", "value", "min_subtotal_cents", "usage_limit", "usage_count", "starts_at", "ends_at", "status", "scope", "scope_id", "auto_apply", "priority", "stackable", "per_customer_limit")
SELECT map."target_id", old."organization_id", map."store_id", old."code", old."type", old."value", old."min_subtotal_cents", old."usage_limit",
  (SELECT count(*)::integer FROM "promotion_redemptions" redemption JOIN "sales" sale ON sale."id" = redemption."sale_id" WHERE redemption."promotion_id" = old."id" AND sale."store_id" = map."store_id"),
  old."starts_at", old."ends_at", old."status", old."scope", old."scope_id", old."auto_apply", old."priority", old."stackable", old."per_customer_limit"
FROM "plan11_promotion_map" map
JOIN "promotions" old ON old."id" = map."source_id";

UPDATE "promotion_redemptions" redemption
SET "promotion_id" = map."target_id"
FROM "sales" sale, "plan11_promotion_map" map
WHERE sale."id" = redemption."sale_id" AND map."source_id" = redemption."promotion_id" AND map."store_id" = sale."store_id";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT old."organization_id", NULL, 'PROMOTION_USAGE_COUNT_RECONCILIATION', old."id",
  jsonb_build_object('code', old."code", 'storedUsageCount', old."usage_count", 'redemptionRows', counts."redemption_count", 'policy', 'Store copies use redemption counts for this store; unresolved aggregate usage is not assigned to one store.')
FROM "promotions" old
LEFT JOIN LATERAL (SELECT count(*)::integer AS "redemption_count" FROM "promotion_redemptions" r WHERE r."promotion_id" = old."id") counts ON true
WHERE old."store_id" IS NULL AND old."usage_count" <> counts."redemption_count";

INSERT INTO "plan11_migration_conflicts" ("organization_id", "store_id", "object_type", "source_id", "details")
SELECT old."organization_id", NULL, 'PROMOTION_USAGE_LIMIT_SCOPE_CHANGE', old."id",
  jsonb_build_object('code', old."code", 'usageLimit', old."usage_limit", 'policy', 'Usage limits are now enforced independently for each store copy.')
FROM "promotions" old
WHERE old."store_id" IS NULL AND old."usage_limit" IS NOT NULL;

-- Old organization-owned rows are retained as disabled audit data; runtime reads now require a store id.
UPDATE "tax_groups" SET "status" = 'DISABLED' WHERE "store_id" IS NULL;
UPDATE "charges" SET "status" = 'DISABLED' WHERE "store_id" IS NULL;
UPDATE "price_rules" SET "status" = 'DISABLED' WHERE "store_id" IS NULL;
UPDATE "discount_reasons" SET "status" = 'DISABLED' WHERE "store_id" IS NULL;
UPDATE "promotions" SET "status" = 'DISABLED' WHERE "store_id" IS NULL;

-- Make sure existing Store Manager roles can configure their store-owned tax groups.
INSERT INTO "role_permissions" ("role_id", "permission_code", "effect")
SELECT r."id", p."code", 'ALLOW'::"PermissionEffect"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."is_system" = true AND r."name" = 'Store Manager' AND p."code" IN ('tax.view', 'tax.manage')
ON CONFLICT ("role_id", "permission_code") DO NOTHING;

COMMIT;
