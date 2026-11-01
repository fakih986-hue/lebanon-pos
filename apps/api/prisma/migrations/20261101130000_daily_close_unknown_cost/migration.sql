-- Daily close cost figures: unknown is NULL, never a stored 0. Existing closes keep their values.
ALTER TABLE "DailyClose" ALTER COLUMN "costOfGoods" DROP NOT NULL, ALTER COLUMN "costOfGoods" DROP DEFAULT;
ALTER TABLE "DailyClose" ALTER COLUMN "returnedCost" DROP NOT NULL, ALTER COLUMN "returnedCost" DROP DEFAULT;
ALTER TABLE "DailyClose" ALTER COLUMN "grossMargin" DROP NOT NULL, ALTER COLUMN "grossMargin" DROP DEFAULT;
ALTER TABLE "DailyClose" ALTER COLUMN "netProfit" DROP NOT NULL, ALTER COLUMN "netProfit" DROP DEFAULT;
ALTER TABLE "DailyClose" ADD COLUMN "costStatus" TEXT;
