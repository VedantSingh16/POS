CREATE TYPE "AttendanceStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "DayCloseStatus" AS ENUM ('CLOSED', 'RESTATEMENT_REQUIRED');
CREATE TYPE "ReportExportFormat" AS ENUM ('CSV', 'PDF');
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "register_sessions"
  ADD COLUMN "closed_by_id" UUID,
  ADD COLUMN "close_approved_by_id" UUID,
  ADD COLUMN "close_reason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "forced_closed" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "register_sessions"
  ADD CONSTRAINT "register_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "register_sessions_close_approved_by_id_fkey" FOREIGN KEY ("close_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_movements"
  ADD COLUMN "approved_by_id" UUID,
  ADD COLUMN "client_movement_id" TEXT;

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "cash_movements_organization_id_client_movement_id_key"
  ON "cash_movements"("organization_id", "client_movement_id");

ALTER TABLE "approvals"
  ADD COLUMN "store_id" UUID,
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "consumed_at" TIMESTAMPTZ(3),
  ADD COLUMN "payload_hash" TEXT,
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "approvals"
  ADD CONSTRAINT "approvals_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "approvals_store_id_status_action_expires_at_idx"
  ON "approvals"("store_id", "status", "action", "expires_at");

ALTER TABLE "alerts"
  ADD COLUMN "active_dedupe_key" TEXT,
  ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "acknowledged_by_id" UUID,
  ADD COLUMN "acknowledged_at" TIMESTAMPTZ(3),
  ADD COLUMN "resolved_by_id" UUID,
  ADD COLUMN "resolution_note" TEXT NOT NULL DEFAULT '';

ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "alerts_active_dedupe_key_key" ON "alerts"("active_dedupe_key");

CREATE TABLE "staff_attendance" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'OPEN',
  "clocked_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clocked_out_at" TIMESTAMPTZ(3),
  "clocked_in_by_id" UUID NOT NULL,
  "clocked_out_by_id" UUID,
  "clock_out_reason" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_attendance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staff_attendance_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staff_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "staff_attendance_clocked_in_by_id_fkey" FOREIGN KEY ("clocked_in_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "staff_attendance_clocked_out_by_id_fkey" FOREIGN KEY ("clocked_out_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "staff_attendance_organization_id_store_id_clocked_in_at_idx"
  ON "staff_attendance"("organization_id", "store_id", "clocked_in_at" DESC);
CREATE INDEX "staff_attendance_user_id_clocked_in_at_idx"
  ON "staff_attendance"("user_id", "clocked_in_at" DESC);
CREATE UNIQUE INDEX "staff_attendance_one_open_per_user_store_idx"
  ON "staff_attendance"("organization_id", "store_id", "user_id") WHERE "status" = 'OPEN';

CREATE TABLE "store_day_closes" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "DayCloseStatus" NOT NULL DEFAULT 'CLOSED',
  "snapshot" JSONB NOT NULL,
  "close_reason" TEXT NOT NULL DEFAULT '',
  "closed_by_id" UUID NOT NULL,
  "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "store_day_closes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_day_closes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_day_closes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_day_closes_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "store_day_closes_store_id_business_date_key" ON "store_day_closes"("store_id", "business_date");
CREATE INDEX "store_day_closes_organization_id_business_date_idx" ON "store_day_closes"("organization_id", "business_date" DESC);

CREATE TABLE "day_close_revisions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "day_close_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "day_close_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "day_close_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "day_close_revisions_day_close_id_fkey" FOREIGN KEY ("day_close_id") REFERENCES "store_day_closes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "day_close_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "day_close_revisions_day_close_id_version_key" ON "day_close_revisions"("day_close_id", "version");
CREATE INDEX "day_close_revisions_organization_id_created_at_idx" ON "day_close_revisions"("organization_id", "created_at" DESC);

CREATE TABLE "report_export_jobs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "store_id" UUID,
  "requested_by_id" UUID NOT NULL,
  "format" "ReportExportFormat" NOT NULL,
  "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
  "filters" JSONB NOT NULL,
  "result_data" BYTEA,
  "error_message" TEXT NOT NULL DEFAULT '',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "report_export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_export_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "report_export_jobs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "report_export_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "report_export_jobs_organization_id_requested_by_id_created_at_idx"
  ON "report_export_jobs"("organization_id", "requested_by_id", "created_at" DESC);
CREATE INDEX "report_export_jobs_status_created_at_idx" ON "report_export_jobs"("status", "created_at");
