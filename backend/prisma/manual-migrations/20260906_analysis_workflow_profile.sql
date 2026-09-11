CREATE TABLE IF NOT EXISTS "AnalysisWorkflowProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "workflowKey" TEXT NOT NULL,
  "profileVersion" TEXT NOT NULL,
  "contractHash" TEXT NOT NULL,
  "contractJson" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "schedulerEnabled" BOOLEAN NOT NULL DEFAULT false,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "scheduleSlotsJson" TEXT NOT NULL DEFAULT '["09:40","14:40"]',
  "snapshotAuthorizationJson" TEXT NOT NULL DEFAULT '{}',
  "lastRunAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisWorkflowProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AnalysisWorkflowProfile_userId_workflowKey_profileVersion_key"
  ON "AnalysisWorkflowProfile"("userId", "workflowKey", "profileVersion");
CREATE INDEX IF NOT EXISTS "AnalysisWorkflowProfile_workflowKey_isActive_schedulerEnabled_idx"
  ON "AnalysisWorkflowProfile"("workflowKey", "isActive", "schedulerEnabled");
CREATE INDEX IF NOT EXISTS "AnalysisWorkflowProfile_userId_workflowKey_isActive_idx"
  ON "AnalysisWorkflowProfile"("userId", "workflowKey", "isActive");
