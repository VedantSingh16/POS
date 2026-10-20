ALTER TABLE "organizations"
  ADD COLUMN "platform_tenant_id" uuid;

CREATE UNIQUE INDEX "organizations_platform_tenant_id_key"
  ON "organizations"("platform_tenant_id");

ALTER TABLE "users"
  ADD COLUMN "platform_user_id" uuid,
  ADD COLUMN "platform_membership_id" uuid;

CREATE UNIQUE INDEX "users_organization_id_platform_user_id_key"
  ON "users"("organization_id", "platform_user_id");
