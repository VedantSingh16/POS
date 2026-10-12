-- Store-level tax groups, additional charges, and charge totals on sales.
ALTER TABLE "tax_groups" ADD COLUMN "store_id" UUID;
ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales" ADD COLUMN "charge_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "charges" JSONB NOT NULL DEFAULT '[]';

CREATE TYPE "ChargeKind" AS ENUM ('FLAT', 'PERCENT');
CREATE TYPE "ChargeScope" AS ENUM ('PER_BILL', 'PER_ITEM');

CREATE TABLE "charges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "scope" "ChargeScope" NOT NULL DEFAULT 'PER_BILL',
    "value" INTEGER NOT NULL,
    "tax_group_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "charges_organization_id_store_id_idx" ON "charges"("organization_id", "store_id");
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charges" ADD CONSTRAINT "charges_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charges" ADD CONSTRAINT "charges_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
