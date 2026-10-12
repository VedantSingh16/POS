ALTER TABLE "alerts" ADD COLUMN "store_id" UUID;

CREATE INDEX "alerts_organization_id_store_id_status_created_at_idx"
  ON "alerts"("organization_id", "store_id", "status", "created_at" DESC);
