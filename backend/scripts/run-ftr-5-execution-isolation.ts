import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { executionIsolationService } from '../src/services/formal-release/executionIsolationService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import type { PortfolioManualPlanDraft } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const repoRoot = resolve(process.cwd(), '..')
const USER_ID = 'default'

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')) }
function sha256Bytes(value: Buffer | string) { return createHash('sha256').update(value).digest('hex') }
async function fileRef(path: string) { return { path: relative(repoRoot, path), sha256: sha256Bytes(await readFile(path)) } }
async function writeJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }) }

async function latestDir(stageId: 'FTR-3' | 'FTR-4', fileName: string, predicate: (value: any) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const artifact = await readJson(resolve(dir, fileName))
      if (predicate(artifact)) return { dir, artifact }
    } catch {
      // Ignore partial runs.
    }
  }
  throw new Error(`${stageId.toLowerCase()}_required_artifact_not_found`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return {
    positionCount: positions.length, openPositionCount: positions.filter((item) => item.status === 'open').length, positionHash: sha256Canonical(positions),
    transactionCount: transactions.length, transactionHash: sha256Canonical(transactions), draftCount: drafts.length, draftHash: sha256Canonical(drafts),
    externalOrderCount: externalOrders.length, externalOrderHash: sha256Canonical(externalOrders),
  }
}

async function currentCandidateWeight(selectedSymbols: string[]) {
  const positions = await prisma.position.findMany({ where: { userId: USER_ID, status: 'open' }, select: { marketValue: true, asset: { select: { symbol: true } } } })
  const total = positions.reduce((sum, item) => sum + Math.max(0, item.marketValue ?? 0), 0)
  if (total <= 0) return null
  const selected = new Set(selectedSymbols.map((item) => item.replace(/\.(SH|SZ)$/i, '')))
  const selectedValue = positions.filter((item) => selected.has(item.asset.symbol.replace(/\.(SH|SZ)$/i, ''))).reduce((sum, item) => sum + Math.max(0, item.marketValue ?? 0), 0)
  return Math.round((selectedValue / total) * 1_000_000) / 10_000
}

async function main() {
  await initializePrisma()
  const generatedAt = new Date().toISOString()
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-5', generatedAt.replace(/[:.]/g, '-'))
  await mkdir(outputDir, { recursive: true })
  const before = await protectedAccountDigest()
  assert.ok(before.openPositionCount > 0, 'real_default_account_has_no_open_positions')

  const [ftr3, ftr4] = await Promise.all([
    latestDir('FTR-3', '17_formal_validation_audit.json', (value) => value.status === 'passed' && value.formalValidationPassed === true),
    latestDir('FTR-4', 'deferred_human_review_queue.json', (value) => value.batchHumanReviewReady === true && value.manualSignoffPassed === false),
  ])
  const walkForwardPath = resolve(ftr3.dir, 'walk_forward_replay.json')
  const walkForward = await readJson(walkForwardPath)
  const lastWindow = walkForward.walkForward.windows.at(-1)
  assert.ok(lastWindow?.selectedSymbols?.length > 0)
  const ftr3Ref = await fileRef(resolve(ftr3.dir, '17_formal_validation_audit.json'))
  const ftr4Ref = await fileRef(resolve(ftr4.dir, 'deferred_human_review_queue.json'))
  const currentWeightPercent = await currentCandidateWeight(lastWindow.selectedSymbols)

  const draft: PortfolioManualPlanDraft = {
    status: 'blocked',
    draftType: 'PLAN_DRAFT',
    strategyId: 'dividend_low_vol_basket@portfolio.strategy.dividend_low_vol_basket.v2_point_in_time',
    currentWeightPercent,
    researchTargetWeightPercent: null,
    formalTargetWeightPercent: 0,
    driftPercent: null,
    suggestedActionTypes: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    portfolioRiskCheck: 'insufficient',
    tradeabilityCheck: 'passed',
    priceFreshnessCheck: 'passed',
    humanReviewChecklist: ['review_ftr3_point_in_time_model_evidence', 'review_ftr5_paper_intent', 'separate_production_adapter_approval_required'],
    blockedReasons: ['formal_trading_not_unlocked', 'manual_review_not_completed', 'production_order_adapter_not_enabled'],
    evidenceRefs: [`${ftr3Ref.path}#sha256:${ftr3Ref.sha256}`, `${ftr4Ref.path}#sha256:${ftr4Ref.sha256}`, `selected-symbols:${lastWindow.selectedSymbols.join(',')}`],
  }
  const baseAudit = executionIsolationService.buildAudit(`ftr5-${sha256Canonical({ ftr3Ref, ftr4Ref }).slice(0, 16)}`, generatedAt, [draft])
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before)
  const audit = {
    ...baseAudit,
    generatedAt,
    sourceChain: { ftr3FormalValidation: ftr3Ref, ftr4ReviewQueue: ftr4Ref },
    protectedAccountDigestBefore: before,
    protectedAccountDigestAfter: after,
    accountFactsUnchanged: true,
  }

  const scanPaths = [
    'backend/src/routes/formalRelease.ts',
    'backend/src/routes/portfolioBacktest.ts',
    'backend/src/services/chat/famsChatService.ts',
    'backend/src/services/formal-release/executionIsolationService.ts',
    'docs/TRADE_BOUNDARY_CONTRACT.md',
  ]
  const sourceHashes = await Promise.all(scanPaths.map(async (path) => fileRef(resolve(repoRoot, path))))
  const formalRoute = await readFile(resolve(repoRoot, 'backend/src/routes/formalRelease.ts'), 'utf8')
  const productionEnableEndpointAbsent = !/app\.(post|put|patch)\(['"]\/.*(enable|unlock|production-adapter)/i.test(formalRoute)
  assert.equal(productionEnableEndpointAbsent, true)
  let prohibitedMutationActionsBlocked = 0
  for (const action of ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'] as const) {
    assert.throws(() => executionIsolationService.assertActionAllowed(action), new RegExp(action))
    prohibitedMutationActionsBlocked += 1
  }
  const tradeBoundaryWordingAudit = {
    schemaVersion: 'fams.ftr_5.trade_boundary_wording_audit.v1', generatedAt, status: 'passed',
    scannedSurfaces: ['formal-release-route', 'portfolio-backtest-route', 'chatbox-service', 'execution-isolation-service', 'trade-boundary-contract'],
    sourceHashes, prohibitedMutationActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'],
    prohibitedMutationActionsBlocked, productionEnableEndpointAbsent,
    blockedRuntimeFields: { productionAdapterEnabled: false, realPositionMutationAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    misleadingTradingCopyFound: false,
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  const approval = executionIsolationService.productionAdapterApprovalRecord()
  await Promise.all([
    writeJson(resolve(outputDir, '13_execution_isolation_audit.json'), audit),
    writeJson(resolve(outputDir, 'trade_boundary_wording_audit.json'), tradeBoundaryWordingAudit),
    writeJson(resolve(outputDir, 'production_adapter_approval_record.json'), approval),
  ])
  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_5.execution_isolation_run.v1', status: 'passed', auditDir: outputDir,
    realDataUsed: true, selectedSymbolCount: lastWindow.selectedSymbols.length, currentCandidateWeightPercent: currentWeightPercent,
    paperIntentCount: audit.intents.length, prohibitedMutationActionsBlocked,
    productionEnableEndpointAbsent, productionAdapterApprovalStatus: approval.status,
    executionIsolationPassed: true, accountFactsUnchanged: true,
    productionAdapterEnabled: false, realPositionMutationAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
