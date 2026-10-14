ALTER TABLE "products" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}'::jsonb;
