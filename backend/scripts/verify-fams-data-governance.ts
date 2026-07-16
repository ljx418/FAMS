import assert from 'node:assert/strict'
import {
  assertTradeBoundaryLocked,
  baseAudit,
  checkedAtIso,
  createNextStageAuditDir,
  runNextStagePortfolioBacktest,
  writeAuditJson,
} from './lib/nextStagePortfolioBacktestScenario.js'

async function main() {
  const checkedAt = checkedAtIso()
  const auditDir = await createNextStageAuditDir(checkedAt)
  const result = await runNextStagePortfolioBacktest()
  assertTradeBoundaryLocked(result)

  const dataGovernanceAudit = result.dataGovernanceAudit
  assert.ok(dataGovernanceAudit, 'dataGovernanceAudit missing')
  assert.ok(['passed', 'blocked'].includes(dataGovernanceAudit.status))
  assert.ok(Array.isArray(dataGovernanceAudit.items))
  assert.ok(dataGovernanceAudit.items.length >= 4, 'data governance should cover release-critical fields')

  for (const item of dataGovernanceAudit.items) {
    assert.ok(item.fieldId, 'fieldId missing')
    assert.ok(item.scope, `scope missing for ${item.fieldId}`)
    assert.ok(item.sourceProvider, `sourceProvider missing for ${item.fieldId}`)
    assert.ok(item.sourceEndpoint, `sourceEndpoint missing for ${item.fieldId}`)
    assert.ok(item.fetchedAt, `fetchedAt missing for ${item.fieldId}`)
    assert.ok(['fresh', 'stale', 'unknown'].includes(item.freshnessStatus), `freshness invalid for ${item.fieldId}`)
    assert.equal(typeof item.coveragePercent, 'number', `coveragePercent missing for ${item.fieldId}`)
    assert.ok(Array.isArray(item.evidenceRefs), `evidenceRefs missing for ${item.fieldId}`)
    assert.ok(!JSON.stringify(item).match(/api[_-]?key|secret|token/i), `secret-like text leaked for ${item.fieldId}`)
  }

  const dataSourceAudit = {
    ...baseAudit('fams.data_source_audit.v1', checkedAt),
    status: dataGovernanceAudit.status,
    fields: dataGovernanceAudit.items.map((item: any) => ({
      fieldId: item.fieldId,
      scope: item.scope,
      sourceProvider: item.sourceProvider,
      providerClass: item.providerClass,
      sourceEndpoint: item.sourceEndpoint,
      crossCheckStatus: item.crossCheckStatus,
      evidenceRefs: item.evidenceRefs,
      blockers: item.blockers || [],
    })),
  }

  const freshnessAudit = {
    ...baseAudit('fams.provider_freshness_audit.v1', checkedAt),
    status: dataGovernanceAudit.status,
    freshness: dataGovernanceAudit.items.map((item: any) => ({
      fieldId: item.fieldId,
      asOfDate: item.asOfDate,
      fetchedAt: item.fetchedAt,
      freshnessStatus: item.freshnessStatus,
      coverageStatus: item.coverageStatus,
      coveragePercent: item.coveragePercent,
      warnings: item.warnings || [],
      blockers: item.blockers || [],
    })),
  }

  const audit = {
    ...baseAudit('fams.next_stage.data_governance_acceptance.v1', checkedAt),
    status: dataGovernanceAudit.status,
    dataGovernanceAudit,
    dataSourceAudit,
    freshnessAudit,
    conclusion: {
      dataGovernanceEvidencePresent: true,
      criticalFieldsExposeSourceAndFreshness: true,
      providerSecretsNotLogged: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }

  const paths = {
    dataGovernanceAudit: await writeAuditJson(auditDir, '15_data_governance_audit.json', audit),
    dataSourceAudit: await writeAuditJson(auditDir, 'data_source_audit.json', dataSourceAudit),
    providerFreshnessAudit: await writeAuditJson(auditDir, 'provider_freshness_audit.json', freshnessAudit),
  }
  console.log(JSON.stringify({ ...audit, auditPaths: paths }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
