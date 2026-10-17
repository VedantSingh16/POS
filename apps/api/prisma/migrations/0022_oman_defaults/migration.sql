-- Oman becomes the default market for new organisations and stores. Existing rows keep their saved values.
ALTER TABLE "stores"
  ADD COLUMN "address_details" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "organizations"
  ADD COLUMN "address_details" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "tax_regime" TEXT NOT NULL DEFAULT 'VAT';

UPDATE "organizations" SET "tax_regime" = CASE
  WHEN "country_code" = 'IN' THEN 'GST'
  WHEN "country_code" IN ('QA', 'KW', 'US', 'ZZ') THEN 'TAX'
  ELSE 'VAT'
END;

ALTER TABLE "stores"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Muscat';

ALTER TABLE "organizations"
  ALTER COLUMN "country_code" SET DEFAULT 'OM',
  ALTER COLUMN "currency" SET DEFAULT 'OMR',
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Muscat';

ALTER TABLE "variant_prices"
  ALTER COLUMN "currency" SET DEFAULT 'OMR';

-- Preserve the earlier visible product fields for organisations already in the database.
INSERT INTO "organization_settings" ("organization_id", "settings", "updated_at")
SELECT o."id", jsonb_build_object('productFields', jsonb_build_object(
  'version', 1, 'allowStoreFields', false, 'fields', '[]'::jsonb,
  'coreFields', '["name","description","productType","attributes","brand","category","sku","barcode","price","cost","uom","status","openPrice","floorPrice","includesTax"]'::jsonb
)), CURRENT_TIMESTAMP
FROM "organizations" o
ON CONFLICT ("organization_id") DO UPDATE SET
  "settings" = jsonb_set("organization_settings"."settings", '{productFields}', EXCLUDED."settings"->'productFields'),
  "updated_at" = CURRENT_TIMESTAMP
WHERE NOT ("organization_settings"."settings" ? 'productFields');

-- Give old uncategorised products a real category before category becomes required in the API.
INSERT INTO "categories" ("id", "organization_id", "name", "updated_at")
SELECT gen_random_uuid(), o."organization_id", 'Uncategorised', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "organization_id" FROM "products" WHERE "category_id" IS NULL) o
WHERE NOT EXISTS (SELECT 1 FROM "categories" c WHERE c."organization_id" = o."organization_id" AND c."name" = 'Uncategorised');

UPDATE "products" p SET "category_id" = c."id"
FROM (SELECT DISTINCT ON ("organization_id") "organization_id", "id" FROM "categories" WHERE "name" = 'Uncategorised' ORDER BY "organization_id", "created_at", "id") c
WHERE p."category_id" IS NULL AND p."organization_id" = c."organization_id";

-- Existing variants gain the default sellable unit while merchants can still choose another unit.
INSERT INTO "units_of_measure" ("id", "organization_id", "code", "name", "updated_at")
SELECT gen_random_uuid(), o."id", 'PCS', 'Pieces', CURRENT_TIMESTAMP FROM "organizations" o
ON CONFLICT ("organization_id", "code") DO NOTHING;

UPDATE "product_variants" v SET "uom_id" = u."id"
FROM "units_of_measure" u WHERE v."uom_id" IS NULL AND v."organization_id" = u."organization_id" AND u."code" = 'PCS';
