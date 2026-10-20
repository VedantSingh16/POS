-- Plan 13: short-lived opaque tokens proving a till device verified a named cashier's PIN (or that none was
-- required), so a till session can never attribute a sale to a bare cashierId without server-side proof.

CREATE TABLE "cashier_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "till_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cashier_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cashier_tokens_token_hash_key" ON "cashier_tokens"("token_hash");
CREATE INDEX "cashier_tokens_cashier_id_idx" ON "cashier_tokens"("cashier_id");
CREATE INDEX "cashier_tokens_till_user_id_idx" ON "cashier_tokens"("till_user_id");
CREATE INDEX "cashier_tokens_expires_at_idx" ON "cashier_tokens"("expires_at");

ALTER TABLE "cashier_tokens" ADD CONSTRAINT "cashier_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashier_tokens" ADD CONSTRAINT "cashier_tokens_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashier_tokens" ADD CONSTRAINT "cashier_tokens_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "store_cashiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashier_tokens" ADD CONSTRAINT "cashier_tokens_till_user_id_fkey" FOREIGN KEY ("till_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
