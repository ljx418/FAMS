import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

function assertResearchOnly(report: any) {
  assert.equal(report.summary?.tradeActionAllowed, false, 'taxonomy must not allow trade action')
  assert.equal(report.summary?.manualTradeDraftAllowed, false, 'taxonomy must not allow manual trade draft while validation is blocked')
  assert.equal(report.summary?.autoTradeAllowed, false, 'taxonomy must keep auto trade disabled')
  assert.ok(report.prohibitedActions?.includes('ADD'), 'taxonomy must prohibit ADD')
  assert.ok(report.prohibitedActions?.includes('REDUCE'), 'taxonomy must prohibit REDUCE')
  assert.ok(report.prohibitedActions?.includes('AUTO_TRADE'), 'taxonomy must prohibit AUTO_TRADE')
}

async function main() {
  const audit = await analysisService.createFivdRValidationRetestAudit('default', {
    candidateLimit: 20,
  }) as any
  assert.equal(audit.schemaVersion, 'fivd.r.validation_evidence_retest_audit.v1')
  assert.ok(audit.operationId, 'validation retest must create an operation')
  assert.ok(audit.validationFailureTaxonomy, 'validation retest must include validationFailureTaxonomy')
  assert.equal(audit.validationFailureTaxonomy.schemaVersion, 'fivd.r.validation_failure_taxonomy.v1')
  assert.ok(Array.isArray(audit.validationFailureTaxonomy.failureCategories), 'taxonomy must expose failure categories')
  assert.ok(audit.validationFailureTaxonomy.failureCategories.length > 0, 'taxonomy must explain at least one failure category')
  assertResearchOnly(audit.validationFailureTaxonomy)
  assert.ok(audit.artifactRefs.some((ref: string) => ref.endsWith(':validation_failure_taxonomy.json')), 'operation must expose validation_failure_taxonomy artifact')

  const operation = await prisma.operation.findUnique({ where: { id: audit.operationId } })
  assert.ok(operation, 'operation must be persisted')
  const result = JSON.parse(operation!.resultJson || '{}')
  assert.ok(result.artifacts?.['validation_evidence_retest_report.json'], 'operation artifacts must include retest report')
  assert.ok(result.artifacts?.['validation_failure_taxonomy.json'], 'operation artifacts must include taxonomy report')

  const latest = await analysisService.getLatestFivdRValidationReport('default') as any
  assert.equal(latest.schemaVersion, 'fivd.r.validation_failure_taxonomy.v1')
  assert.ok(latest.operationId, 'latest report should reference the latest audit operation when available')
  assertResearchOnly(latest)

  console.log(JSON.stringify({
    ok: true,
    operationId: audit.operationId,
    status: audit.validationFailureTaxonomy.status,
    blocker: audit.validationFailureTaxonomy.summary.blocker,
    failureCategories: audit.validationFailureTaxonomy.failureCategories.map((item: any) => ({
      category: item.category,
      severity: item.severity,
    })),
    recommendation: audit.validationFailureTaxonomy.recommendation,
    prohibitedActions: audit.validationFailureTaxonomy.prohibitedActions,
    artifactRefs: audit.artifactRefs,
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
