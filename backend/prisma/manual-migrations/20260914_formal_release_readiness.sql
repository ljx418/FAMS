-- A0 formal-release readiness storage. Apply once after the existing manual
-- migrations. Existing authorization rows retain v1 hash semantics.
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "recordSchemaVersion" TEXT NOT NULL DEFAULT 'fams.formal_provider.authorization.v1';
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "authorizationBasis" TEXT NOT NULL DEFAULT 'legacy_unspecified';
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "usageScope" TEXT NOT NULL DEFAULT 'legacy_unspecified';
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "sourceTermsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "endpointAllowlistJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "sourceSnapshotHash" TEXT;
ALTER TABLE "FormalProviderAuthorization" ADD COLUMN "credentialRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "FormalDataSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL,
  "candidateStrategyId" TEXT NOT NULL,
  "candidateStrategyVersion" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "blockersJson" TEXT NOT NULL DEFAULT '[]',
  "immutable" BOOLEAN NOT NULL DEFAULT true,
  "generatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FormalDataSnapshot_snapshotHash_key" ON "FormalDataSnapshot"("snapshotHash");
CREATE INDEX IF NOT EXISTS "FormalDataSnapshot_candidateStrategyId_candidateStrategyVersion_generatedAt_idx"
  ON "FormalDataSnapshot"("candidateStrategyId", "candidateStrategyVersion", "generatedAt");
CREATE INDEX IF NOT EXISTS "FormalDataSnapshot_providerId_status_generatedAt_idx"
  ON "FormalDataSnapshot"("providerId", "status", "generatedAt");

CREATE TABLE IF NOT EXISTS "ReleaseCandidateSet" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'frozen',
  "candidateIdsJson" TEXT NOT NULL,
  "candidateVersionsJson" TEXT NOT NULL,
  "sourceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "contentHash" TEXT NOT NULL,
  "snapshotAsOf" DATETIME NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdByEmail" TEXT NOT NULL,
  "immutable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReleaseCandidateSet_contentHash_key" ON "ReleaseCandidateSet"("contentHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ReleaseCandidateSet_setId_version_key" ON "ReleaseCandidateSet"("setId", "version");
CREATE INDEX IF NOT EXISTS "ReleaseCandidateSet_userId_snapshotAsOf_idx" ON "ReleaseCandidateSet"("userId", "snapshotAsOf");
CREATE INDEX IF NOT EXISTS "ReleaseCandidateSet_status_createdAt_idx" ON "ReleaseCandidateSet"("status", "createdAt");
