CREATE TABLE IF NOT EXISTS "McpAccessToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopesJson" TEXT NOT NULL DEFAULT '[]',
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "McpAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpAccessToken_tokenHash_key" ON "McpAccessToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "McpAccessToken_userId_revokedAt_expiresAt_idx" ON "McpAccessToken"("userId", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "McpAccessToken_tokenPrefix_idx" ON "McpAccessToken"("tokenPrefix");
