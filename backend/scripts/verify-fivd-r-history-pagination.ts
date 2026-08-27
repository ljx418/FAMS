import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { fivdRInterventionService } from '../src/services/analysis/fivdRInterventionService.js'

async function main() {
  const snapshots = await analysisService.listFivdRResearchSnapshots('default', {
    limit: 2,
    page: 1,
  }) as any
  assert.equal(snapshots.schemaVersion, 'fivd.r.research_snapshot_list.v1')
  assert.equal(snapshots.pagination.page, 1)
  assert.equal(snapshots.pagination.limit, 2)
  assert.ok(snapshots.snapshots.length <= 2)
  assert.ok(snapshots.pagination.total >= snapshots.snapshots.length)

  const noSnapshotMatch = await analysisService.listFivdRResearchSnapshots('default', {
    limit: 5,
    page: 1,
    query: '__fivd_history_no_match__',
  }) as any
  assert.equal(noSnapshotMatch.pagination.total, 0)
  assert.deepEqual(noSnapshotMatch.snapshots, [])

  const watch = await fivdRInterventionService.listReviewsPage({
    userId: 'default',
    decision: 'manual_watch',
    limit: 2,
    page: 1,
  })
  assert.equal(watch.pagination.page, 1)
  assert.equal(watch.pagination.limit, 2)
  assert.ok(watch.reviews.length <= 2)
  assert.ok(watch.pagination.total >= watch.reviews.length)

  const noWatchMatch = await fivdRInterventionService.listReviewsPage({
    userId: 'default',
    decision: 'manual_watch',
    limit: 5,
    page: 1,
    query: '__fivd_history_no_match__',
  })
  assert.equal(noWatchMatch.pagination.total, 0)
  assert.deepEqual(noWatchMatch.reviews, [])

  console.log(JSON.stringify({
    status: 'PASS',
    snapshots: snapshots.pagination,
    watch: watch.pagination,
    noMatchFilters: true,
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
