-- FAMS trade-plan-ledger v1
-- Scope is deliberately limited. Apply through scripts/apply-trade-plan-ledger-migration.ts.
-- Never replace this migration with `prisma db push` against the existing database.

.bail on
.timeout 10000
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE "InvestmentStrategyRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.investment-strategy-run.v2',
  "userId" TEXT NOT NULL,
  "inputSnapshotId" TEXT NOT NULL,
  "strategyFamily" TEXT NOT NULL,
  "strategyVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "idempotencyKey" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL DEFAULT '{}',
  "resultJson" TEXT NOT NULL DEFAULT '{}',
  "resultHash" TEXT,
  "errorJson" TEXT NOT NULL DEFAULT '{}',
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InvestmentStrategyRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvestmentStrategyRun_inputSnapshotId_fkey" FOREIGN KEY ("inputSnapshotId") REFERENCES "InvestmentResearchSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvestmentStrategyRun_status_check" CHECK ("status" IN ('running','completed','blocked','failed'))
);
CREATE UNIQUE INDEX "InvestmentStrategyRun_userId_idempotencyKey_key" ON "InvestmentStrategyRun"("userId","idempotencyKey");
CREATE INDEX "InvestmentStrategyRun_userId_strategyFamily_startedAt_idx" ON "InvestmentStrategyRun"("userId","strategyFamily","startedAt");
CREATE INDEX "InvestmentStrategyRun_inputSnapshotId_idx" ON "InvestmentStrategyRun"("inputSnapshotId");

CREATE TABLE "TradeIngestionBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.trade-ingestion-batch.v1',
  "userId" TEXT NOT NULL,
  "captureId" TEXT,
  "accountSource" TEXT,
  "sourceType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "coverageFrom" DATETIME,
  "coverageTo" DATETIME,
  "coverageKindsJson" TEXT NOT NULL DEFAULT '[]',
  "positionEffectPolicy" TEXT NOT NULL DEFAULT 'record_only',
  "status" TEXT NOT NULL DEFAULT 'staged',
  "countsJson" TEXT NOT NULL DEFAULT '{}',
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "errorJson" TEXT NOT NULL DEFAULT '{}',
  "confirmedBy" TEXT,
  "confirmedAt" DATETIME,
  "reconciledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TradeIngestionBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeIngestionBatch_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "ScreenshotCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TradeIngestionBatch_positionEffectPolicy_check" CHECK ("positionEffectPolicy" IN ('apply','record_only','not_applicable')),
  CONSTRAINT "TradeIngestionBatch_status_check" CHECK ("status" IN ('staged','preview_ready','confirmed','reconciled','blocked','failed'))
);
CREATE UNIQUE INDEX "TradeIngestionBatch_userId_idempotencyKey_key" ON "TradeIngestionBatch"("userId","idempotencyKey");
CREATE INDEX "TradeIngestionBatch_userId_accountSource_createdAt_idx" ON "TradeIngestionBatch"("userId","accountSource","createdAt");
CREATE INDEX "TradeIngestionBatch_captureId_idx" ON "TradeIngestionBatch"("captureId");

CREATE TABLE "new_Transaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "positionId" TEXT,
  "userId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "price" REAL NOT NULL,
  "fee" REAL NOT NULL DEFAULT 0,
  "amount" REAL NOT NULL,
  "broker" TEXT,
  "confirmationNo" TEXT,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "executedAt" DATETIME NOT NULL,
  "notes" TEXT,
  "source" TEXT,
  "positionEffect" TEXT NOT NULL DEFAULT 'apply',
  "ingestionBatchId" TEXT,
  "supersedesTransactionId" TEXT,
  "adviceActionId" TEXT,
  "sourceImportKey" TEXT,
  "sourceCaptureRowId" TEXT,
  "sleeveType" TEXT,
  "volatilityTradeDraftId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Transaction_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Transaction_ingestionBatchId_fkey" FOREIGN KEY ("ingestionBatchId") REFERENCES "TradeIngestionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_supersedesTransactionId_fkey" FOREIGN KEY ("supersedesTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Transaction_adviceActionId_fkey" FOREIGN KEY ("adviceActionId") REFERENCES "AdviceAction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_sourceCaptureRowId_fkey" FOREIGN KEY ("sourceCaptureRowId") REFERENCES "ScreenshotCaptureRow"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_volatilityTradeDraftId_fkey" FOREIGN KEY ("volatilityTradeDraftId") REFERENCES "VolatilityTradeDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_positionEffect_check" CHECK ("positionEffect" IN ('apply','record_only'))
);
INSERT INTO "new_Transaction" (
  "id","positionId","userId","assetId","type","quantity","price","fee","amount","broker","confirmationNo","status","executedAt","notes","source","positionEffect","ingestionBatchId","supersedesTransactionId","adviceActionId","sourceImportKey","sourceCaptureRowId","sleeveType","volatilityTradeDraftId","createdAt","updatedAt"
)
SELECT
  "id","positionId","userId","assetId","type","quantity","price","fee","amount","broker","confirmationNo","status","executedAt","notes","source",
  CASE WHEN "source"='screenshot_confirmed_snapshot_included' OR COALESCE("notes",'') LIKE '%不重放仓位%' THEN 'record_only' ELSE 'apply' END,
  NULL,NULL,"adviceActionId","sourceImportKey","sourceCaptureRowId","sleeveType","volatilityTradeDraftId","createdAt","updatedAt"
FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_sourceImportKey_key" ON "Transaction"("sourceImportKey");
CREATE UNIQUE INDEX "Transaction_sourceCaptureRowId_key" ON "Transaction"("sourceCaptureRowId");
CREATE UNIQUE INDEX "Transaction_volatilityTradeDraftId_key" ON "Transaction"("volatilityTradeDraftId");
CREATE UNIQUE INDEX "Transaction_supersedesTransactionId_key" ON "Transaction"("supersedesTransactionId");
CREATE INDEX "Transaction_userId_executedAt_idx" ON "Transaction"("userId","executedAt");
CREATE INDEX "Transaction_assetId_executedAt_idx" ON "Transaction"("assetId","executedAt");
CREATE INDEX "Transaction_ingestionBatchId_idx" ON "Transaction"("ingestionBatchId");

CREATE TABLE "new_ExternalOrderObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "assetId" TEXT,
  "captureRowId" TEXT NOT NULL,
  "ingestionBatchId" TEXT,
  "side" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "filledQuantity" REAL NOT NULL DEFAULT 0,
  "limitPrice" REAL,
  "submittedAt" DATETIME,
  "externalOrderId" TEXT,
  "validUntil" DATETIME,
  "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ExternalOrderObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalOrderObservation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ExternalOrderObservation_captureRowId_fkey" FOREIGN KEY ("captureRowId") REFERENCES "ScreenshotCaptureRow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalOrderObservation_ingestionBatchId_fkey" FOREIGN KEY ("ingestionBatchId") REFERENCES "TradeIngestionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ExternalOrderObservation" (
  "id","userId","assetId","captureRowId","ingestionBatchId","side","status","quantity","filledQuantity","limitPrice","submittedAt","externalOrderId","validUntil","observedAt","rawJson","createdAt","updatedAt"
)
SELECT "id","userId","assetId","captureRowId",NULL,"side","status","quantity","filledQuantity","limitPrice","submittedAt","externalOrderId","validUntil","observedAt","rawJson","createdAt","updatedAt"
FROM "ExternalOrderObservation";
DROP TABLE "ExternalOrderObservation";
ALTER TABLE "new_ExternalOrderObservation" RENAME TO "ExternalOrderObservation";
CREATE UNIQUE INDEX "ExternalOrderObservation_captureRowId_key" ON "ExternalOrderObservation"("captureRowId");
CREATE INDEX "ExternalOrderObservation_userId_assetId_status_observedAt_idx" ON "ExternalOrderObservation"("userId","assetId","status","observedAt");
CREATE INDEX "ExternalOrderObservation_externalOrderId_idx" ON "ExternalOrderObservation"("externalOrderId");
CREATE INDEX "ExternalOrderObservation_ingestionBatchId_idx" ON "ExternalOrderObservation"("ingestionBatchId");

