import 'dotenv/config'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT']
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'AUTO_TRADE']

async function latest(prefix: string) {
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  const fileName = (await readdir(auditDir))
    .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
    .sort()
    .at(-1)
  if (!fileName) return null
  return {
    fileName,
    payload: JSON.parse(await readFile(resolve(auditDir, fileName), 'utf8')),
  }
}

async function latestManualDraftEvidence() {
  const operation = await prisma.operation.findFirst({
    where: {
      type: 'strategy_tournament_run',
      status: { in: ['completed', 'succeeded', 'partial'] },
      idempotencyKey: { startsWith: 'dividend-low-vol-strategy-evidence:' },
    },
    orderBy: [
      { completedAt: 'desc' },
      { requestedAt: 'desc' },
    ],
  })
  if (!operation?.resultJson) return null
  const result = JSON.parse(operation.resultJson)
  const acceptance = result.longSampleAcceptance || {}
  const validationDecision = result.validationDecision || {}
  const gates = Array.isArray(acceptance.gates) ? acceptance.gates : []
  const failedBlockers = gates.filter((gate: any) => gate?.severity === 'blocker' && gate?.status !== 'passed')
  return {
    operationId: operation.id,
    status: acceptance.status || 'unknown',
    readyForManualTradeDraft: validationDecision.usableForTradingAdvice === true && failedBlockers.length === 0,
    validationDecision,
    summary: acceptance.summary || {},
    failedBlockers: failedBlockers.map((gate: any) => gate.id || 'unknown'),
  }
}

async function main() {
  const generatedAt = new Date().toISOString()
  const [strictValidation, v2Research] = await Promise.all([
    latest('dividend-low-vol-validation-retest-real_latest_persisted-'),
    latest('dividend-low-vol-v2-research-validation-'),
  ])
  const manualDraftEvidence = await latestManualDraftEvidence()
  const v2Passed = v2Research?.payload?.status === 'research_candidate_passed'
  const strictUsable = strictValidation?.payload?.validationDecision?.usableForTradingAdvice === true
  const manualDraftReady = manualDraftEvidence?.readyForManualTradeDraft === true
  const plan = {
    schemaVersion: 'dividend.low_vol.formal_promotion_plan.v1',
    generatedAt,
    strategyFamily: 'dividend_low_volatility',
    currentStrategyId: 'dividend_low_vol_leader_v1',
    candidatePromotionStrategyId: 'dividend_low_vol_leader_v2_research',
    status: manualDraftReady
      ? 'manual_trade_draft_ready_auto_trade_blocked'
      : v2Passed ? 'research_candidate_passed_formal_validation_pending' : 'research_validation_incomplete',
    stages: [
      {
        id: 'strict_v1_validation',
        status: strictUsable ? 'passed' : 'blocked',
        artifact: strictValidation?.fileName || null,
        blocker: strictUsable ? null : 'strict_v1_sample_or_validation_evidence_insufficient',
      },
      {
        id: 'v2_research_validation',
        status: v2Passed ? 'passed_research_only' : 'insufficient',
        artifact: v2Research?.fileName || null,
        sample: {
          candidates: v2Research?.payload?.latestPool?.v2ResearchCandidates ?? null,
          effectivePathCount: v2Research?.payload?.backtest?.sample?.effectivePathCount ?? null,
          excessReturnPercent: v2Research?.payload?.backtest?.metrics?.excessReturnPercent ?? null,
        },
      },
      {
        id: 'formal_validation_promotion',
        status: manualDraftReady ? 'manual_draft_ready' : 'pending',
        requiredChecks: [
          'promote v2 criteria into versioned strategy definition',
          'rerun formal validation evidence matrix from promoted strategy id',
          'keep OOS, walk-forward, parameter sensitivity and group stability gates explicit',
          'require manual review before any ADD / REDUCE draft',
        ],
      },
      {
        id: 'trade_gate',
        status: manualDraftReady ? 'manual_draft_ready_auto_trade_blocked' : 'blocked',
        reason: manualDraftReady
          ? 'manual trade draft review is ready; formal ADD / REDUCE and AUTO_TRADE remain blocked'
          : 'research_candidate_passed is not formal trading validation',
      },
    ],
    validationDecision: {
      usableForTradingAdvice: manualDraftReady,
      allowedActions: manualDraftReady ? [...ALLOWED_ACTIONS, 'MANUAL_TRADE_DRAFT'] : ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      primaryBlocker: manualDraftReady ? null : v2Passed ? 'formal_validation_promotion_pending' : 'v2_research_validation_insufficient',
    },
    manualDraftEvidence,
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const path = resolve(auditDir, `dividend-low-vol-formal-promotion-plan-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, path, status: plan.status, validationDecision: plan.validationDecision }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
