ALTER TABLE "product_variants" ADD COLUMN "cost_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sale_lines" ADD COLUMN "unit_cost_cents" INTEGER NOT NULL DEFAULT 0;
