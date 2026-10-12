ALTER TABLE "organizations"
  ADD COLUMN "legal_name" text NOT NULL DEFAULT '',
  ADD COLUMN "trade_name" text NOT NULL DEFAULT '',
  ADD COLUMN "address" text NOT NULL DEFAULT '',
  ADD COLUMN "gstin" text NOT NULL DEFAULT '',
  ADD COLUMN "business_type" text NOT NULL DEFAULT 'RETAIL';
