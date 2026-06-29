import assert from 'node:assert/strict'
import { dividendLowVolDataReadinessService } from '../src/services/dividend-low-vol/dividendLowVolDataReadinessService.js'
import { prisma } from '../src/db/prisma.js'

async function main() {
  const audit = await dividendLowVolDataReadinessService.buildAudit()
  assert.equal(audit.schemaVersion, 'dividend.low_vol.data_readiness_audit.v1')
  assert.deepEqual(audit.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(Array.isArray(audit.blockers))
  assert.ok(audit.canonicalQuoteList.path.endsWith('a-share-quote-list-canonical.json'))
  assert.equal(audit.providerIngestion.tokenInAuditPackage, false)
  assert.equal(audit.gates.formalValidationPromotionAllowed, audit.gates.researchScanReady)
  assert.equal(audit.gates.freeSourceValidationAllowed, audit.gates.researchScanReady)
  assert.equal(audit.dataTrust.schemaVersion, 'dividend.low_vol.data_readiness_trust.v1')
  assert.ok(['A', 'B', 'C', 'D', 'INSUFFICIENT'].includes(audit.dataTrust.grade), 'data readiness must expose trust grade')
  assert.ok(Number.isFinite(audit.dataTrust.confidencePercent), 'data readiness must expose confidence percent')
  assert.match(audit.dataTrust.note, /prevents display completeness/, 'data trust note must prevent false authenticity claims')
  assert.ok(Array.isArray(audit.researchBlockers))
  assert.ok(Array.isArray(audit.formalBlockers))
  assert.ok(Array.isArray(audit.providerUpgradeBlockers))
  if (audit.marketData.scanCoveragePercent < 80) {
    assert.ok(audit.dataTrust.blockers.includes('market_bar_full_universe_coverage_below_80_percent'), 'low market bar coverage must lower trust')
  }
  if (audit.providerMode === 'free_source_research') {
    assert.ok(audit.dataTrust.warnings.includes('free_source_research_not_formal_provider'), 'free source mode must be visible as research-only warning')
  }
  if (!audit.gates.researchScanReady) {
    assert.ok(audit.researchBlockers.length > 0, 'blocked research readiness must explain research blockers')
    assert.equal(audit.gates.persistentFullAScanAllowed, false)
  } else {
    assert.equal(audit.gates.persistentFullAScanAllowed, true)
  }
  if (!audit.gates.fullUniverseReady) {
    assert.ok(audit.researchBlockers.length > 0, 'incomplete free-source readiness must explain research blockers')
  }
  assert.ok(!audit.formalBlockers.includes('formal_provider_token_missing'), 'Tushare token must not block free-source validation')
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    providerMode: audit.providerMode,
    dataTrust: audit.dataTrust,
    canonicalItems: audit.canonicalQuoteList.itemCount,
    marketBarSymbols: audit.marketData.marketBarSymbols,
    featureSymbols: audit.marketData.marketFeatureSymbols,
    securityStatusSymbols: audit.securityAndTradeability.securityStatusSymbols,
    tradeabilitySymbols: audit.securityAndTradeability.tradeabilitySymbols,
    blockers: audit.blockers,
    researchBlockers: audit.researchBlockers,
    formalBlockers: audit.formalBlockers,
    providerUpgradeBlockers: audit.providerUpgradeBlockers,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
