import assert from 'node:assert/strict'
import { dividendLowVolFormalProviderIngestionService } from '../src/services/dividend-low-vol/formalProviderIngestionService.js'

async function main() {
  const audit = dividendLowVolFormalProviderIngestionService.buildAudit()
  assert.equal(audit.schemaVersion, 'dividend.low_vol.provider_ingestion_audit.v1')
  assert.deepEqual(audit.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(audit.formalProviderConfig.providers.some((provider) => String(provider.tokenRedacted).includes(process.env.TUSHARE_TOKEN || '__never__')), false)
  const fields = audit.fieldContracts.map((item) => item.field)
  for (const field of [
    'dividend_history',
    'cash_dividend_per_share',
    'income_revenue',
    'income_net_profit',
    'cashflow_operating_cash_flow',
    'balance_sheet_debt_ratio',
    'fina_indicator_roe',
    'daily_basic_market_cap',
    'daily_basic_pe_pb_dividend_yield',
    'stk_limit_limit_up_down',
    'shenwan_industry_classification',
  ]) {
    assert.ok(fields.includes(field), `${field} contract missing`)
  }
  assert.ok(audit.fieldContracts.every((item) => item.provider && item.sourceTable && item.endpoint))
  assert.equal(audit.decision.canMarkProviderFallbackVerified, false)
  const originalFamsToken = process.env.FAMS_TUSHARE_TOKEN
  const originalToken = process.env.TUSHARE_TOKEN
  delete process.env.FAMS_TUSHARE_TOKEN
  delete process.env.TUSHARE_TOKEN
  const blockedRun = await dividendLowVolFormalProviderIngestionService.runTushareProbe({ symbols: ['000001'], dryRun: false })
  assert.equal(blockedRun.status, 'blocked_provider_not_configured')
  assert.equal(blockedRun.tokenInAuditPackage, false)
  const contractDryRun = await dividendLowVolFormalProviderIngestionService.runTushareProbe({ symbols: ['000001'], dryRun: true })
  assert.equal(contractDryRun.status, 'dry_run_contract_only')
  assert.equal(contractDryRun.summary.endpointsAttempted, 8)
  process.env.FAMS_TUSHARE_TOKEN = 'test-token-redacted'
  const dryRun = await dividendLowVolFormalProviderIngestionService.runTushareProbe({ symbols: ['000001'], dryRun: true })
  assert.equal(dryRun.tokenInAuditPackage, false)
  assert.equal(dryRun.summary.endpointsAttempted, 8)
  assert.ok(dryRun.fieldContracts.every((item) => !JSON.stringify(item).includes('test-token-redacted')))
  if (originalFamsToken === undefined) delete process.env.FAMS_TUSHARE_TOKEN
  else process.env.FAMS_TUSHARE_TOKEN = originalFamsToken
  if (originalToken === undefined) delete process.env.TUSHARE_TOKEN
  else process.env.TUSHARE_TOKEN = originalToken
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    totalFields: audit.summary.totalFields,
    missing: audit.summary.missing,
    partial: audit.summary.partial,
    tokenInAuditPackage: audit.formalProviderConfig.providers.some((provider) => provider.tokenInAuditPackage),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
