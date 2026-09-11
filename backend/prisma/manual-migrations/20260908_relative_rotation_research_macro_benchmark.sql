PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

ALTER TABLE "RelativeRotationResearchStudy"
  ADD COLUMN "historyYears" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "RelativeRotationResearchStudy"
  ADD COLUMN "benchmarkMode" TEXT NOT NULL DEFAULT 'market_default';
ALTER TABLE "RelativeRotationResearchStudy"
  ADD COLUMN "benchmarkTargetKeysJson" TEXT NOT NULL DEFAULT '[]';

COMMIT;
