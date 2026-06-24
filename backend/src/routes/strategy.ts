import { FastifyInstance } from 'fastify'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dividendLowVolStrategyService } from '../services/dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendFactSetService } from '../services/dividend-low-vol/dividendFactSetService.js'
import { dividendLowVolAlertService } from '../services/dividend-low-vol/dividendLowVolAlertService.js'
import { dividendLowVolBacktestService } from '../services/dividend-low-vol/dividendLowVolBacktestService.js'
import { dividendLowVolFivdRAdapter } from '../services/dividend-low-vol/dividendLowVolFivdRAdapter.js'
import { dividendLowVolInputBuilderService } from '../services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolUniverseService } from '../services/dividend-low-vol/dividendLowVolUniverseService.js'
import { dividendLowVolDataReadinessService } from '../services/dividend-low-vol/dividendLowVolDataReadinessService.js'
import { dividendLowVolTotalReturnAuditService } from '../services/dividend-low-vol/dividendTotalReturnAuditService.js'
import { dividendLowVolTradingZoneService } from '../services/dividend-low-vol/dividendLowVolTradingZoneService.js'
import { prisma } from '../db/prisma.js'
import type { DividendLowVolInput } from '../services/dividend-low-vol/dividendLowVolTypes.js'

function parseSymbols(value: unknown) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
}

async function loadLatestDividendLowVolAuditArtifact(prefix: string) {
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  const files = await readdir(auditDir).catch(() => [])
  const latestFile = files
    .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
    .sort()
    .at(-1)
  if (!latestFile) return null
  const path = resolve(auditDir, latestFile)
  const payload = JSON.parse(await readFile(path, 'utf8'))
  return {
    ...payload,
    artifactRef: {
      path,
      fileName: latestFile,
    },
  }
}

async function loadLatestDividendLowVolPackageArtifact(fileName: string) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit/dividend-low-vol')
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const latestDir = dirs
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort()
    .at(-1)
  if (!latestDir) return null
  const path = resolve(root, latestDir, fileName)
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (!raw) return null
  const payload = JSON.parse(raw)
  return {
    ...(fileName === '27_manual_acceptance_review.json' && !payload.schemaVersion
      ? { schemaVersion: 'dividend.low_vol.manual_acceptance_review.v1' }
      : {}),
    ...payload,
    artifactRef: {
      path,
      fileName,
      packageDir: latestDir,
    },
  }
}

