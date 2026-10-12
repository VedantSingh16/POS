ALTER TABLE "stores" ADD COLUMN "close_hour" INTEGER;
ALTER TABLE "stores" ADD CONSTRAINT "stores_close_hour_check" CHECK ("close_hour" IS NULL OR ("close_hour" >= 0 AND "close_hour" <= 23));
