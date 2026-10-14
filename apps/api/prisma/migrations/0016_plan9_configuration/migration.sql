-- Plan 9: store-scoped staff assignment, bill attribution, and extensible field values.

ALTER TABLE "roles" ADD COLUMN "store_assignable" BOOLEAN NOT NULL DEFAULT false;
UPDATE "roles" SET "store_assignable" = true WHERE "is_system" = true AND "name" IN ('Cashier', 'Supervisor');

INSERT INTO "permissions" ("code", "description")
VALUES ('store.staff.manage', 'Assign approved roles to staff in this store')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code", "effect")
SELECT r."id", 'store.staff.manage', 'ALLOW'::"PermissionEffect"
FROM "roles" r
WHERE r."is_system" = true AND r."name" = 'Store Manager'
ON CONFLICT ("role_id", "permission_code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code", "effect")
SELECT r."id", 'catalog.manage.store', 'ALLOW'::"PermissionEffect"
FROM "roles" r
WHERE r."is_system" = true AND r."name" = 'Store Manager'
ON CONFLICT ("role_id", "permission_code") DO NOTHING;

ALTER TABLE "stores" ADD COLUMN "field_settings" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "product_variants" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "store_variants" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "sales" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "sales" ADD COLUMN "handled_by_id" UUID;

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_handled_by_id_fkey"
  FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sales_organization_id_handled_by_id_created_at_idx"
  ON "sales"("organization_id", "handled_by_id", "created_at" DESC);
