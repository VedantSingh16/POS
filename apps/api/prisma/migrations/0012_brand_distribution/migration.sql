-- New enums
CREATE TYPE "StoreVariantStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED');
CREATE TYPE "StoreVariantSource" AS ENUM ('ORG_DISTRIBUTION', 'STORE_CREATED');
CREATE TYPE "DistributionStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- Brands table
CREATE TABLE "brands" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brands_organization_id_name_key" ON "brands"("organization_id", "name");
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: for every distinct non-empty brand text, insert a brand row, then set products.brand_id
ALTER TABLE "products" ADD COLUMN "brand_id" UUID;
INSERT INTO "brands" ("id", "organization_id", "name", "updated_at")
SELECT gen_random_uuid(), "organization_id", TRIM(x.brand), CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "organization_id", "brand" FROM "products" WHERE COALESCE(TRIM("brand"), '') <> '') x;
UPDATE "products" p
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."organization_id" = p."organization_id" AND b."name" = TRIM(p."brand") AND COALESCE(TRIM(p."brand"), '') <> '';
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- store_variants: migrate to new status + source + overrides
-- RecordStatus had ACTIVE/DISABLED; the new enum adds PENDING_VERIFICATION.
ALTER TABLE "store_variants" ADD COLUMN "source_type" "StoreVariantSource" NOT NULL DEFAULT 'STORE_CREATED';
ALTER TABLE "store_variants" ADD COLUMN "tax_group_id" UUID;
ALTER TABLE "store_variants" ADD COLUMN "verified_at" TIMESTAMPTZ(3);
ALTER TABLE "store_variants" ADD COLUMN "verified_by_user_id" UUID;
-- Replace status column: drop default, change type, re-add default
ALTER TABLE "store_variants" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "store_variants" ALTER COLUMN "status" TYPE "StoreVariantStatus" USING (
  CASE "status"::text WHEN 'ACTIVE' THEN 'ACTIVE'::"StoreVariantStatus" ELSE 'DISABLED'::"StoreVariantStatus" END
);
ALTER TABLE "store_variants" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "store_variants_store_id_status_idx" ON "store_variants"("store_id", "status");

-- Distributions
CREATE TABLE "distributions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "to_store_id" UUID NOT NULL,
  "status" "DistributionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT NOT NULL DEFAULT '',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "distributions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "distributions_organization_id_created_at_idx" ON "distributions"("organization_id", "created_at" DESC);
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_to_store_id_fkey" FOREIGN KEY ("to_store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "distribution_lines" (
  "id" UUID NOT NULL,
  "distribution_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "quantity" DECIMAL(14, 3) NOT NULL,
  "suggested_price_cents" INTEGER,
  "suggested_tax_group_id" UUID,
  "accepted_quantity" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "rejected_quantity" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  CONSTRAINT "distribution_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "distribution_lines_distribution_id_idx" ON "distribution_lines"("distribution_id");
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_distribution_id_fkey" FOREIGN KEY ("distribution_id") REFERENCES "distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_suggested_tax_group_id_fkey" FOREIGN KEY ("suggested_tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
