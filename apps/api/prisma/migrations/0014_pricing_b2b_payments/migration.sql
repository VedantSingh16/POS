-- Plan 6: price rules, applied promotions, discount reasons, B2B identity, payment attempts, held-sale expiry, pinned quick keys.

ALTER TYPE "TenderType" ADD VALUE IF NOT EXISTS 'WALLET';
ALTER TYPE "TenderType" ADD VALUE IF NOT EXISTS 'POINTS';

CREATE TYPE "PriceRuleScope" AS ENUM ('ALL', 'CATEGORY', 'BRAND', 'VARIANT');
CREATE TYPE "PriceRuleMode" AS ENUM ('FIXED', 'PERCENT_OFF', 'AMOUNT_OFF');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED', 'VOIDED', 'UNKNOWN');

ALTER TABLE "stores" ADD COLUMN "tax_number" TEXT NOT NULL DEFAULT '';

ALTER TABLE "product_variants" ADD COLUMN "open_price" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD COLUMN "floor_price_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "store_variants" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "store_variants" ADD COLUMN "pinned_rank" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales" ADD COLUMN "promotions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "sales" ADD COLUMN "document_snapshot" JSONB;

ALTER TABLE "held_sales" ADD COLUMN "expires_at" TIMESTAMPTZ(3);

ALTER TABLE "customers" ADD COLUMN "is_business" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "tax_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN "legal_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN "billing_address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN "state_code" TEXT NOT NULL DEFAULT '';

ALTER TABLE "promotions" ADD COLUMN "scope" "PriceRuleScope" NOT NULL DEFAULT 'ALL';
ALTER TABLE "promotions" ADD COLUMN "scope_id" UUID;
ALTER TABLE "promotions" ADD COLUMN "auto_apply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "promotions" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "promotions" ADD COLUMN "stackable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "promotions" ADD COLUMN "per_customer_limit" INTEGER;

CREATE TABLE "price_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scope" "PriceRuleScope" NOT NULL DEFAULT 'ALL',
    "scope_id" UUID,
    "store_id" UUID,
    "customer_group" TEXT,
    "min_quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "mode" "PriceRuleMode" NOT NULL DEFAULT 'FIXED',
    "value" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "price_rules_organization_id_status_idx" ON "price_rules"("organization_id", "status");
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "discount_reasons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discount_reasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "discount_reasons_organization_id_code_key" ON "discount_reasons"("organization_id", "code");
ALTER TABLE "discount_reasons" ADD CONSTRAINT "discount_reasons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "customer_id" UUID,
    "discount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "promotion_redemptions_promotion_id_customer_id_idx" ON "promotion_redemptions"("promotion_id", "customer_id");
CREATE INDEX "promotion_redemptions_sale_id_idx" ON "promotion_redemptions"("sale_id");
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "tender_type" "TenderType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "provider_ref" TEXT NOT NULL DEFAULT '',
    "idempotency_key" TEXT NOT NULL,
    "client_sale_id" TEXT NOT NULL DEFAULT '',
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_attempts_organization_id_idempotency_key_key" ON "payment_attempts"("organization_id", "idempotency_key");
CREATE INDEX "payment_attempts_organization_id_status_idx" ON "payment_attempts"("organization_id", "status");
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_payments" ADD COLUMN "attempt_id" UUID;
CREATE UNIQUE INDEX "sale_payments_attempt_id_key" ON "sale_payments"("attempt_id");
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
