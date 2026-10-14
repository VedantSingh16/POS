-- Organisation-defined product types and per-store billing settings.

ALTER TABLE "stores" ADD COLUMN "billing_settings" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "product_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_types_organization_id_name_key" ON "product_types"("organization_id", "name");
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "product_type_id" UUID;
ALTER TABLE "products" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
