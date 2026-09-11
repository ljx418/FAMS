CREATE TABLE IF NOT EXISTS "IndustryCrowdingBoard" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "boardType" TEXT NOT NULL DEFAULT 'industry',
  "provider" TEXT NOT NULL DEFAULT 'eastmoney_industry',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sourceUpdatedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IndustryCrowdingBoard_isActive_name_idx"
  ON "IndustryCrowdingBoard"("isActive", "name");

CREATE TABLE IF NOT EXISTS "IndustryCrowdingDaily" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardCode" TEXT NOT NULL,
  "tradeDate" DATETIME NOT NULL,
  "openPrice" REAL,
  "highPrice" REAL,
  "lowPrice" REAL,
  "closePrice" REAL NOT NULL,
  "volume" REAL,
  "amount" REAL,
  "mainNetInflow" REAL,
  "mainNetInflowRatio" REAL,
  "priceProvider" TEXT NOT NULL DEFAULT 'eastmoney_industry_kline',
  "flowProvider" TEXT,
  "sourceTimestamp" DATETIME,
  "qualityFlagsJson" TEXT NOT NULL DEFAULT '[]',
  "rawPayloadJson" TEXT NOT NULL DEFAULT '{}',
  "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndustryCrowdingDaily_boardCode_fkey"
    FOREIGN KEY ("boardCode") REFERENCES "IndustryCrowdingBoard"("code")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IndustryCrowdingDaily_boardCode_tradeDate_key"
  ON "IndustryCrowdingDaily"("boardCode", "tradeDate");
CREATE INDEX IF NOT EXISTS "IndustryCrowdingDaily_tradeDate_boardCode_idx"
  ON "IndustryCrowdingDaily"("tradeDate", "boardCode");
