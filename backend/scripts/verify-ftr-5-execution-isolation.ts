import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { executionIsolationService } from '../src/services/formal-release/executionIsolationService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const USER_ID = 'default'

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')) }
function sha256Bytes(value: Buffer) { return createHash('sha256').update(value).digest('hex') }
async function validateSchema(name: string, value: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', name))
  const validate = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false }).compile(schema)
  assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`)
}

async function latestDir() {
  if (process.env.FTR5_AUDIT_DIR) return resolve(process.env.FTR5_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-5')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const audit = await readJson(resolve(dir, '13_execution_isolation_audit.json'))
      if (audit.status === 'ready_for_paper_review' && audit.accountFactsUnchanged === true) return dir
    } catch {
      // Ignore partial runs.
    }
  }
  throw new Error('ftr5_execution_isolation_audit_not_found')
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return { positionCount: positions.length, openPositionCount: positions.filter((item) => item.status === 'open').length, positionHash: sha256Canonical(positions), transactionCount: transactions.length, transactionHash: sha256Canonical(transactions), draftCount: drafts.length, draftHash: sha256Canonical(drafts), externalOrderCount: externalOrders.length, externalOrderHash: sha256Canonical(externalOrders) }
}

async function main() {
  await initializePrisma()
  const dir = await latestDir()
  const audit = await readJson(resolve(dir, '13_execution_isolation_audit.json'))
  const wording = await readJson(resolve(dir, 'trade_boundary_wording_audit.json'))
  const approval = await readJson(resolve(dir, 'production_adapter_approval_record.json'))
  await Promise.all([
    validateSchema('ftr-5-execution-isolation-audit.schema.json', audit),
    validateSchema('ftr-5-trade-boundary-wording-audit.schema.json', wording),
    validateSchema('ftr-5-production-adapter-approval-record.schema.json', approval),
  ])
  for (const ref of Object.values(audit.sourceChain) as Array<{ path: string; sha256: string }>) {
    assert.equal(sha256Bytes(await readFile(resolve(repoRoot, ref.path))), ref.sha256, `source hash mismatch: ${ref.path}`)
  }
  for (const ref of wording.sourceHashes) {
    assert.equal(sha256Bytes(await readFile(resolve(repoRoot, ref.path))), ref.sha256, `scan source hash mismatch: ${ref.path}`)
  }
  assert.deepEqual(audit.protectedAccountDigestBefore, audit.protectedAccountDigestAfter)
  assert.deepEqual(await protectedAccountDigest(), audit.protectedAccountDigestAfter)
  assert.equal(audit.intents.length, 1)
  assert.equal(audit.intents[0].draftStatus, 'blocked')
  assert.equal(audit.intents[0].formalTargetWeightPercent, 0)
  assert.equal(audit.intents[0].notionalAmount, null)
  assert.ok(audit.intents[0].evidenceRefs.some((item: string) => item.includes('FTR-3')))
  let blocked = 0
  for (const action of ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'] as const) {
    assert.throws(() => executionIsolationService.assertActionAllowed(action), new RegExp(action))
    blocked += 1
  }
  assert.equal(blocked, 5)
  const formalRoute = await readFile(resolve(repoRoot, 'backend/src/routes/formalRelease.ts'), 'utf8')
  assert.doesNotMatch(formalRoute, /app\.(post|put|patch)\(['"]\/.*(enable|unlock|production-adapter)/i)
  assert.equal(approval.status, 'missing')
  assert.equal(approval.approvalEndpointAvailable, false)
  for (const value of [audit, wording, approval]) {
    for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(value[field], false)
  }
  assert.equal(audit.productionAdapterEnabled, false)
  assert.equal(audit.realPositionMutationAllowed, false)
  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_5.execution_isolation_verification.v1', status: 'passed', auditDir: dir,
    schemaValidationPassed: true, semanticValidationPassed: true, sourceHashesVerified: true,
    paperIntentCount: 1, prohibitedMutationActionsBlocked: blocked, productionEnableEndpointAbsent: true,
    productionAdapterApprovalStatus: 'missing', executionIsolationPassed: true, accountFactsUnchanged: true,
    productionAdapterEnabled: false, realPositionMutationAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
