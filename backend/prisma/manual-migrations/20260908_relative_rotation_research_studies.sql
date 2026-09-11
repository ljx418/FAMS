PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS "RelativeRotationResearchStudy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "frequency" TEXT NOT NULL DEFAULT 'weekly',
  "periodMode" TEXT NOT NULL DEFAULT 'rolling',
  "rollingWeeks" INTEGER NOT NULL DEFAULT 52,
  "startDate" DATETIME,
  "endDate" DATETIME,
  "comparisonTargetKeysJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RelativeRotationResearchStudy_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RelativeRotationResearchStudy_userId_updatedAt_idx"
  ON "RelativeRotationResearchStudy"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "RelativeRotationResearchStudyTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studyId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'equity',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RelativeRotationResearchStudyTarget_studyId_fkey"
    FOREIGN KEY ("studyId") REFERENCES "RelativeRotationResearchStudy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "RelativeRotationResearchStudyTarget_studyId_targetKey_key"
  ON "RelativeRotationResearchStudyTarget"("studyId", "targetKey");
CREATE INDEX IF NOT EXISTS "RelativeRotationResearchStudyTarget_studyId_sortOrder_idx"
  ON "RelativeRotationResearchStudyTarget"("studyId", "sortOrder");

COMMIT;
