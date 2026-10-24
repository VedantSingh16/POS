-- Plan 15 Phase D: receipt printer set up on each register (paper size and test-print confirmation).
ALTER TABLE "registers" ADD COLUMN "printer_profile" JSONB NOT NULL DEFAULT '{}';
