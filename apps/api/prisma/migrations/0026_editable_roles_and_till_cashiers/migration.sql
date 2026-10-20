-- Plan 13: editable roles with safe-level tracking, and shared till logins with named cashiers.

-- ───────────────────────── Part B: editable roles ─────────────────────────

ALTER TABLE "roles"
  ADD COLUMN "template_key" TEXT,
  ADD COLUMN "customized_at" TIMESTAMPTZ(3),
  ADD COLUMN "customized_by_id" UUID,
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "roles" ADD CONSTRAINT "roles_customized_by_id_fkey" FOREIGN KEY ("customized_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "role_permission_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "elevated" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permission_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "role_permission_changes_role_id_created_at_idx" ON "role_permission_changes"("role_id", "created_at" DESC);
ALTER TABLE "role_permission_changes" ADD CONSTRAINT "role_permission_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permission_changes" ADD CONSTRAINT "role_permission_changes_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permission_changes" ADD CONSTRAINT "role_permission_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Backfill template_key for the five seeded system roles so startup reconciliation (customizedAt IS NULL)
-- keeps following their template immediately after this migration. Unknown/custom roles stay NULL.
UPDATE "roles" SET "template_key" = 'org_admin' WHERE "is_system" = true AND "name" = 'Organisation Administrator';
UPDATE "roles" SET "template_key" = 'store_manager' WHERE "is_system" = true AND "name" = 'Store Manager';
UPDATE "roles" SET "template_key" = 'supervisor' WHERE "is_system" = true AND "name" = 'Supervisor';
UPDATE "roles" SET "template_key" = 'cashier' WHERE "is_system" = true AND "name" = 'Cashier';
UPDATE "roles" SET "template_key" = 'inventory_user' WHERE "is_system" = true AND "name" = 'Inventory User';

-- ───────────────────────── Part A: shared till logins and named cashiers ─────────────────────────

CREATE TYPE "UserAccountType" AS ENUM ('PERSON', 'STORE_TILL');

ALTER TABLE "users"
  ADD COLUMN "account_type" "UserAccountType" NOT NULL DEFAULT 'PERSON',
  ADD COLUMN "till_store_id" UUID;

ALTER TABLE "users" ADD CONSTRAINT "users_till_store_id_fkey" FOREIGN KEY ("till_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_till_store_id_idx" ON "users"("till_store_id");

-- Exactly one active (non-disabled) till login per store.
CREATE UNIQUE INDEX "users_one_till_per_store" ON "users"("till_store_id") WHERE "account_type" = 'STORE_TILL' AND "status" <> 'DISABLED';

-- till_store_id is set if and only if the account is a till.
ALTER TABLE "users" ADD CONSTRAINT "users_till_store_id_matches_account_type" CHECK (
  ("account_type" = 'STORE_TILL' AND "till_store_id" IS NOT NULL) OR
  ("account_type" = 'PERSON' AND "till_store_id" IS NULL)
);

CREATE TABLE "store_cashiers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL DEFAULT '',
    "pin_hash" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "linked_user_id" UUID,
    "created_by_id" UUID NOT NULL,
    "last_selected_at" TIMESTAMPTZ(3),
    "failed_pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "store_cashiers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_cashiers_organization_id_store_id_idx" ON "store_cashiers"("organization_id", "store_id");
-- Case-insensitive uniqueness among active cashier names within a store.
CREATE UNIQUE INDEX "store_cashiers_store_id_lower_display_name_key" ON "store_cashiers"("store_id", lower("display_name")) WHERE "status" = 'ACTIVE';
ALTER TABLE "store_cashiers" ADD CONSTRAINT "store_cashiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_cashiers" ADD CONSTRAINT "store_cashiers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_cashiers" ADD CONSTRAINT "store_cashiers_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "store_cashiers" ADD CONSTRAINT "store_cashiers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Attribution: which named cashier was selected on the till for each till-originated record.

ALTER TABLE "register_sessions"
  ADD COLUMN "opened_by_cashier_id" UUID,
  ADD COLUMN "closed_by_cashier_id" UUID;
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_opened_by_cashier_id_fkey" FOREIGN KEY ("opened_by_cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_closed_by_cashier_id_fkey" FOREIGN KEY ("closed_by_cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_movements" ADD COLUMN "cashier_id" UUID;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales" ADD COLUMN "cashier_id" UUID;
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "held_sales" ADD COLUMN "cashier_id" UUID;
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "returns" ADD COLUMN "cashier_id" UUID;
ALTER TABLE "returns" ADD CONSTRAINT "returns_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approvals" ADD COLUMN "requested_by_cashier_id" UUID;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_cashier_id_fkey" FOREIGN KEY ("requested_by_cashier_id") REFERENCES "store_cashiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
