-- WF-1: explicit account source, auditable strategy assignment, and immutable
-- research inputs. Existing ScreenshotCapture rows remain null rather than
-- receiving a guessed historical source.
ALTER TABLE "ScreenshotCapture" ADD COLUMN "accountSource" TEXT;
CREATE INDEX IF NOT EXISTS "ScreenshotCapture_userId_accountSource_status_createdAt_idx"
  ON "ScreenshotCapture"("userId", "accountSource", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "PositionStrategyAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "strategyFamily" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'suggested',
  "source" TEXT NOT NULL DEFAULT 'system_rule',
  "confidence" REAL,
  "reasonsJson" TEXT NOT NULL DEFAULT '[]',
  "suggestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" DATETIME,
  "confirmedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PositionStrategyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PositionStrategyAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PositionStrategyAssignment_positionId_key"
  ON "PositionStrategyAssignment"("positionId");
CREATE INDEX IF NOT EXISTS "PositionStrategyAssignment_userId_strategyFamily_status_idx"
  ON "PositionStrategyAssignment"("userId", "strategyFamily", "status");

CREATE TABLE IF NOT EXISTS "InvestmentResearchSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.investment-research-input.v1',
  "userId" TEXT NOT NULL,
  "accountSource" TEXT,
  "strategyFamily" TEXT NOT NULL,
  "asOf" DATETIME NOT NULL,
  "providerSummaryJson" TEXT NOT NULL DEFAULT '[]',
  "freshnessStatus" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL,
  "dataHealthJson" TEXT NOT NULL DEFAULT '{}',
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "inputHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentResearchSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentResearchSnapshot_inputHash_key"
  ON "InvestmentResearchSnapshot"("inputHash");
CREATE INDEX IF NOT EXISTS "InvestmentResearchSnapshot_userId_strategyFamily_asOf_idx"
  ON "InvestmentResearchSnapshot"("userId", "strategyFamily", "asOf");
