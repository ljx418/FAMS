CREATE TABLE IF NOT EXISTS "InvestmentPolicyVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.investment-policy.v1',
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "contractJson" TEXT NOT NULL,
  "contractHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "activatedBy" TEXT,
  "activatedAt" DATETIME,
  "supersededAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InvestmentPolicyVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentPolicyVersion_userId_version_key" ON "InvestmentPolicyVersion"("userId", "version");
CREATE INDEX IF NOT EXISTS "InvestmentPolicyVersion_userId_contractHash_idx" ON "InvestmentPolicyVersion"("userId", "contractHash");
CREATE INDEX IF NOT EXISTS "InvestmentPolicyVersion_userId_status_updatedAt_idx" ON "InvestmentPolicyVersion"("userId", "status", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentPolicyVersion_one_active_per_user_key" ON "InvestmentPolicyVersion"("userId") WHERE "status" = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentPolicyVersion_one_draft_per_user_key" ON "InvestmentPolicyVersion"("userId") WHERE "status" = 'draft';

CREATE TABLE IF NOT EXISTS "InvestmentPolicyAssetOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyVersionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "overrideJson" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InvestmentPolicyAssetOverride_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "InvestmentPolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvestmentPolicyAssetOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvestmentPolicyAssetOverride_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentPolicyAssetOverride_policyVersionId_assetId_key" ON "InvestmentPolicyAssetOverride"("policyVersionId", "assetId");
CREATE INDEX IF NOT EXISTS "InvestmentPolicyAssetOverride_userId_assetId_idx" ON "InvestmentPolicyAssetOverride"("userId", "assetId");

CREATE TABLE IF NOT EXISTS "InvestmentPolicyEvaluationSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyVersionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.investment-policy-evaluation.v1',
  "snapshotHash" TEXT NOT NULL,
  "evaluatedAt" DATETIME NOT NULL,
  "inputAsOf" DATETIME NOT NULL,
  "evaluationJson" TEXT NOT NULL,
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentPolicyEvaluationSnapshot_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "InvestmentPolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvestmentPolicyEvaluationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentPolicyEvaluationSnapshot_snapshotHash_key" ON "InvestmentPolicyEvaluationSnapshot"("snapshotHash");
CREATE INDEX IF NOT EXISTS "InvestmentPolicyEvaluationSnapshot_userId_evaluatedAt_idx" ON "InvestmentPolicyEvaluationSnapshot"("userId", "evaluatedAt");
CREATE INDEX IF NOT EXISTS "InvestmentPolicyEvaluationSnapshot_policyVersionId_evaluatedAt_idx" ON "InvestmentPolicyEvaluationSnapshot"("policyVersionId", "evaluatedAt");
