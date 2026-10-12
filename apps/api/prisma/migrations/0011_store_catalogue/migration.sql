CREATE TABLE "store_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "store_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_variants_store_id_variant_id_key" ON "store_variants"("store_id", "variant_id");
CREATE INDEX "store_variants_organization_id_variant_id_idx" ON "store_variants"("organization_id", "variant_id");
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep today's behaviour: every variant a store already stocks or has sold stays in that store's catalogue.
INSERT INTO "store_variants" ("id", "organization_id", "store_id", "variant_id", "updated_at")
SELECT gen_random_uuid(), x."organization_id", x."store_id", x."variant_id", CURRENT_TIMESTAMP
FROM (
  SELECT sl."organization_id", sl."store_id", ib."variant_id"
  FROM "inventory_balances" ib JOIN "stock_locations" sl ON sl."id" = ib."location_id"
  WHERE sl."store_id" IS NOT NULL
  UNION
  SELECT s."organization_id", s."store_id", l."variant_id"
  FROM "sale_lines" l JOIN "sales" s ON s."id" = l."sale_id"
) x;