CREATE TABLE "new_GridPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "dailyReviewRunId" TEXT,
  "investmentStrategyRunId" TEXT,
  "assetId" TEXT NOT NULL,
  "strategyVersionId" TEXT,
  "previousPlanId" TEXT,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "summary" TEXT,
  "constraintsJson" TEXT NOT NULL DEFAULT '{}',
  "changeReasonsJson" TEXT NOT NULL DEFAULT '[]',
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "validUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GridPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_dailyReviewRunId_fkey" FOREIGN KEY ("dailyReviewRunId") REFERENCES "DailyReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_investmentStrategyRunId_fkey" FOREIGN KEY ("investmentStrategyRunId") REFERENCES "InvestmentStrategyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_previousPlanId_fkey" FOREIGN KEY ("previousPlanId") REFERENCES "GridPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GridPlan_origin_xor_check" CHECK (("dailyReviewRunId" IS NOT NULL) <> ("investmentStrategyRunId" IS NOT NULL))
);
INSERT INTO "new_GridPlan" (
  "id","userId","dailyReviewRunId","investmentStrategyRunId","assetId","strategyVersionId","previousPlanId","mode","status","summary","constraintsJson","changeReasonsJson","evidenceRefsJson","validUntil","createdAt","updatedAt"
)
SELECT "id","userId","dailyReviewRunId",NULL,"assetId","strategyVersionId","previousPlanId","mode","status","summary","constraintsJson","changeReasonsJson","evidenceRefsJson","validUntil","createdAt","updatedAt"
FROM "GridPlan";
DROP TABLE "GridPlan";
ALTER TABLE "new_GridPlan" RENAME TO "GridPlan";
CREATE INDEX "GridPlan_userId_assetId_createdAt_idx" ON "GridPlan"("userId","assetId","createdAt");
CREATE INDEX "GridPlan_dailyReviewRunId_idx" ON "GridPlan"("dailyReviewRunId");
CREATE INDEX "GridPlan_investmentStrategyRunId_idx" ON "GridPlan"("investmentStrategyRunId");
CREATE INDEX "GridPlan_strategyVersionId_idx" ON "GridPlan"("strategyVersionId");
CREATE INDEX "GridPlan_previousPlanId_idx" ON "GridPlan"("previousPlanId");

CREATE TABLE "GridOrderDraftEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gridOrderDraftId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "quantity" REAL,
  "price" REAL,
  "sourceType" TEXT NOT NULL DEFAULT 'system',
  "sourceRef" TEXT,
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GridOrderDraftEvent_gridOrderDraftId_fkey" FOREIGN KEY ("gridOrderDraftId") REFERENCES "GridOrderDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GridOrderDraftEvent_eventType_check" CHECK ("eventType" IN ('proposed','accepted','submitted','partially_filled','filled','cancelled','expired','superseded'))
);
CREATE UNIQUE INDEX "GridOrderDraftEvent_gridOrderDraftId_idempotencyKey_key" ON "GridOrderDraftEvent"("gridOrderDraftId","idempotencyKey");
CREATE INDEX "GridOrderDraftEvent_gridOrderDraftId_occurredAt_idx" ON "GridOrderDraftEvent"("gridOrderDraftId","occurredAt");
CREATE INDEX "GridOrderDraftEvent_eventType_occurredAt_idx" ON "GridOrderDraftEvent"("eventType","occurredAt");
INSERT INTO "GridOrderDraftEvent" (
  "id","gridOrderDraftId","idempotencyKey","eventType","quantity","price","sourceType","sourceRef","evidenceRefsJson","metadataJson","occurredAt","createdAt"
)
SELECT
  lower(hex(randomblob(16))),
  "id",
  'migration:initial-state',
  CASE
    WHEN "status"='filled' THEN 'filled'
    WHEN "status" IN ('cancelled','dismissed') THEN 'cancelled'
    WHEN "status"='expired' THEN 'expired'
    WHEN "status"='superseded' THEN 'superseded'
    WHEN "status" IN ('partial','partially_filled') THEN 'partially_filled'
    WHEN "status"='submitted' THEN 'submitted'
    WHEN "status"='accepted' THEN 'accepted'
    ELSE 'proposed'
  END,
  "quantity","price",'system','migration:20261008_trade_plan_ledger',"evidenceRefsJson",
  json_object('legacyStatus',"status"),"createdAt","createdAt"
FROM "GridOrderDraft";

CREATE TABLE "TradeIngestionRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "rowIndex" INTEGER NOT NULL,
  "rowHash" TEXT NOT NULL,
  "sourceRef" TEXT,
  "rowType" TEXT NOT NULL,
  "normalizedJson" TEXT NOT NULL DEFAULT '{}',
  "rawJson" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'staged',
  "dedupeKey" TEXT,
  "conflictJson" TEXT NOT NULL DEFAULT '{}',
  "transactionId" TEXT,
  "externalOrderObservationId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TradeIngestionRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TradeIngestionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeIngestionRow_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TradeIngestionRow_externalOrderObservationId_fkey" FOREIGN KEY ("externalOrderObservationId") REFERENCES "ExternalOrderObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TradeIngestionRow_status_check" CHECK ("status" IN ('staged','new','duplicate','conflict','blocked','confirmed','failed'))
);
CREATE UNIQUE INDEX "TradeIngestionRow_batchId_rowIndex_key" ON "TradeIngestionRow"("batchId","rowIndex");
CREATE UNIQUE INDEX "TradeIngestionRow_transactionId_key" ON "TradeIngestionRow"("transactionId");
CREATE UNIQUE INDEX "TradeIngestionRow_externalOrderObservationId_key" ON "TradeIngestionRow"("externalOrderObservationId");
CREATE INDEX "TradeIngestionRow_batchId_status_idx" ON "TradeIngestionRow"("batchId","status");
CREATE INDEX "TradeIngestionRow_rowHash_idx" ON "TradeIngestionRow"("rowHash");
CREATE INDEX "TradeIngestionRow_dedupeKey_idx" ON "TradeIngestionRow"("dedupeKey");

