import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { resolveDatabaseUrl } from '../src/db/databaseUrl.js'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const userId = `fivd-runtime-test-${suffix}`
const symbols = [`FR${suffix.slice(-7)}A`, `FR${suffix.slice(-7)}B`]
const originalAssess = valueAssessmentService.assessPosition.bind(valueAssessmentService)

try {
  const caseVariant = resolveDatabaseUrl('file:/mnt/c/workSpace/financial-asset-manager/backend/prisma/dev.db')
  assert.equal(caseVariant.sqlitePath, resolve(import.meta.dirname, '../prisma/dev.db'))
  assert.match(caseVariant.url, /connection_limit=4/)

  await initializePrisma()
  await prisma.user.create({ data: { id: userId, email: `${userId}@local.test`, passwordHash: 'test-only', name: 'FIVD runtime test' } })
  const assets = await Promise.all(symbols.map((symbol, index) => prisma.asset.create({
    data: { symbol, name: `FIVD runtime asset ${index + 1}`, type: 'fund', exchange: 'SH' },
  })))
  await Promise.all(assets.map((asset, index) => prisma.position.create({
    data: {
      userId,
      assetId: asset.id,
      openKey: `${userId}:${asset.id}`,
      quantity: 100 + index,
      avgCost: 10 + index,
      currentPrice: 10.5 + index,
      marketValue: (100 + index) * (10.5 + index),
      costBasis: (100 + index) * (10 + index),
    },
  })))

  let callCount = 0
  valueAssessmentService.assessPosition = (async (position: any) => {
    callCount += 1
    if (callCount === 1) throw new Error('synthetic_single_asset_valuation_failure')
    return {
      schemaVersion: 'value.assessment.v1',
      generatedAt: new Date().toISOString(),
      assetId: position.assetId,
      symbol: position.asset.symbol,
      assetName: position.asset.name,
      assetType: position.asset.type,
      valuation: { status: 'insufficient', blockedReasons: ['synthetic_evidence_missing'], confidence: 'insufficient' },
      facts: [],
      evidenceRefs: [],
      providerTrace: {},
    } as any
  }) as typeof valueAssessmentService.assessPosition

  const result = await analysisService.getFivdRAnalysis(userId, { scope: 'portfolio' })
  assert.equal(result.schemaVersion, 'fivd.r.analysis.result.v1')
  assert.equal(result.portfolio.holdingsCount, 2)
  assert.equal(result.portfolio.holdings.filter((holding: any) => holding.runtimeWarnings?.length > 0).length, 1)
  assert.ok(result.summary.blockedReasons.includes('valuation_runtime_unavailable'))

  console.log(JSON.stringify({
    ok: true,
    sqlitePath: caseVariant.sqlitePath,
    holdingsCount: result.portfolio.holdingsCount,
    isolatedFailures: 1,
    responseStatus: result.summary.status,
  }, null, 2))
} finally {
  valueAssessmentService.assessPosition = originalAssess
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await prisma.asset.deleteMany({ where: { symbol: { in: symbols } } }).catch(() => undefined)
  await prisma.$disconnect()
}
