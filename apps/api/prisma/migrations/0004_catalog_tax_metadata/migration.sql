ALTER TABLE "tax_groups"
  ADD COLUMN IF NOT EXISTS "hsn_code" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "includes_tax" boolean NOT NULL DEFAULT false;