CREATE TABLE "TradeReconciliationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" TEXT NOT NULL DEFAULT 'fams.trade-reconciliation-run.v1',
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "ingestionBatchId" TEXT,
  "dailyReviewRunId" TEXT,
  "accountSource" TEXT,
  "status" TEXT NOT NULL,
  "asOf" DATETIME NOT NULL,
  "inputHash" TEXT NOT NULL,
  "coverageJson" TEXT NOT NULL DEFAULT '{}',
  "summaryJson" TEXT NOT NULL DEFAULT '{}',
  "differencesJson" TEXT NOT NULL DEFAULT '[]',
  "inputRefsJson" TEXT NOT NULL DEFAULT '{}',
  "holdingsHash" TEXT,
  "transactionsHash" TEXT,
  "ordersHash" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeReconciliationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeReconciliationRun_ingestionBatchId_fkey" FOREIGN KEY ("ingestionBatchId") REFERENCES "TradeIngestionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TradeReconciliationRun_dailyReviewRunId_fkey" FOREIGN KEY ("dailyReviewRunId") REFERENCES "DailyReviewRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TradeReconciliationRun_status_check" CHECK ("status" IN ('ready','warning','blocked'))
);
CREATE UNIQUE INDEX "TradeReconciliationRun_userId_idempotencyKey_key" ON "TradeReconciliationRun"("userId","idempotencyKey");
CREATE INDEX "TradeReconciliationRun_userId_asOf_idx" ON "TradeReconciliationRun"("userId","asOf");
CREATE INDEX "TradeReconciliationRun_ingestionBatchId_idx" ON "TradeReconciliationRun"("ingestionBatchId");
CREATE INDEX "TradeReconciliationRun_dailyReviewRunId_idx" ON "TradeReconciliationRun"("dailyReviewRunId");

CREATE TABLE "PlanExecutionLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "linkKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gridOrderDraftId" TEXT,
  "externalOrderObservationId" TEXT,
  "transactionId" TEXT,
  "matchStatus" TEXT NOT NULL DEFAULT 'suggested',
  "matchMethod" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "reason" TEXT,
  "evidenceRefsJson" TEXT NOT NULL DEFAULT '[]',
  "confirmedBy" TEXT,
  "confirmedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlanExecutionLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlanExecutionLink_gridOrderDraftId_fkey" FOREIGN KEY ("gridOrderDraftId") REFERENCES "GridOrderDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlanExecutionLink_externalOrderObservationId_fkey" FOREIGN KEY ("externalOrderObservationId") REFERENCES "ExternalOrderObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlanExecutionLink_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlanExecutionLink_source_xor_check" CHECK (("externalOrderObservationId" IS NOT NULL) <> ("transactionId" IS NOT NULL)),
  CONSTRAINT "PlanExecutionLink_draft_state_check" CHECK (("matchStatus"='unmatched' AND "gridOrderDraftId" IS NULL) OR ("matchStatus"<>'unmatched' AND "gridOrderDraftId" IS NOT NULL)),
  CONSTRAINT "PlanExecutionLink_status_check" CHECK ("matchStatus" IN ('suggested','confirmed','rejected','unmatched','blocked')),
  CONSTRAINT "PlanExecutionLink_confidence_check" CHECK ("confidence">=0 AND "confidence"<=1)
);
CREATE UNIQUE INDEX "PlanExecutionLink_linkKey_key" ON "PlanExecutionLink"("linkKey");
CREATE INDEX "PlanExecutionLink_gridOrderDraftId_matchStatus_idx" ON "PlanExecutionLink"("gridOrderDraftId","matchStatus");
CREATE INDEX "PlanExecutionLink_userId_matchStatus_createdAt_idx" ON "PlanExecutionLink"("userId","matchStatus","createdAt");
CREATE INDEX "PlanExecutionLink_transactionId_matchStatus_idx" ON "PlanExecutionLink"("transactionId","matchStatus");
CREATE INDEX "PlanExecutionLink_externalOrderObservationId_matchStatus_idx" ON "PlanExecutionLink"("externalOrderObservationId","matchStatus");

CREATE TABLE IF NOT EXISTS "_FamsManualMigration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detailsJson" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "_FamsManualMigration"("id","detailsJson") VALUES (
  '20261008_trade_plan_ledger',
  '{"schemaVersion":"fams.trade-plan-ledger.v1","scoped":true}'
);

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
PRAGMA integrity_check;
