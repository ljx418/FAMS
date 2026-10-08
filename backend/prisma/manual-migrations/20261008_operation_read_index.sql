-- FAMS Operation read-path index.
-- This migration is additive and does not change account, operation, or trading facts.

.bail on
.timeout 30000
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS "_FamsManualMigration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detailsJson" TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "Operation_userId_requestedAt_idx"
  ON "Operation"("userId", "requestedAt");

INSERT OR IGNORE INTO "_FamsManualMigration" ("id", "detailsJson")
VALUES (
  '20261008_operation_read_index',
  '{"scope":"additive_index_only","table":"Operation","columns":["userId","requestedAt"]}'
);

COMMIT;
