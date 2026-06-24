import { positionAdviceService } from '../src/services/position/positionAdviceService.js'
import { prisma } from '../src/db/prisma.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

const ALLOWED_ACTIONS = new Set(['ADD', 'REDUCE', 'HOLD', 'OBSERVE', 'NO_ACTION'])

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-position-advice-engine')
  const batch = await positionAdviceService.getPortfolioAdvice('default', {
    includeExternalAnalysis: false,
  })

  assert(batch.schemaVersion === 'position.advice.batch.v1', 'batch schema version mismatch')
  assert(batch.results.length > 0, 'expected at least one position advice result')

  for (const result of batch.results) {
    const { factSet, advice } = result
    assert(factSet.schemaVersion === 'position.advice.factset.v1', 'factset schema version mismatch')
    assert(factSet.position.positionId.length > 0, 'missing position id')
    assert(factSet.portfolio.totalMarketValue >= 0, 'portfolio value must be non-negative')
    assert(factSet.position.currentWeight >= 0, 'position weight must be non-negative')
    assert(ALLOWED_ACTIONS.has(advice.action), `unexpected advice action: ${advice.action}`)
    assert(advice.evidenceRefs.length > 0, 'advice must include evidenceRefs')
    assert(advice.targetWeightRange.length === 2, 'target weight range must have two values')
    assert(advice.targetWeightRange[0] <= advice.targetWeightRange[1], 'target weight range must be sorted')

    if (advice.confidence === 'low' || advice.confidence === 'insufficient') {
      assert(advice.action !== 'ADD', 'low/insufficient confidence must not produce ADD')
    }
  }

  const firstPositionId = batch.results[0]?.factSet.position.positionId
  assert(firstPositionId, 'missing first position id')
  const single = await positionAdviceService.getPositionAdvice(firstPositionId, {
    includeExternalAnalysis: false,
  })
  assert(single.factSet.position.positionId === firstPositionId, 'single advice position mismatch')

  const expiredAt = new Date(Date.now() - 60_000)
  await prisma.positionAdviceCache.updateMany({
    where: {
      userId: 'default',
      positionId: firstPositionId,
      factsetSchemaVersion: 'position.advice.factset.v1',
    },
    data: {
      status: 'fresh',
      staleAt: expiredAt,
      nextRefreshAfter: expiredAt,
    },
  })
  const stale = await positionAdviceService.getPositionAdvice(firstPositionId, {
    includeExternalAnalysis: false,
  })
  assert(stale.cache?.status === 'stale', `expected stale position advice cache, got ${stale.cache?.status}`)
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const refreshedAfterStale = await positionAdviceService.getPositionAdvice(firstPositionId, {
    includeExternalAnalysis: false,
  })
  assert(refreshedAfterStale.cache?.status === 'fresh', `expected background refreshed position advice cache, got ${refreshedAfterStale.cache?.status}`)

  const summary = batch.results.reduce<Record<string, number>>((acc, result) => {
    acc[result.advice.action] = (acc[result.advice.action] ?? 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    ok: true,
    checkedPositions: batch.results.length,
    actionSummary: summary,
    firstPosition: {
      symbol: single.factSet.position.symbol,
      action: single.advice.action,
      confidence: single.advice.confidence,
      blockedReasons: single.advice.blockedReasons,
      staleStatus: stale.cache?.status,
      refreshedAfterStaleStatus: refreshedAfterStale.cache?.status,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
