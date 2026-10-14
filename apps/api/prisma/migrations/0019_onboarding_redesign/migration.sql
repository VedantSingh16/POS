ALTER TABLE "organizations"
  ADD COLUMN "country_code" TEXT NOT NULL DEFAULT 'ZZ',
  ADD COLUMN "tax_profile_status" TEXT NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "stores"
  ADD COLUMN "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "region" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "postal_code" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';

-- Before this migration, the runtime read currency from organization_settings and fell back to OMR.
-- Preserve that effective currency for existing merchants before moving it to organizations.currency.
UPDATE "organizations" AS organization
SET "currency" = CASE
  WHEN jsonb_typeof(settings."settings") = 'object'
    AND settings."settings"->>'currency' IN ('OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'INR', 'USD', 'EUR', 'GBP')
    THEN settings."settings"->>'currency'
  ELSE 'OMR'
END
FROM "organization_settings" AS settings
WHERE settings."organization_id" = organization."id";

UPDATE "organizations" AS organization
SET "country_code" = CASE settings."settings"->>'currency'
  WHEN 'INR' THEN 'IN'
  WHEN 'OMR' THEN 'OM'
  WHEN 'AED' THEN 'AE'
  WHEN 'SAR' THEN 'SA'
  WHEN 'QAR' THEN 'QA'
  WHEN 'KWD' THEN 'KW'
  WHEN 'BHD' THEN 'BH'
  WHEN 'USD' THEN 'US'
  WHEN 'GBP' THEN 'GB'
  WHEN 'EUR' THEN 'EU'
  ELSE 'ZZ'
END
FROM "organization_settings" AS settings
WHERE settings."organization_id" = organization."id"
  AND jsonb_typeof(settings."settings") = 'object'
  AND settings."settings"->>'currency' IN ('OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'INR', 'USD', 'EUR', 'GBP');

-- Currency now has one source of truth. Keep every other setting unchanged.
UPDATE "organization_settings"
SET "settings" = "settings" - 'currency'
WHERE jsonb_typeof("settings") = 'object' AND "settings" ? 'currency';

-- Existing organizations keep their current checkout behavior. New ones must explicitly review tax setup.
ALTER TABLE "organizations" ALTER COLUMN "country_code" SET DEFAULT 'IN';
ALTER TABLE "organizations" ALTER COLUMN "tax_profile_status" SET DEFAULT 'NOT_REVIEWED';

-- A merchant that already has an active store has completed the new required organization/store steps.
-- This prevents the new required flow from interrupting existing accounts.
UPDATE "organization_settings" AS settings
SET "settings" = jsonb_set(
  settings."settings",
  '{onboarding}',
  COALESCE(settings."settings"->'onboarding', '{}'::jsonb)
    || jsonb_build_object('version', 2, 'currentStep', 2, 'completedSteps', jsonb_build_array(0, 1), 'complete', true, 'required', false),
  true
)
WHERE jsonb_typeof(settings."settings") = 'object'
  AND EXISTS (
    SELECT 1 FROM "stores" AS store
    WHERE store."organization_id" = settings."organization_id" AND store."status" = 'ACTIVE'
  );
