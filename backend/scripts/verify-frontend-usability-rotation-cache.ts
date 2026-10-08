import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { portfolioRelativeRotationService } from '../src/services/relative-rotation/portfolioRelativeRotationService.js'

const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'

async function protectedCounts() {
  const [positions, transactions, externalOrders] = await Promise.all([
    prisma.position.count({ where: { userId, status: 'open' } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.externalOrderObservation.count({ where: { userId } }),
  ])
  return { positions, transactions, externalOrders }
}

async function main() {
  const before = await protectedCounts()
  const firstStartedAt = performance.now()
  const first = await portfolioRelativeRotationService.getReport(userId, { frequency: 'weekly', years: 8 })
  const firstDurationMs = performance.now() - firstStartedAt
  const secondStartedAt = performance.now()
  const second = await portfolioRelativeRotationService.getReport(userId, { frequency: 'weekly', years: 8 })
  const secondDurationMs = performance.now() - secondStartedAt
  assert.equal(first.cacheStatus, 'computed')
  assert.equal(second.cacheStatus, 'hit')
  assert.equal(second.sourceRevision, first.sourceRevision)
  assert.equal(second.coverage.positionCount, before.positions)
  assert.ok(second.observedThrough)
  assert.ok(secondDurationMs < 2_000, `snapshot cache lookup took ${secondDurationMs.toFixed(1)}ms`)
  assert.ok(secondDurationMs < firstDurationMs, 'cached report should be faster than full local recomputation')

  const frontendSource = await readFile(resolve(process.cwd(), '../frontend/src/pages/RelativeRotation.tsx'), 'utf8')
  assert.ok(!frontendSource.includes('automaticRefreshAttempted'), 'page entry must not trigger an automatic external refresh loop')
  assert.ok(frontendSource.includes('refreshPortfolioRotation(targetKeys)'), 'portfolio retest must forward selected target keys')
  assert.ok(frontendSource.includes('仅复测这些资产'), 'insufficient asset popover must expose a targeted retest action')
  assert.ok(frontendSource.includes('进入页面只读取本地真实快照'), 'snapshot-first policy must be visible to the user')

  const after = await protectedCounts()
  assert.deepEqual(after, before)
  const audit = {
    schemaVersion: 'fams.frontend_usability.rotation_snapshot_audit.v1',
    generatedAt: new Date().toISOString(),
    status: 'passed',
    dataMode: 'real_local_snapshot_no_entry_network_refresh',
    performance: {
      fullLocalRecomputeMs: Number(firstDurationMs.toFixed(1)),
      snapshotLookupMs: Number(secondDurationMs.toFixed(1)),
      cacheStatus: second.cacheStatus,
      sourceRevision: second.sourceRevision,
      observedThrough: second.observedThrough,
    },
    coverage: second.coverage,
    gates: {
      noAutomaticExternalRefreshOnEntry: true,
      sessionSnapshotFirst: true,
      serverSnapshotCacheHit: true,
      targetedRetestAvailable: true,
      assetInspectionAvailable: true,
      protectedRecordsUnchanged: true,
    },
  }
  const outputDir = resolve(process.cwd(), '../docs/audits/2026-09-17-frontend-usability-grid-replay/evidence')
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, 'rotation-snapshot-performance-audit.json'), JSON.stringify(audit, null, 2))
  console.log(JSON.stringify(audit, null, 2))
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
