-- Phase 5 checkout metadata and Phase 2 permission effects.
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'REQUIRE_APPROVAL', 'DENY');

ALTER TABLE "role_permissions"
  ADD COLUMN "effect" "PermissionEffect" NOT NULL DEFAULT 'ALLOW';

ALTER TABLE "sales"
  ADD COLUMN "rounding_cents" integer NOT NULL DEFAULT 0;

ALTER TABLE "sale_payments"
  ADD COLUMN "tendered_cents" integer,
  ADD COLUMN "change_cents" integer NOT NULL DEFAULT 0;

ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_tendered_cents_check" CHECK ("tendered_cents" IS NULL OR "tendered_cents" >= 0),
  ADD CONSTRAINT "sale_payments_change_cents_check" CHECK ("change_cents" >= 0);
