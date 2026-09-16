import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { executionIsolationService } from '../src/services/formal-release/executionIsolationService.js'
import type { PortfolioManualPlanDraft } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function compile(name: string) {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', name), 'utf8'))
  return new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false }).compile(schema)
}
function reject(label: string, validate: any, value: unknown) { assert.equal(validate(value), false, `${label} unexpectedly passed`); return label }

async function main() {
  const validateAudit = await compile('ftr-5-execution-isolation-audit.schema.json')
  const validateApproval = await compile('ftr-5-production-adapter-approval-record.schema.json')
  const draft: PortfolioManualPlanDraft = {
    status: 'blocked', draftType: 'PLAN_DRAFT', strategyId: 'candidate-v2', currentWeightPercent: 12.5, researchTargetWeightPercent: null,
    formalTargetWeightPercent: 0, driftPercent: null, suggestedActionTypes: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    portfolioRiskCheck: 'insufficient', tradeabilityCheck: 'passed', priceFreshnessCheck: 'passed', humanReviewChecklist: ['human_review_required'],
    blockedReasons: ['formal_trading_not_unlocked'], evidenceRefs: ['FTR-3/evidence.json#sha256:' + 'a'.repeat(64)],
  }
  const built = executionIsolationService.buildAudit('ftr5-contract', '2026-09-15T00:00:00.000Z', [draft])
  const digest = { positionCount: 1, openPositionCount: 1, positionHash: 'a'.repeat(64), transactionCount: 1, transactionHash: 'b'.repeat(64), draftCount: 0, draftHash: 'c'.repeat(64), externalOrderCount: 0, externalOrderHash: 'd'.repeat(64) }
  const audit = { ...built, generatedAt: '2026-09-15T00:00:00.000Z', sourceChain: { ftr3FormalValidation: { path: 'FTR-3/a.json', sha256: 'e'.repeat(64) }, ftr4ReviewQueue: { path: 'FTR-4/b.json', sha256: 'f'.repeat(64) } }, protectedAccountDigestBefore: digest, protectedAccountDigestAfter: digest, accountFactsUnchanged: true }
  assert.equal(validateAudit(audit), true, JSON.stringify(validateAudit.errors))
  const approval = executionIsolationService.productionAdapterApprovalRecord()
  assert.equal(validateApproval(approval), true, JSON.stringify(validateApproval.errors))
  const rejected = [
    reject('production_adapter_enabled', validateAudit, { ...audit, productionAdapterEnabled: true }),
    reject('real_position_mutation_enabled', validateAudit, { ...audit, realPositionMutationAllowed: true }),
    reject('formal_target_weight_injected', validateAudit, { ...audit, intents: [{ ...audit.intents[0], formalTargetWeightPercent: 25 }] }),
    reject('notional_amount_injected', validateAudit, { ...audit, intents: [{ ...audit.intents[0], notionalAmount: 10000 }] }),
    reject('paper_intent_removed', validateAudit, { ...audit, intents: [] }),
    reject('order_creation_enabled', validateAudit, { ...audit, canCreateOrder: true, orderCreateAllowed: true }),
    reject('production_approval_forged', validateApproval, { ...approval, status: 'approved', productionAdapterEnabled: true }),
  ]
  for (const action of ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'] as const) assert.throws(() => executionIsolationService.assertActionAllowed(action), new RegExp(action))
  console.log(JSON.stringify({ schemaVersion: 'fams.ftr_5.execution_isolation_contract_verification.v1', status: 'passed', positiveSchemasPassed: 2, negativeFixturesPassed: rejected.length, rejected, prohibitedMutationActionsBlocked: 5, productionAdapterEnabled: false, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
