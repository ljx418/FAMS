import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { fivdRInterventionService } from '../src/services/analysis/fivdRInterventionService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const verificationDir = path.resolve(process.cwd(), '..', '.verification')
  await fs.mkdir(verificationDir, { recursive: true })

  const position = await prisma.position.findFirst({
    where: { userId: 'default', status: 'open', asset: { type: { not: 'cash' } } },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  assert(position, 'no real non-cash position found for FIVD-R intervention review')

  const fivdRRun = await analysisService.getFivdRAnalysis('default', {
    scope: 'position',
    positionId: position.id,
    forceRefresh: false,
  })
  assert(fivdRRun.scope === 'position', 'FIVD-R run is not position scope')
  assert(fivdRRun.runId, 'FIVD-R runId missing')

  const evidenceRefs = [
    `fivd-r-run:${fivdRRun.runId}`,
    ...(fivdRRun.evidenceGate?.evidenceRefs || []),
  ]
  const first = await fivdRInterventionService.createReview({
    userId: 'default',
    runId: fivdRRun.runId,
    positionId: position.id,
    symbol: position.asset.symbol,
    decision: 'reject_trade_action',
    reason: 'validation_evidence 未通过，本次人工复核拒绝进入交易计划。',
    reviewer: 'phase8_acceptance',
    modelResultRef: `fivd-r:${fivdRRun.runId}`,
    evidenceRefs,
    override: {
      allowedActions: ['RESEARCH', 'OBSERVE'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    },
  })
  const second = await fivdRInterventionService.createReview({
    userId: 'default',
    runId: fivdRRun.runId,
    positionId: position.id,
    symbol: position.asset.symbol,
    decision: 'request_more_evidence',
    reason: '追加复核记录：要求补充 validation evidence 后再进入人工交易计划草案。',
    reviewer: 'phase8_acceptance',
    modelResultRef: `fivd-r:${fivdRRun.runId}`,
    evidenceRefs,
    override: {
      nextReviewTrigger: 'validation_evidence_passed',
    },
  })
  const reviews = await fivdRInterventionService.listReviews({
    userId: 'default',
    runId: fivdRRun.runId,
  })
  const chainAudit = await fivdRInterventionService.verifyChain({
    userId: 'default',
    runId: fivdRRun.runId,
  })

  assert(reviews.length >= 2, 'append-only reviews were not both recorded')
  assert(reviews.some((record) => record.id === first.id), 'first intervention review missing')
  assert(reviews.some((record) => record.id === second.id), 'second intervention review missing')
  const persistedFirst = reviews.find((record) => record.id === first.id)
  const persistedSecond = reviews.find((record) => record.id === second.id)
  assert(persistedFirst?.reason === first.reason, 'first review was overwritten')
  assert(persistedSecond?.previousHash === first.recordHash, 'second review does not link to first hash')
  assert(chainAudit.ok, 'intervention review hash chain audit failed')
  assert(reviews.every((record) => record.decision !== 'approve_trade_action'), 'intervention review must not approve formal trade action')

  const audit = {
    schemaVersion: 'fivd.r.phase8.intervention_review_acceptance.v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    run: {
      runId: fivdRRun.runId,
      positionId: position.id,
      symbol: position.asset.symbol,
      name: position.asset.name,
      summaryStatus: fivdRRun.summary?.status,
      blockedReasons: fivdRRun.summary?.blockedReasons || [],
    },
    records: reviews.map((record) => ({
      id: record.id,
      decision: record.decision,
      reason: record.reason,
      reviewer: record.reviewer,
      previousHash: record.previousHash,
      recordHash: record.recordHash,
      createdAt: record.createdAt.toISOString(),
    })),
    chainAudit,
  }
  const auditPath = path.join(verificationDir, 'fivd-r-phase8-intervention-review-audit.json')
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2))
  console.log(JSON.stringify({
    ok: true,
    auditPath,
    checked: {
      runId: fivdRRun.runId,
      symbol: position.asset.symbol,
      records: reviews.length,
      chainOk: chainAudit.ok,
      firstUnchanged: persistedFirst?.reason === first.reason,
      secondLinksFirst: persistedSecond?.previousHash === first.recordHash,
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
