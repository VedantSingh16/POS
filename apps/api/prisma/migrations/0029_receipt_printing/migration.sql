-- Plan 14: till receipt printing. Counts prints so reprints are marked and audited.
ALTER TABLE "sales" ADD COLUMN "print_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "last_printed_at" TIMESTAMPTZ(3);
