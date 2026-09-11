PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

ALTER TABLE "Position" ADD COLUMN "valuationBasis" TEXT NOT NULL DEFAULT 'unit_price';
ALTER TABLE "Position" ADD COLUMN "sourcePayloadJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "PositionSnapshot" ADD COLUMN "valuationBasis" TEXT NOT NULL DEFAULT 'unit_price';
ALTER TABLE "PositionSnapshot" ADD COLUMN "sourcePayloadJson" TEXT NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS "PriceHistory_assetId_timestamp_source_key"
ON "PriceHistory"("assetId", "timestamp", "source");

CREATE TABLE IF NOT EXISTS "ExternalFundLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL DEFAULT 'alipay',
    "assetId" TEXT,
    "sourceCaptureRowId" TEXT NOT NULL,
    "sourceImportKey" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" REAL,
    "shares" REAL,
    "nav" REAL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "executedAt" DATETIME NOT NULL,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalFundLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalFundLedgerEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExternalFundLedgerEntry_sourceCaptureRowId_fkey" FOREIGN KEY ("sourceCaptureRowId") REFERENCES "ScreenshotCaptureRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalFundLedgerEntry_sourceCaptureRowId_key"
ON "ExternalFundLedgerEntry"("sourceCaptureRowId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalFundLedgerEntry_sourceImportKey_key"
ON "ExternalFundLedgerEntry"("sourceImportKey");
CREATE INDEX IF NOT EXISTS "ExternalFundLedgerEntry_userId_executedAt_idx"
ON "ExternalFundLedgerEntry"("userId", "executedAt");
CREATE INDEX IF NOT EXISTS "ExternalFundLedgerEntry_assetId_executedAt_idx"
ON "ExternalFundLedgerEntry"("assetId", "executedAt");
CREATE INDEX IF NOT EXISTS "ExternalFundLedgerEntry_accountId_executedAt_idx"
ON "ExternalFundLedgerEntry"("accountId", "executedAt");

COMMIT;
