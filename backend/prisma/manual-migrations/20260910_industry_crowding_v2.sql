-- Apply after 20260910_industry_crowding.sql.  SQLite does not support
-- ADD COLUMN IF NOT EXISTS, so this migration is intentionally separate.
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "priceStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "flowStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "lastPriceDate" DATETIME;
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "lastFlowDate" DATETIME;
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "IndustryCrowdingBoard" ADD COLUMN "lastError" TEXT;

CREATE TABLE IF NOT EXISTS "IndustryCrowdingMarketDaily" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "marketKey" TEXT NOT NULL,
  "tradeDate" DATETIME NOT NULL,
  "mainNetInflow" REAL,
  "mainNetInflowRatio" REAL,
  "provider" TEXT NOT NULL DEFAULT 'eastmoney_sh_sz_main_flow',
  "sourceTimestamp" DATETIME,
  "qualityFlagsJson" TEXT NOT NULL DEFAULT '[]',
  "rawPayloadJson" TEXT NOT NULL DEFAULT '{}',
  "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "IndustryCrowdingMarketDaily_marketKey_tradeDate_key"
  ON "IndustryCrowdingMarketDaily"("marketKey", "tradeDate");
CREATE INDEX IF NOT EXISTS "IndustryCrowdingMarketDaily_marketKey_tradeDate_idx"
  ON "IndustryCrowdingMarketDaily"("marketKey", "tradeDate");