async function persistDividendLowVolManualAcceptanceDecision(review: any, body: any) {
  const decision = String(body?.decision || '')
  const allowedDecisions = new Set(['accept_for_manual_draft_review', 'needs_more_review', 'reject_acceptance'])
  const normalizedDecision = allowedDecisions.has(decision) ? decision : 'needs_more_review'
  const generatedAt = new Date().toISOString()
  const decisionId = `dividend-low-vol-manual-acceptance-decision-${generatedAt.replace(/[:.]/g, '-')}`
  const payload = {
    schemaVersion: 'dividend.low_vol.manual_acceptance_decision.v1',
    decisionId,
    generatedAt,
    sourceAcceptanceStatus: review?.status || 'unknown',
    sourceArtifactRef: review?.artifactRef || null,
    reviewer: typeof body?.reviewer === 'string' ? body.reviewer : 'user',
    decision: normalizedDecision,
    reason: typeof body?.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : normalizedDecision === 'accept_for_manual_draft_review'
        ? '人工验收通过，可继续人工交易计划草案复核；不释放正式交易动作。'
        : normalizedDecision === 'reject_acceptance'
          ? '人工验收拒绝，保持观察。'
          : '人工验收要求继续复核证据来源、免费源边界和安全 gate。',
    checklistSnapshot: Array.isArray(review?.acceptanceChecklist) ? review.acceptanceChecklist : [],
    remainingValidationGaps: Array.isArray(review?.remainingValidationGaps) ? review.remainingValidationGaps : [],
    decisionBoundary: {
      ...(review?.decisionBoundary || {}),
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    },
    safetyAssertions: {
      manualAcceptanceDecisionDoesNotCreateOrder: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT_REVIEW'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const fileName = `${decisionId}.json`
  const path = resolve(auditDir, fileName)
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    ...payload,
    artifactRef: {
      path,
      fileName,
    },
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

async function loadLatestDividendLowVolManualDraftReadiness() {
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
  if (!operation) {
    return {
      schemaVersion: 'dividend.low_vol.manual_trade_draft_readiness.v1',
      generatedAt: new Date().toISOString(),
      status: 'no_evidence',
      readyForManualTradeDraft: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      primaryBlocker: 'strategy_evidence_missing',
      latestEvidence: null,
    }
  }
  const result = parseJson<Record<string, any>>(operation.resultJson, {})
  const acceptance = result.longSampleAcceptance || {}
  const summary = acceptance.summary || {}
  const validationDecision = result.validationDecision || {}
  const gates = Array.isArray(acceptance.gates) ? acceptance.gates : []
  const failedBlockers = gates.filter((gate: any) => gate?.severity === 'blocker' && gate?.status !== 'passed')
  const readyForManualTradeDraft = validationDecision.usableForTradingAdvice === true && failedBlockers.length === 0
  return {
    schemaVersion: 'dividend.low_vol.manual_trade_draft_readiness.v1',
    generatedAt: new Date().toISOString(),
    status: readyForManualTradeDraft ? 'ready_for_manual_trade_draft' : 'blocked',
    readyForManualTradeDraft,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    decision: validationDecision.decision || (readyForManualTradeDraft ? 'READY_FOR_MANUAL_TRADE_DRAFT' : 'OBSERVE_ONLY'),
    allowedActions: validationDecision.allowedActions || ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
    prohibitedActions: validationDecision.prohibitedActions || ['ADD', 'REDUCE', 'AUTO_TRADE'],
    primaryBlocker: validationDecision.primaryBlocker || (readyForManualTradeDraft ? null : 'validation_evidence'),
    latestEvidence: {
      operationId: operation.id,
      generatedAt: operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
      acceptanceStatus: acceptance.status || 'unknown',
      scanCoveragePercent: summary.scanCoveragePercent ?? null,
      providerSuccessRate: summary.providerSuccessRate ?? null,
      cacheHitRate: summary.cacheHitRate ?? null,
      backtestDays: summary.backtestDays ?? null,
      bestSampleSize: summary.bestSampleSize ?? null,
      bestCredibility: summary.bestCredibility ?? null,
      topCandidates: acceptance.topCandidates || [],
    },
    gates,
    recommendations: acceptance.recommendations || [],
  }
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function buildDividendLowVolManualTradeDraft(pool: any, readiness: any, topN: number) {
  const ready = readiness.readyForManualTradeDraft === true
  const candidates = Array.isArray(pool?.candidates) ? pool.candidates : []
  const eligible = candidates
    .filter((candidate: any) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
    .sort((left: any, right: any) => (right.scores?.evidenceAdjustedScore || 0) - (left.scores?.evidenceAdjustedScore || 0))
    .slice(0, topN)
  type DraftAction = {
    rank: number
    symbol: string
    name?: string
    industry?: string
    draftType: string
    disposition: string
    candidateGrade?: string
    isHolding: boolean
    currentWeightPercent: number
    researchTargetWeightPercent: number
    formalTargetWeightPercent: 0
    suggestedDraftWeightPercent: number
    singleStockCapPercent: number
    metrics: Record<string, number | null>
    validation: {
      readinessStatus: string
      sampleSize: number | null
      credibility: string | null
      prohibitedActions: string[]
    }
    rationale: string[]
    guardrails: string[]
    evidenceRefs: string[]
  }
  const actions: DraftAction[] = eligible.map((candidate: any, index: number) => {
    const position = candidate.positionContext || {}
    const currentWeight = Number(position.portfolioWeightPercent || 0)
    const researchTarget = Number(position.researchTargetWeightPercent || 0)
    const cap = Number(candidate.tradingDiscipline?.positionGuidance?.singleStockCapPercent || 5)
    const remainingResearchRoom = Math.max(Math.min(researchTarget, cap) - currentWeight, 0)
    const suggestedDraftWeight = ready
      ? position.isHolding
        ? round(Math.min(remainingResearchRoom, Math.max(researchTarget * 0.3, 0.5)))
        : round(Math.min(Math.max(researchTarget * 0.3, 0.5), cap))
      : 0
    const draftType = !ready
      ? 'OBSERVE_ONLY'
      : position.isHolding
        ? remainingResearchRoom > 0.25 ? 'ADD_REVIEW_DRAFT' : 'HOLD_REVIEW'
        : 'BUILD_REVIEW_DRAFT'
    return {
      rank: index + 1,
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      industry: candidate.identity.industry,
      draftType,
      disposition: candidate.disposition,
      candidateGrade: candidate.candidateGrade,
      isHolding: position.isHolding === true,
      currentWeightPercent: currentWeight,
      researchTargetWeightPercent: researchTarget,
      formalTargetWeightPercent: 0,
      suggestedDraftWeightPercent: suggestedDraftWeight,
      singleStockCapPercent: cap,
      metrics: {
        evidenceAdjustedScore: candidate.scores?.evidenceAdjustedScore ?? null,
        ttmDividendYield: candidate.dividend?.ttmDividendYield ?? null,
        avgDividendYield3y: candidate.dividend?.avgDividendYield3y ?? null,
        leaderScore: candidate.scores?.leaderScore ?? null,
        dividendQualityScore: candidate.scores?.dividendQualityScore ?? null,
        lowVolScore: candidate.scores?.lowVolScore ?? null,
        valuationScore: candidate.scores?.valuationScore ?? null,
        lowZoneScore: candidate.timing?.lowZoneScore ?? null,
        highZoneScore: candidate.timing?.highZoneScore ?? null,
      },
      validation: {
        readinessStatus: readiness.status,
        sampleSize: readiness.latestEvidence?.bestSampleSize ?? null,
        credibility: readiness.latestEvidence?.bestCredibility ?? null,
        prohibitedActions: readiness.prohibitedActions || ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
      rationale: [
        `综合证据分 ${candidate.scores?.evidenceAdjustedScore ?? 'n/a'}，红利/低波/龙头指标进入红利低波复核队列。`,
        position.isHolding
          ? `当前已持仓 ${round(currentWeight)}%，研究目标 ${round(researchTarget)}%，本次只生成持仓复核草案。`
          : `当前未识别持仓，建议只生成首批建仓人工复核草案。`,
        '执行前必须人工复核停复牌、涨跌停、行业集中度、单票上限和现金占用。',
      ],
      guardrails: [
        '不是正式 ADD / REDUCE 指令。',
        'AUTO_TRADE 禁止。',
        'formalTargetWeightPercent 固定为 0，实际执行需人工审批。',
        ...(candidate.blockedReasons || []).map((reason: string) => `复核 blockedReason: ${reason}`),
      ],
      evidenceRefs: (candidate.evidenceRefs || []).slice(0, 20),
    }
  })
  return {
    schemaVersion: 'dividend.low_vol.manual_trade_draft.v1',
    draftId: `dividend-low-vol-draft-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    generatedAt: new Date().toISOString(),
    status: ready ? 'manual_review_required' : 'blocked',
    readyForManualTradeDraft: ready,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    allowedActions: ready
      ? ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT']
      : ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    readiness,
    summary: {
      requestedTopN: topN,
      draftActionCount: actions.length,
      holdingCount: actions.filter((action) => action.isHolding).length,
      newReviewCount: actions.filter((action) => !action.isHolding).length,
      totalSuggestedDraftWeightPercent: round(actions.reduce((sum, action) => sum + action.suggestedDraftWeightPercent, 0)),
    },
    actions,
    userPath: [
      '进入左侧红利低波策略页面。',
      '查看人工交易计划草案 Gate 是否 READY。',
      '按综合分/行业/红利/低波筛选候选。',
      '展开候选查看持仓、研究目标、风险标签和 evidenceRefs。',
      '将本草案提交人工复核；不得直接下单。',
    ],
    notTradingAdvice: true,
  }
}

async function persistDividendLowVolManualTradeDraft(draft: any) {
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const fileName = `${draft.draftId}.json`
  const path = resolve(auditDir, fileName)
  const payload = {
    ...draft,
    persistedAt: new Date().toISOString(),
    auditPurpose: 'User-triggered dividend low volatility manual trade draft. Manual review only; not an order.',
  }
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    ...payload,
    artifactRef: {
      path,
      fileName,
    },
  }
}

async function loadDividendLowVolManualTradeDraftById(draftId: string) {
  if (!/^dividend-low-vol-draft-\d{4}-\d{2}-\d{2}T/.test(draftId)) return null
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  const path = resolve(auditDir, `${draftId}.json`)
  const content = await readFile(path, 'utf8').catch(() => null)
  if (!content) return null
  return {
    payload: JSON.parse(content),
    path,
    fileName: `${draftId}.json`,
  }
}

async function persistDividendLowVolManualTradeDraftReview(draft: { payload: any; path: string; fileName: string }, body: any) {
  const decision = String(body?.decision || '')
  const allowedDecisions = new Set(['approve_for_watchlist', 'needs_more_data', 'reject_draft'])
  const normalizedDecision = allowedDecisions.has(decision) ? decision : 'needs_more_data'
  const generatedAt = new Date().toISOString()
  const reviewId = `dividend-low-vol-draft-review-${generatedAt.replace(/[:.]/g, '-')}`
  const selectedSymbols = Array.isArray(body?.selectedSymbols)
    ? body.selectedSymbols.filter((item: unknown) => /^\d{6}$/.test(String(item)))
    : draft.payload.actions?.map((action: any) => action.symbol) || []
  const payload = {
    schemaVersion: 'dividend.low_vol.manual_trade_draft_review.v1',
    reviewId,
    generatedAt,
    draftId: draft.payload.draftId,
    draftArtifactRef: {
      path: draft.path,
      fileName: draft.fileName,
    },
    reviewer: typeof body?.reviewer === 'string' ? body.reviewer : 'user',
    decision: normalizedDecision,
    reason: typeof body?.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : normalizedDecision === 'approve_for_watchlist'
        ? '人工复核通过，进入观察/草案清单；仍禁止正式交易动作。'
        : normalizedDecision === 'reject_draft'
          ? '人工复核拒绝该草案。'
          : '需要补充数据或进一步复核。',
    selectedSymbols,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT_REVIEW'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    guardrails: [
      '该复核记录不是正式买入/卖出指令。',
      '不得自动下单。',
      '如需执行，必须另走人工审批、交易状态、仓位和资金复核流程。',
    ],
    notTradingAdvice: true,
  }
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const fileName = `${reviewId}.json`
  const path = resolve(auditDir, fileName)
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  let watchlistArtifactRef = null
  if (normalizedDecision === 'approve_for_watchlist') {
    const watchlistId = `dividend-low-vol-watchlist-${generatedAt.replace(/[:.]/g, '-')}`
    const selected = new Set(selectedSymbols)
    const watchlistPayload = {
      schemaVersion: 'dividend.low_vol.manual_watchlist.v1',
      watchlistId,
      generatedAt,
      sourceReviewId: reviewId,
      sourceDraftId: draft.payload.draftId,
      reviewer: payload.reviewer,
      status: 'manual_review_watchlist',
      entries: (Array.isArray(draft.payload.actions) ? draft.payload.actions : [])
        .filter((action: any) => selected.size === 0 || selected.has(action.symbol))
        .map((action: any) => ({
          symbol: action.symbol,
          name: action.name,
          industry: action.industry,
          draftType: action.draftType,
          suggestedDraftWeightPercent: action.suggestedDraftWeightPercent,
          currentWeightPercent: action.currentWeightPercent,
          researchTargetWeightPercent: action.researchTargetWeightPercent,
          formalTargetWeightPercent: 0,
          metrics: action.metrics,
          rationale: action.rationale,
          guardrails: [
            ...(Array.isArray(action.guardrails) ? action.guardrails : []),
            '观察清单不是正式交易清单；执行前必须再次人工复核。',
          ],
          evidenceRefs: action.evidenceRefs,
        })),
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_WATCHLIST'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
    const watchlistFileName = `${watchlistId}.json`
    const watchlistPath = resolve(auditDir, watchlistFileName)
    await writeFile(watchlistPath, `${JSON.stringify(watchlistPayload, null, 2)}\n`, 'utf8')
    watchlistArtifactRef = {
      path: watchlistPath,
      fileName: watchlistFileName,
    }
  }
  return {
    ...payload,
    artifactRef: {
      path,
      fileName,
    },
    watchlistArtifactRef,
  }
}

async function persistDividendLowVolManualPretradeCheck(watchlist: any) {
  const generatedAt = new Date().toISOString()
  const checkId = `dividend-low-vol-pretrade-check-${generatedAt.replace(/[:.]/g, '-')}`
  const entries = (Array.isArray(watchlist.entries) ? watchlist.entries : []).map((entry: any) => ({
    symbol: entry.symbol,
    name: entry.name,
    industry: entry.industry,
    draftType: entry.draftType,
    suggestedDraftWeightPercent: entry.suggestedDraftWeightPercent,
    formalTargetWeightPercent: 0,
    executionReady: false,
    checks: [
      {
        id: 'formal_trade_action_locked',
        status: 'blocked',
        message: '正式 ADD / REDUCE 仍未释放；该检查单不能作为下单指令。',
      },
      {
        id: 'auto_trade_locked',
        status: 'passed',
        message: 'AUTO_TRADE 保持禁止。',
      },
      {
        id: 'tradeability_manual_review_required',
        status: 'manual_review_required',
        message: '执行前必须人工复核最新停复牌、涨跌停、可交易状态和盘口流动性。',
      },
      {
        id: 'position_cap_manual_review_required',
        status: 'manual_review_required',
        message: '执行前必须人工复核单票上限、行业上限、现金余额和组合回撤预算。',
      },
      {
        id: 'evidence_freshness_manual_review_required',
        status: 'manual_review_required',
        message: '执行前必须确认分红、财务、行业龙头和行情证据仍在有效期内。',
      },
    ],
    evidenceRefs: entry.evidenceRefs || [],
  }))
  const payload = {
    schemaVersion: 'dividend.low_vol.manual_pretrade_check.v1',
    checkId,
    generatedAt,
    sourceWatchlistId: watchlist.watchlistId || null,
    status: entries.length > 0 ? 'manual_pretrade_review_required' : 'missing_watchlist_entries',
    entries,
    executionReady: false,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_PRETRADE_CHECK'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    requiredHumanReview: [
      '确认最新停复牌和涨跌停状态。',
      '确认账户现金、单票上限、行业上限和组合风险预算。',
      '确认分红、财务、行业龙头和行情证据没有过期。',
      '如需实际交易，必须走独立人工审批和交易系统，不得由 FAMS 自动执行。',
    ],
    notTradingAdvice: true,
  }
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const fileName = `${checkId}.json`
  const path = resolve(auditDir, fileName)
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    ...payload,
    artifactRef: {
      path,
      fileName,
    },
  }
}

async function persistDividendLowVolManualPretradeReview(check: any, body: any) {
  const decision = String(body?.decision || '')
  const allowedDecisions = new Set(['continue_observe', 'needs_more_review', 'reject_execution'])
  const normalizedDecision = allowedDecisions.has(decision) ? decision : 'needs_more_review'
  const generatedAt = new Date().toISOString()
  const reviewId = `dividend-low-vol-pretrade-review-${generatedAt.replace(/[:.]/g, '-')}`
  const payload = {
    schemaVersion: 'dividend.low_vol.manual_pretrade_review.v1',
    reviewId,
    generatedAt,
    sourceCheckId: check.checkId || null,
    sourceWatchlistId: check.sourceWatchlistId || null,
    reviewer: typeof body?.reviewer === 'string' ? body.reviewer : 'user',
    decision: normalizedDecision,
    reason: typeof body?.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : normalizedDecision === 'continue_observe'
        ? '继续保留观察，暂不进入执行。'
        : normalizedDecision === 'reject_execution'
          ? '人工复核拒绝执行。'
          : '仍需补充人工复核。',
    reviewedSymbols: Array.isArray(check.entries) ? check.entries.map((entry: any) => entry.symbol).filter((symbol: unknown) => /^\d{6}$/.test(String(symbol))) : [],
    executionReady: false,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_PRETRADE_REVIEW'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    guardrails: [
      '该检查结论不是下单授权。',
      'FAMS 不自动执行交易。',
      '正式交易动作仍需独立人工审批和交易系统确认。',
    ],
    notTradingAdvice: true,
  }
  const auditDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const fileName = `${reviewId}.json`
  const path = resolve(auditDir, fileName)
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    ...payload,
    artifactRef: {
      path,
      fileName,
    },
  }
}

async function buildDividendLowVolManualWorkflowAudit() {
  const [draft, draftReview, watchlist, pretradeCheck, pretradeReview, acceptanceDecision] = await Promise.all([
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-draft-'),
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-draft-review-'),
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-watchlist-'),
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-pretrade-check-'),
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-pretrade-review-'),
    loadLatestDividendLowVolAuditArtifact('dividend-low-vol-manual-acceptance-decision-'),
  ])
  const stage = (id: string, label: string, artifact: any, status: string) => ({
    id,
    label,
    status,
    generatedAt: artifact?.generatedAt || artifact?.persistedAt || null,
    artifactId: artifact?.draftId || artifact?.reviewId || artifact?.watchlistId || artifact?.checkId || artifact?.decisionId || null,
    sourceDraftId: artifact?.sourceDraftId || artifact?.draftId || null,
    sourceReviewId: artifact?.sourceReviewId || null,
    sourceWatchlistId: artifact?.sourceWatchlistId || null,
    sourceCheckId: artifact?.sourceCheckId || null,
    artifactRef: artifact?.artifactRef || null,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
  })
  const stages = [
    stage('manual_trade_draft', '人工草案', draft, draft ? (draft.status || 'available') : 'missing'),
    stage('manual_trade_draft_review', '草案复核', draftReview, draftReview ? (draftReview.decision || draftReview.status || 'reviewed') : 'missing'),
    stage('manual_watchlist', '人工观察清单', watchlist, watchlist ? (watchlist.status || 'available') : 'missing'),
    stage('manual_pretrade_check', '执行前检查单', pretradeCheck, pretradeCheck ? (pretradeCheck.status || 'available') : 'missing'),
    stage('manual_pretrade_review', '检查结论', pretradeReview, pretradeReview ? (pretradeReview.decision || pretradeReview.status || 'reviewed') : 'missing'),
    stage('manual_acceptance_decision', '人工验收结论', acceptanceDecision, acceptanceDecision ? (acceptanceDecision.decision || acceptanceDecision.status || 'reviewed') : 'missing'),
  ]
  return {
    schemaVersion: 'dividend.low_vol.manual_workflow_audit.v1',
    generatedAt: new Date().toISOString(),
    status: stages.every((item) => item.status !== 'missing') ? 'complete_observation_workflow' : 'partial_workflow',
    stages,
    summary: {
      completedStages: stages.filter((item) => item.status !== 'missing').length,
      totalStages: stages.length,
      latestDecision: acceptanceDecision?.decision || pretradeReview?.decision || draftReview?.decision || null,
      executionReady: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    },
    notTradingAdvice: true,
  }
}

async function buildDividendLowVolValidationGapDiagnostics(candidates: DividendLowVolInput[], options: any = {}) {
  const [dataReadiness, backtest] = await Promise.all([
    dividendLowVolDataReadinessService.buildAudit(),
    dividendLowVolBacktestService.run(candidates, {
      initialCapital: typeof options?.initialCapital === 'number' ? options.initialCapital : undefined,
      dividendReinvestment: options?.dividendReinvestment !== false,
      rebalanceFrequency: options?.rebalanceFrequency === 'weekly' ? 'weekly' : 'monthly',
      researchEligibilityMode: options?.researchEligibilityMode === 'expanded_observation' ? 'expanded_observation' : undefined,
    }),
  ])
  const backtestAny = backtest as any
  const totalReturnAudit = dividendLowVolTotalReturnAuditService.buildAudit(backtestAny)
  const v2ResearchValidation = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-v2-research-validation-')
  const v2Evidence = v2ResearchValidation?.backtest?.validationEvidence || null
  const v2EvidenceStatuses = [
    v2Evidence?.outOfSample,
    v2Evidence?.walkForward,
    v2Evidence?.parameterSensitivity,
    v2Evidence?.groupStability,
  ]
  const v2ResearchEvidencePassed = v2ResearchValidation?.status === 'research_candidate_passed'
    && v2EvidenceStatuses.every((status) => status === 'candidate_passed')
    && Number(v2ResearchValidation?.backtest?.sample?.effectivePathCount || 0) >= 100
  const bestValidationEvidence = v2ResearchEvidencePassed
    ? {
      source: 'v2_research_validation',
      sourceArtifact: v2ResearchValidation?.artifactRef?.fileName || null,
      evidence: v2ResearchValidation?.backtest?.validationEvidence || null,
      sample: v2ResearchValidation?.backtest?.sample || null,
      formalBacktestGate: v2ResearchValidation?.backtest?.formalBacktestGate || null,
      totalReturnAuditStatus: v2ResearchValidation?.backtest?.formalBacktestGate?.ready === true ? 'free_source_validation_ready' : totalReturnAudit.status,
      status: v2ResearchValidation?.backtest?.validationEvidence?.status || v2ResearchValidation?.status || 'unknown',
      researchPassed: true,
      usableForTradingAdvice: false,
    }
    : {
      source: 'current_request_backtest',
      sourceArtifact: null,
      evidence: backtestAny.validationEvidence || null,
      sample: backtestAny.sample || null,
      formalBacktestGate: backtestAny.formalBacktestGate || null,
      totalReturnAuditStatus: totalReturnAudit.status,
      status: backtestAny.validationEvidence?.status || 'missing',
      researchPassed: false,
      usableForTradingAdvice: false,
    }
  const gaps: Array<{
    id: string
    severity: 'blocker' | 'warning' | 'info'
    category: string
    status: string
    affectedGate: string
    userMessage: string
    developerAction: string
    formalValidationBlocked: boolean
  }> = []

  const push = (gap: (typeof gaps)[number]) => gaps.push(gap)
  for (const blocker of dataReadiness.researchBlockers || dataReadiness.blockers || []) {
    push({
      id: blocker,
      severity: 'blocker',
      category: 'free_source_data',
      status: 'blocked',
      affectedGate: 'research_scan_ready',
      userMessage: `免费源研究数据仍缺 ${blocker}，不能稳定重跑全 A 研究扫描。`,
      developerAction: '刷新 quote list、market bars、features、security status 和 tradeability 后重跑 data readiness。',
      formalValidationBlocked: true,
    })
  }
  for (const blocker of dataReadiness.providerUpgradeBlockers || []) {
    push({
      id: blocker,
      severity: 'warning',
      category: 'provider_upgrade',
      status: 'optional_upgrade_pending',
      affectedGate: 'formal_provider_upgrade',
      userMessage: `${blocker} 是 Tushare/正式 provider 升级项，不阻断免费源研究验证。`,
      developerAction: '保留 Tushare token 配置和 ingestion skeleton；需要正式 provider 时再启用。',
      formalValidationBlocked: false,
    })
  }
  const formalBacktestGate = bestValidationEvidence.formalBacktestGate || backtestAny.formalBacktestGate || {}
  for (const blocker of formalBacktestGate.blockers || []) {
    push({
      id: blocker,
      severity: 'blocker',
      category: 'total_return_backtest',
      status: 'blocked',
      affectedGate: 'formal_backtest_gate',
      userMessage: `${blocker} 未满足，回测不能标记为 formal-grade。`,
      developerAction: blocker.includes('benchmark')
        ? '接入或生成可追溯 total-return benchmark，并保留 evidenceRefs。'
        : '补齐除权分红总回报序列、涨跌停和停牌逐日交易约束。',
      formalValidationBlocked: true,
    })
  }
  const validationChecks = bestValidationEvidence.evidence || {}
  for (const [id, status] of Object.entries({
    out_of_sample: validationChecks.outOfSample,
    walk_forward: validationChecks.walkForward,
    parameter_sensitivity: validationChecks.parameterSensitivity,
    group_stability: validationChecks.groupStability,
  })) {
    if (status === 'candidate_passed') continue
    push({
      id,
      severity: status === 'failed' ? 'blocker' : 'warning',
      category: 'validation_evidence',
      status: String(status || 'missing'),
      affectedGate: id,
      userMessage: `${id} 当前为 ${status || 'missing'}，仍不能作为正式交易动作依据。`,
      developerAction: bestValidationEvidence.source === 'current_request_backtest'
        ? '扩大样本、延长窗口、补齐分组样本，并重跑 validation retest。'
        : '大样本研究验证已改善该项；人工验收时需复核样本来源、行业分组和参数邻域证据。',
      formalValidationBlocked: true,
    })
  }

  const blockingGapCount = gaps.filter((gap) => gap.formalValidationBlocked).length
  const diagnosticsStatus = blockingGapCount > 0
    ? 'formal_validation_blocked'
    : bestValidationEvidence.usableForTradingAdvice
      ? 'formal_validation_gap_clear_manual_trade_draft_ready'
      : 'research_validation_gap_clear_manual_acceptance_required'
  return {
    schemaVersion: 'dividend.low_vol.validation_gap_diagnostics.v1',
    generatedAt: new Date().toISOString(),
    strategyId: dividendLowVolStrategyService.strategyId,
    status: diagnosticsStatus,
    summary: {
      totalGaps: gaps.length,
      blockingGapCount,
      warningGapCount: gaps.filter((gap) => gap.severity === 'warning').length,
      freeSourceResearchReady: dataReadiness.gates.researchScanReady,
      freeSourceValidationAllowed: dataReadiness.gates.freeSourceValidationAllowed,
      formalBacktestReady: formalBacktestGate.ready === true,
      backtestStatus: backtestAny.status,
      totalReturnAuditStatus: bestValidationEvidence.totalReturnAuditStatus,
      validationEvidenceStatus: bestValidationEvidence.status,
      validationEvidenceSource: bestValidationEvidence.source,
      validationEvidenceSourceArtifact: bestValidationEvidence.sourceArtifact,
      validationResearchPassed: bestValidationEvidence.researchPassed,
      validationUsableForTradingAdvice: bestValidationEvidence.usableForTradingAdvice,
    },
    gaps,
    validationEvidenceSnapshot: bestValidationEvidence,
    backtestSnapshot: {
      sample: backtestAny.sample,
      metrics: backtestAny.metrics,
      benchmark: backtestAny.benchmark,
      formalBacktestGate: backtestAny.formalBacktestGate,
      tradeConstraintAudit: backtestAny.tradeConstraintAudit,
      validationEvidence: backtestAny.validationEvidence,
      bestFormalBacktestGate: formalBacktestGate,
    },
    dataReadinessSnapshot: {
      status: dataReadiness.status,
      providerMode: dataReadiness.providerMode,
      validationDataMode: dataReadiness.validationDataMode,
      formalBlockers: dataReadiness.formalBlockers,
      providerUpgradeBlockers: dataReadiness.providerUpgradeBlockers,
      researchBlockers: dataReadiness.researchBlockers || dataReadiness.blockers,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }
}

export async function strategyRoutes(app: FastifyInstance) {
  async function buildDividendInputs(payload: any, fallbackSymbols: string[] = []) {
    const userId = payload?.userId || 'default'
    const limit = Math.max(1, Math.min(1000, Number(payload?.limit || 120)))
    const historyDays = payload?.historyDays !== undefined ? Math.max(260, Math.min(900, Number(payload.historyDays))) : undefined
    if (Array.isArray(payload?.candidates)) {
      return { candidates: await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, payload.candidates as DividendLowVolInput[]), universeSummary: undefined }
    }
    const requestedSymbols = parseSymbols(payload?.symbols)
    const useAllA = payload?.scope === 'all' || payload?.universe === 'all_a' || payload?.allA === true || (requestedSymbols.length === 0 && fallbackSymbols.length === 0)
    if (useAllA) {
      const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit })
      const built = await dividendLowVolInputBuilderService.buildFromInputs(universe.inputs, limit, { historyDays })
      return {
        candidates: await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, built),
        universeSummary: universe.summary,
      }
    }
    const symbols = requestedSymbols.length > 0 ? requestedSymbols : fallbackSymbols
    const built = await dividendLowVolInputBuilderService.buildFromSymbols(symbols, limit, { historyDays })
    return {
      candidates: await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, built),
      universeSummary: undefined,
    }
  }

  app.post('/dividend-low-vol/scan', async (request) => {
    const body = request.body as any
    const userId = body?.userId || 'default'
    const { candidates, universeSummary } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolStrategyService.persistCandidatePool(userId, candidates, {
      sourceOperationId: typeof body?.sourceOperationId === 'string' ? body.sourceOperationId : undefined,
      tradeDate: typeof body?.tradeDate === 'string' ? body.tradeDate : undefined,
      universeSummary: universeSummary,
    })
  })

  app.get('/dividend-low-vol/candidates', async (request) => {
    const query = request.query as any
    const userId = query.userId || 'default'
    const symbols = parseSymbols(query.symbols || '')
    const limit = Math.max(1, Math.min(6000, Number(query.limit || symbols.length || 120)))
    const persistedOnly = query.persistedOnly === 'true'
    const useAllA = query.scope === 'all' || query.universe === 'all_a' || query.allA === 'true'
    if (useAllA && !persistedOnly) {
      const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit })
      const inputs = await dividendLowVolInputBuilderService.buildFromInputs(universe.inputs, limit)
      const enriched = await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, inputs)
      return dividendLowVolStrategyService.buildCandidatePool(enriched, { universeSummary: universe.summary })
    }
    const latest = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
      symbols: symbols.length > 0 ? symbols.slice(0, limit) : undefined,
      limit,
      scope: symbols.length > 0 ? 'latest_trade_date' : 'all_latest_by_symbol',
    })
    if ((latest as any).source?.persisted || persistedOnly) {
      return {
        ...latest,
        source: {
          ...((latest as any).source || {}),
          persisted: true,
        },
      }
    }
    const fallbackSymbols = symbols.length > 0 ? symbols.slice(0, limit) : ['600000', '000001', '601398']
    const inputs = await dividendLowVolInputBuilderService.buildFromSymbols(fallbackSymbols, limit)
    const enriched = await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, inputs)
    return dividendLowVolStrategyService.buildCandidatePool(enriched)
  })

  app.get('/dividend-low-vol/data-readiness', async () => {
    return dividendLowVolDataReadinessService.buildAudit()
  })

  app.get('/dividend-low-vol/v2/research-validation', async () => {
    const artifact = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-v2-research-validation-')
    if (artifact) return artifact
    return {
      schemaVersion: 'dividend.low_vol.v2_research_validation_artifact.v1',
      generatedAt: new Date().toISOString(),
      strategyId: 'dividend_low_vol_leader_v2_research',
      status: 'missing',
      reason: 'No dividend-low-vol-v2-research-validation artifact has been generated yet.',
      validationDecision: {
        usableForTradingAdvice: false,
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        primaryBlocker: 'v2_research_validation_artifact_missing',
        note: 'V2 research validation is diagnostic only and does not unlock formal trade actions.',
      },
      policy: {
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
    }
  })

  app.get('/dividend-low-vol/manual-draft-readiness', async () => {
    return loadLatestDividendLowVolManualDraftReadiness()
  })

  app.get('/dividend-low-vol/manual-trade-draft', async (request) => {
    const query = request.query as any
    const userId = query.userId || 'default'
    const topN = Math.max(1, Math.min(10, Number(query.topN || 3)))
    const limit = Math.max(topN, Math.min(6000, Number(query.limit || 6000)))
    const [readiness, pool] = await Promise.all([
      loadLatestDividendLowVolManualDraftReadiness(),
      dividendLowVolStrategyService.getLatestCandidatePool(userId, {
        limit,
        scope: 'all_latest_by_symbol',
      }),
    ])
    return buildDividendLowVolManualTradeDraft(pool, readiness, topN)
  })

  app.post('/dividend-low-vol/manual-trade-draft', async (request) => {
    const body = request.body as any
    const userId = body?.userId || 'default'
    const topN = Math.max(1, Math.min(10, Number(body?.topN || 3)))
    const limit = Math.max(topN, Math.min(6000, Number(body?.limit || 6000)))
    const [readiness, pool] = await Promise.all([
      loadLatestDividendLowVolManualDraftReadiness(),
      dividendLowVolStrategyService.getLatestCandidatePool(userId, {
        limit,
        scope: 'all_latest_by_symbol',
      }),
    ])
    const draft = buildDividendLowVolManualTradeDraft(pool, readiness, topN)
    return persistDividendLowVolManualTradeDraft({
      ...draft,
      userId,
      requestedBy: typeof body?.requestedBy === 'string' ? body.requestedBy : 'user',
    })
  })

  app.post<{ Params: { draftId: string } }>('/dividend-low-vol/manual-trade-draft/:draftId/review', async (request, reply) => {
    const draft = await loadDividendLowVolManualTradeDraftById(request.params.draftId)
    if (!draft) {
      reply.code(404)
      return {
        schemaVersion: 'dividend.low_vol.manual_trade_draft_review.v1',
        status: 'not_found',
        draftId: request.params.draftId,
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      }
    }
    return persistDividendLowVolManualTradeDraftReview(draft, request.body)
  })

  app.get('/dividend-low-vol/manual-watchlist', async () => {
    const latest = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-watchlist-')
    if (!latest) {
      return {
        schemaVersion: 'dividend.low_vol.manual_watchlist.v1',
        status: 'missing',
        entries: [],
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        notTradingAdvice: true,
      }
    }
    return latest
  })

  app.post('/dividend-low-vol/manual-watchlist/pretrade-check', async (_request, reply) => {
    const latest = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-watchlist-')
    if (!latest) {
      reply.code(404)
      return {
        schemaVersion: 'dividend.low_vol.manual_pretrade_check.v1',
        status: 'watchlist_missing',
        entries: [],
        executionReady: false,
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        notTradingAdvice: true,
      }
    }
    return persistDividendLowVolManualPretradeCheck(latest)
  })

  app.post('/dividend-low-vol/manual-watchlist/pretrade-check/review', async (request, reply) => {
    const latest = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-pretrade-check-')
    if (!latest) {
      reply.code(404)
      return {
        schemaVersion: 'dividend.low_vol.manual_pretrade_review.v1',
        status: 'pretrade_check_missing',
        executionReady: false,
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        notTradingAdvice: true,
      }
    }
    return persistDividendLowVolManualPretradeReview(latest, request.body)
  })

  app.get('/dividend-low-vol/manual-workflow-audit', async () => {
    return buildDividendLowVolManualWorkflowAudit()
  })

  app.get('/dividend-low-vol/manual-acceptance-review', async () => {
    const artifact = await loadLatestDividendLowVolPackageArtifact('27_manual_acceptance_review.json')
    if (artifact) return artifact
    return {
      schemaVersion: 'dividend.low_vol.manual_acceptance_review.v1',
      generatedAt: new Date().toISOString(),
      strategyId: dividendLowVolStrategyService.strategyId,
      status: 'missing',
      knownIncompleteItems: ['standard audit package has not been generated yet'],
      acceptanceChecklist: [],
      remainingValidationGaps: [],
      decisionBoundary: {
        researchReady: false,
        freeSourceValidationAllowed: false,
        manualTradeDraftReady: false,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
      safetyAssertions: {
        acceptanceReviewDoesNotCreateOrder: true,
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
      notTradingAdvice: true,
    }
  })

  app.post('/dividend-low-vol/manual-acceptance-review/decision', async (request, reply) => {
    const artifact = await loadLatestDividendLowVolPackageArtifact('27_manual_acceptance_review.json')
    if (!artifact) {
      reply.code(404)
      return {
        schemaVersion: 'dividend.low_vol.manual_acceptance_decision.v1',
        status: 'manual_acceptance_review_missing',
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        notTradingAdvice: true,
      }
    }
    return persistDividendLowVolManualAcceptanceDecision(artifact, request.body)
  })

  app.get('/dividend-low-vol/manual-acceptance-decision', async () => {
    const latest = await loadLatestDividendLowVolAuditArtifact('dividend-low-vol-manual-acceptance-decision-')
    if (latest) return latest
    return {
      schemaVersion: 'dividend.low_vol.manual_acceptance_decision.v1',
      status: 'missing',
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  })

  app.post('/dividend-low-vol/trading-zones', async (request) => {
    const body = request.body as any
    if (body?.persistedOnly === true) {
      const displayLimit = Math.max(1, Math.min(500, Number(body?.limit || 120)))
      const pool = await dividendLowVolStrategyService.getLatestCandidatePool(body?.userId || 'default', {
        limit: Math.max(displayLimit, Math.min(6000, Number(body?.poolLimit || 6000))),
        scope: 'all_latest_by_symbol',
      })
      return dividendLowVolTradingZoneService.buildTradingZonesFromFactSets(pool.candidates, {
        limit: displayLimit,
      })
    }
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolTradingZoneService.buildTradingZones(candidates, {
      limit: Math.max(1, Math.min(500, Number(body?.limit || 120))),
    })
  })

  app.post('/dividend-low-vol/rolling-backtest', async (request) => {
    const body = request.body as any
    const years = Math.max(1, Math.min(5, Number(body?.years || 3)))
    const { candidates } = await buildDividendInputs({
      ...body,
      historyDays: Math.max(Number(body?.historyDays || 0), years * 252),
    }, ['600000', '000001', '601398', '600519'])
    return dividendLowVolTradingZoneService.runRollingBacktest(candidates, {
      years,
      minRequiredTradingDays: typeof body?.minRequiredTradingDays === 'number' ? body.minRequiredTradingDays : undefined,
    })
  })

  app.get<{ Params: { assetId: string } }>('/dividend-low-vol/:assetId/factset', async (request) => {
    const query = request.query as any
    const userId = query?.userId || 'default'
    const persisted = await dividendFactSetService.getLatest(userId, request.params.assetId)
    if (persisted) return persisted
    const built = await dividendLowVolInputBuilderService.buildFromSymbol(request.params.assetId)
    const enriched = await dividendLowVolInputBuilderService.enrichWithPortfolioContext(userId, [built])
    return dividendFactSetService.build(enriched[0])
  })

  app.get<{ Params: { assetId: string } }>('/dividend-low-vol/:assetId/history', async (request) => {
    const query = request.query as any
    const limit = Math.max(1, Math.min(120, Number(query?.limit || 30)))
    return dividendLowVolStrategyService.getCandidateHistory(query?.userId || 'default', request.params.assetId, { limit })
  })

  app.get('/dividend-low-vol/alerts', async (request) => {
    const query = request.query as any
    return dividendLowVolAlertService.listLatest(query?.userId || 'default', {
      limit: Math.max(1, Math.min(500, Number(query?.limit || 200))),
      status: typeof query?.status === 'string' ? query.status : undefined,
    })
  })

  app.post('/dividend-low-vol/alerts/check', async (request) => {
    const body = request.body as any
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolAlertService.check(candidates)
  })

  app.post('/dividend-low-vol/audit-package', async (request) => {
    const body = request.body as any
    return dividendLowVolStrategyService.buildGptAuditPackage(body?.userId || 'default', {
      limit: Math.max(1, Math.min(500, Number(body?.limit || 200))),
    })
  })

  app.post('/dividend-low-vol/backtest', async (request) => {
    const body = request.body as any
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolBacktestService.run(candidates, {
      initialCapital: typeof body?.initialCapital === 'number' ? body.initialCapital : undefined,
      dividendReinvestment: body?.dividendReinvestment !== false,
      rebalanceFrequency: body?.rebalanceFrequency === 'weekly' ? 'weekly' : 'monthly',
    })
  })

  app.post('/dividend-low-vol/validation-retest', async (request) => {
    const body = request.body as any
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolBacktestService.runValidationRetest(candidates, {
      initialCapital: typeof body?.initialCapital === 'number' ? body.initialCapital : undefined,
      dividendReinvestment: body?.dividendReinvestment !== false,
      rebalanceFrequency: body?.rebalanceFrequency === 'weekly' ? 'weekly' : 'monthly',
      transactionCostBps: typeof body?.transactionCostBps === 'number' ? body.transactionCostBps : undefined,
      slippageBps: typeof body?.slippageBps === 'number' ? body.slippageBps : undefined,
    })
  })

  app.post('/dividend-low-vol/validation-gap-diagnostics', async (request) => {
    const body = request.body as any
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return buildDividendLowVolValidationGapDiagnostics(candidates, body)
  })

  app.post('/dividend-low-vol/fivd-r/candidates', async (request) => {
    const body = request.body as any
    const { candidates } = await buildDividendInputs(body, ['600000', '000001', '601398', '600519'])
    return dividendLowVolFivdRAdapter.buildCandidates(candidates)
  })
}
