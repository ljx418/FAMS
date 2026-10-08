import { createHash } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import {
  downtrendDefensiveConfigSchema,
  resolveGridTradingRules,
  roundGridPrice,
  type DowntrendDefensiveConfig,
} from './gridStrategyService.js'

export type ReanchorTriggerState = 'true' | 'false' | 'unknown'

export interface ReanchorChartPoint {
  date: string
  close: number
  ma5: number | null
}

export interface ReanchorEvaluationInput {
  symbol: string
  assetType: string
  market: string
  config: DowntrendDefensiveConfig
  latestCompletedDate: string
  latestCompletedClose: number
  livePrice: number | null
  atr14: number | null
  chart: ReanchorChartPoint[]
  completedFillCycle?: boolean | null
}

export interface ReanchorTriggerEvaluation {
  code: string
  label: string
  state: ReanchorTriggerState
  configured: boolean
  evidence: Record<string, unknown>
}

export interface DowntrendReanchorEvaluation {
  schemaVersion: 'fams.downtrend-reanchor-evaluation.v1'
  policyVersion: 'fams.reanchor-policy.v1'
  symbol: string
  required: boolean
  reasonCodes: string[]
  anchor: {
    price: number
    asOf: string
    ageCompletedSessions: number
  }
  market: {
    latestCompletedDate: string
    latestCompletedClose: number
    livePrice: number | null
    atr14: number | null
  }
  drift: {
    absolute: number
    percent: number
    atrMultiple: number | null
    agedSessionThreshold: number
    agedAtrThreshold: number
    immediateAtrThreshold: number
    fallbackPercentThreshold: number
  }
  triggers: ReanchorTriggerEvaluation[]
  evidenceHash: string
}

export interface ReanchorCandidateRecord {
  symbol: string
  market: string
  assetType: string
  source: 'active_strategy_version' | 'legacy_strategy_state'
  sourceStrategyVersionId: string | null
  config: DowntrendDefensiveConfig
}

export interface ReanchorDecisionInput {
  userId: string
  reviewId: string
  versionId: string
  candidateHash: string
  decision: 'confirm' | 'reject'
  confirmedBy: string
  acknowledgedNoBrokerExecution: boolean
  reason?: string
}

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

const dateOnly = (value: string) => value.slice(0, 10)

const isAfter = (left: string, right: string) => dateOnly(left) > dateOnly(right)

const fallbackDriftPercent = (assetType: string) => assetType === 'etf' || assetType === 'fund' ? 3 : 5

const triggerLabel: Record<string, string> = {
  completed_fill_cycle: '完成一组可追溯的卖出—回补周期',
  pause_trigger: '最新完整收盘价触发暂停线',
  two_closes_above_ma5_with_nonfalling_ma5: '连续两日收盘高于 MA5 且 MA5 不再下降',
  aged_anchor_drift: '锚点老化且价格偏移达到门槛',
  immediate_extreme_drift: '价格相对锚点出现极端 ATR 偏移',
}

function completedSessionAge(chart: ReanchorChartPoint[], anchorAsOf: string) {
  const anchorDate = dateOnly(anchorAsOf)
  return new Set(chart.filter((point) => point.date > anchorDate).map((point) => point.date)).size
}

function eventTrigger(
  code: string,
  configured: boolean,
  input: ReanchorEvaluationInput,
): ReanchorTriggerEvaluation {
  const anchorDate = dateOnly(input.config.fixedAnchor.asOf)
  if (!configured) return { code, label: triggerLabel[code] || code, state: 'false', configured: false, evidence: {} }
  if (code === 'completed_fill_cycle') {
    return {
      code,
      label: triggerLabel[code],
      state: input.completedFillCycle === true ? 'true' : input.completedFillCycle === false ? 'false' : 'unknown',
      configured: true,
      evidence: { linkedFillCycleAvailable: input.completedFillCycle !== null && input.completedFillCycle !== undefined },
    }
  }
  if (code === 'pause_trigger') {
    const rule = input.config.riskPolicy.pauseRule
    const afterAnchor = isAfter(input.latestCompletedDate, anchorDate)
    const hit = Boolean(rule && afterAnchor && input.latestCompletedClose < rule.threshold)
    return {
      code,
      label: triggerLabel[code],
      state: rule ? hit ? 'true' : 'false' : 'unknown',
      configured: true,
      evidence: {
        latestCompletedDate: input.latestCompletedDate,
        latestCompletedClose: input.latestCompletedClose,
        anchorDate,
        afterAnchor,
        threshold: rule?.threshold ?? null,
        operator: rule?.operator ?? null,
      },
    }
  }
  if (code === 'two_closes_above_ma5_with_nonfalling_ma5') {
    const rows = input.chart
      .filter((point) => point.date > anchorDate && Number.isFinite(point.close) && Number.isFinite(Number(point.ma5)))
      .slice(-2)
    if (rows.length < 2) {
      return {
        code,
        label: triggerLabel[code],
        state: 'unknown',
        configured: true,
        evidence: { anchorDate, completedRowsAfterAnchor: rows },
      }
    }
    const hit = rows.every((point) => point.close > Number(point.ma5))
      && Number(rows[1].ma5) >= Number(rows[0].ma5)
    return {
      code,
      label: triggerLabel[code],
      state: hit ? 'true' : 'false',
      configured: true,
      evidence: { anchorDate, completedRowsAfterAnchor: rows },
    }
  }
  return { code, label: triggerLabel[code] || code, state: 'unknown', configured: true, evidence: {} }
}

class DowntrendReanchorService {
  evaluate(input: ReanchorEvaluationInput): DowntrendReanchorEvaluation {
    const anchor = input.config.fixedAnchor.price
    const ageCompletedSessions = completedSessionAge(input.chart, input.config.fixedAnchor.asOf)
    const absolute = Math.abs(input.latestCompletedClose - anchor)
    const percent = anchor > 0 ? absolute / anchor * 100 : 0
    const atr14 = Number.isFinite(Number(input.atr14)) && Number(input.atr14) > 0 ? Number(input.atr14) : null
    const atrMultiple = atr14 ? absolute / atr14 : null
    const fallbackPercentThreshold = fallbackDriftPercent(input.assetType)
    const hasNewCompletedBar = isAfter(input.latestCompletedDate, input.config.fixedAnchor.asOf)
    const configuredEvents = new Set(input.config.fixedAnchor.reanchorOnlyAfter)
    const triggers = [
      eventTrigger('completed_fill_cycle', configuredEvents.has('completed_fill_cycle'), input),
      eventTrigger('pause_trigger', configuredEvents.has('pause_trigger'), input),
      eventTrigger('two_closes_above_ma5_with_nonfalling_ma5', configuredEvents.has('two_closes_above_ma5_with_nonfalling_ma5'), input),
    ]
    const agedHit = ageCompletedSessions >= 5 && (atrMultiple !== null ? atrMultiple >= 2 : percent >= fallbackPercentThreshold)
    const extremeHit = hasNewCompletedBar && (atrMultiple !== null ? atrMultiple >= 3 : percent >= fallbackPercentThreshold)
    triggers.push({
      code: 'aged_anchor_drift',
      label: triggerLabel.aged_anchor_drift,
      state: agedHit ? 'true' : 'false',
      configured: true,
      evidence: { ageCompletedSessions, minimumSessions: 5, atrMultiple, atrThreshold: 2, percent, fallbackPercentThreshold },
    })
    triggers.push({
      code: 'immediate_extreme_drift',
      label: triggerLabel.immediate_extreme_drift,
      state: extremeHit ? 'true' : 'false',
      configured: true,
      evidence: { hasNewCompletedBar, atrMultiple, atrThreshold: 3, percent, fallbackPercentThreshold, fallbackUsed: atrMultiple === null },
    })
    const reasonCodes = triggers.filter((trigger) => trigger.state === 'true').map((trigger) => trigger.code)
    const evidence = {
      symbol: input.symbol,
      anchor: input.config.fixedAnchor,
      latestCompletedDate: input.latestCompletedDate,
      latestCompletedClose: input.latestCompletedClose,
      livePrice: input.livePrice,
      atr14,
      ageCompletedSessions,
      percent,
      atrMultiple,
      triggers,
    }
    return {
      schemaVersion: 'fams.downtrend-reanchor-evaluation.v1',
      policyVersion: 'fams.reanchor-policy.v1',
      symbol: input.symbol,
      required: reasonCodes.length > 0,
      reasonCodes,
      anchor: { price: anchor, asOf: input.config.fixedAnchor.asOf, ageCompletedSessions },
      market: {
        latestCompletedDate: input.latestCompletedDate,
        latestCompletedClose: input.latestCompletedClose,
        livePrice: input.livePrice,
        atr14,
      },
      drift: {
        absolute: Number(absolute.toFixed(6)),
        percent: Number(percent.toFixed(4)),
        atrMultiple: atrMultiple === null ? null : Number(atrMultiple.toFixed(4)),
        agedSessionThreshold: 5,
        agedAtrThreshold: 2,
        immediateAtrThreshold: 3,
        fallbackPercentThreshold,
      },
      triggers,
      evidenceHash: stableHash(evidence),
    }
  }

  buildCandidate(input: {
    config: DowntrendDefensiveConfig
    evaluation: DowntrendReanchorEvaluation
    assetType: string
    market: string
  }) {
    const newAnchor = input.evaluation.market.latestCompletedClose
    const oldAnchor = input.config.fixedAnchor.price
    const tradingRules = resolveGridTradingRules(input.assetType, input.market)
    const levels = input.config.levels.map((level) => {
      const relativeOffset = oldAnchor > 0 ? level.price / oldAnchor - 1 : 0
      const rawPrice = newAnchor * (1 + relativeOffset)
      const price = roundGridPrice(rawPrice, tradingRules.priceTick, level.side)
      return {
        ...level,
        price,
        rationale: `${level.rationale} 再锚定仅平移价格结构；仓位角色、数量和父子关系未改变。`,
      }
    })
    const candidate: DowntrendDefensiveConfig = {
      ...structuredClone(input.config),
      templateId: `${input.config.templateId.replace(/_reanchor_\d{8}$/, '')}_reanchor_${input.evaluation.market.latestCompletedDate.replaceAll('-', '')}`,
      status: 'candidate_awaiting_user_confirmation',
      source_id: `REANCHOR:${input.evaluation.evidenceHash.slice(0, 16)}`,
      fixedAnchor: {
        price: newAnchor,
        asOf: `${input.evaluation.market.latestCompletedDate}T15:00:00+08:00`,
        reanchorOnlyAfter: [...input.config.fixedAnchor.reanchorOnlyAfter],
      },
      levels,
    }
    const validation = downtrendDefensiveConfigSchema.safeParse(candidate)
    if (!validation.success) throw new Error(`reanchor_candidate_invalid:${validation.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`).join('|')}`)
    const levelDiffs = input.config.levels.map((level, index) => ({
      orderRef: level.orderRef,
      side: level.side,
      orderRole: level.orderRole,
      quantity: level.quantity,
      oldPrice: level.price,
      newPrice: levels[index].price,
      relativeOffsetPercent: Number(((level.price / oldAnchor - 1) * 100).toFixed(4)),
    }))
    return {
      config: validation.data,
      levelDiffs,
      formula: 'candidate_price = latest_completed_close * (old_level_price / old_fixed_anchor)',
      tradingRules,
    }
  }

  async resolveConfigs(userId: string, legacyConfigs: Record<string, DowntrendDefensiveConfig | undefined>) {
    const versions = await prisma.strategyVersion.findMany({
      where: { isActive: true, strategy: { userId, isActive: true, type: 'grid_downtrend_defensive' } },
      include: { strategy: true },
      orderBy: { activatedAt: 'desc' },
    })
    const active = new Map<string, ReanchorCandidateRecord>()
    for (const version of versions) {
      const validation = parseJson<any>(version.validationJson, {})
      const symbol = String(validation?.reanchor?.symbol || '')
      const parsed = downtrendDefensiveConfigSchema.safeParse(parseJson(version.versionBundleJson, {}))
      if (!symbol || !parsed.success || active.has(symbol)) continue
      active.set(symbol, {
        symbol,
        market: String(validation.reanchor.market || 'CN'),
        assetType: String(validation.reanchor.assetType || 'stock'),
        source: 'active_strategy_version',
        sourceStrategyVersionId: version.id,
        config: parsed.data,
      })
    }
    const symbols = new Set([...Object.keys(legacyConfigs), ...active.keys()])
    return new Map([...symbols].flatMap((symbol) => {
      const database = active.get(symbol)
      if (database) return [[symbol, database] as const]
      const parsed = downtrendDefensiveConfigSchema.safeParse(legacyConfigs[symbol])
      return parsed.success ? [[symbol, {
        symbol,
        market: 'CN',
        assetType: 'stock',
        source: 'legacy_strategy_state' as const,
        sourceStrategyVersionId: null,
        config: parsed.data,
      }] as const] : []
    }))
  }

  async createCandidate(input: {
    userId: string
    reviewId: string
    symbol: string
    name: string
    market: string
    assetType: string
    source: ReanchorCandidateRecord['source']
    sourceStrategyVersionId: string | null
    sourceConfig: DowntrendDefensiveConfig
    candidateConfig: DowntrendDefensiveConfig
    evaluation: DowntrendReanchorEvaluation
    levelDiffs: Array<Record<string, unknown>>
    formula: string
    suggestionOnly?: boolean
  }) {
    await ensureUser(prisma, input.userId)
    const strategyKey = `grid:downtrend:${input.userId}:${input.market}:${input.symbol}`
    const candidateHash = stableHash({
      reviewId: input.reviewId,
      symbol: input.symbol,
      sourceStrategyVersionId: input.sourceStrategyVersionId,
      sourceConfig: input.sourceConfig,
      candidateConfig: input.candidateConfig,
      evidenceHash: input.evaluation.evidenceHash,
    })
    const existing = await prisma.strategyVersion.findFirst({
      where: { strategyKey, auditHash: stableHash({ config: input.candidateConfig, candidateHash }) },
      include: { strategy: true },
    })
    if (existing) {
      if (input.suggestionOnly === true) {
        const validation = parseJson<any>(existing.validationJson, {})
        if (validation.activatable !== false || validation.reanchor?.state !== 'suggestion_only') {
          validation.activatable = false
          validation.reanchor = { ...(validation.reanchor || {}), state: 'suggestion_only', decision: null }
          const updated = await prisma.strategyVersion.update({
            where: { id: existing.id },
            data: { validationJson: JSON.stringify(validation) },
            include: { strategy: true },
          })
          return this.describeCandidate(updated)
        }
      }
      return this.describeCandidate(existing)
    }
    const prior = await prisma.strategyVersion.findFirst({ where: { strategyKey }, include: { strategy: true }, orderBy: { createdAt: 'asc' } })
    const strategy = prior?.strategy || await prisma.strategy.create({
      data: {
        userId: input.userId,
        name: `${input.name}固定网格`,
        description: '按完整日线检测固定锚点漂移；候选须经用户逐标的明确确认，不会触发券商订单。',
        type: 'grid_downtrend_defensive',
        parameters: JSON.stringify(input.sourceConfig),
        isActive: false,
      },
    })
    const schemaValidation = downtrendDefensiveConfigSchema.safeParse(input.candidateConfig)
    const validationJson = {
      schema: schemaValidation.success ? { valid: true, errors: [] } : { valid: false, errors: schemaValidation.error.issues },
      activatable: schemaValidation.success && input.suggestionOnly !== true,
      reanchor: {
        schemaVersion: 'fams.reanchor-candidate.v1',
        state: input.suggestionOnly === true ? 'suggestion_only' : 'awaiting_confirmation',
        reviewId: input.reviewId,
        symbol: input.symbol,
        market: input.market,
        assetType: input.assetType,
        source: input.source,
        sourceStrategyVersionId: input.sourceStrategyVersionId,
        candidateHash,
        evidenceHash: input.evaluation.evidenceHash,
        evaluation: input.evaluation,
        levelDiffs: input.levelDiffs,
        formula: input.formula,
        decision: null,
      },
    }
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id,
        strategyKey,
        schemaVersion: input.candidateConfig.schemaVersion,
        signalStrategyId: input.candidateConfig.mode,
        signalVersion: 'v2-reanchor',
        thresholdHash: stableHash({ anchor: input.candidateConfig.fixedAnchor, policy: input.evaluation.policyVersion }),
        entryPolicyId: 'explicit_role_aware_levels', entryPolicyVersion: 'v2',
        exitPolicyId: 'paired_or_permanent_exit', exitPolicyVersion: 'v2',
        sizingPolicyId: 'core_satellite_rebound_capacity', sizingVersion: 'v2',
        portfolioPolicyId: 'hard_cash_floor_no_unfilled_proceeds', portfolioVersion: 'v2',
        costModelId: 'manual_plan_draft', costModelVersion: 'v1',
        constraintId: 'fams_trade_boundary', constraintVersion: 'v1',
        engineVersion: 'grid-plan-engine.v2-reanchor',
        versionBundleJson: JSON.stringify(input.candidateConfig),
        auditHash: stableHash({ config: input.candidateConfig, candidateHash }),
        isActive: false,
        validationJson: JSON.stringify(validationJson),
        validatedAt: schemaValidation.success ? new Date() : null,
      },
      include: { strategy: true },
    })
    return this.describeCandidate(version)
  }

  private describeCandidate(version: any) {
    const validation = parseJson<any>(version.validationJson, {})
    const config = parseJson<DowntrendDefensiveConfig>(version.versionBundleJson, {} as DowntrendDefensiveConfig)
    return {
      candidateStrategyVersionId: version.id,
      strategyId: version.strategyId,
      strategyKey: version.strategyKey,
      candidateHash: validation.reanchor?.candidateHash || null,
      state: validation.reanchor?.state || 'unknown',
      decision: validation.reanchor?.decision || null,
      symbol: validation.reanchor?.symbol || null,
      evaluation: validation.reanchor?.evaluation || null,
      levelDiffs: validation.reanchor?.levelDiffs || [],
      formula: validation.reanchor?.formula || null,
      candidateConfig: config,
    }
  }

  private async freshnessBlocker(version: any, review: any, metadata: any) {
    const latestDate = metadata?.evaluation?.market?.latestCompletedDate
    if (latestDate) {
      const latestBar = await prisma.marketBarCanonical.findFirst({
        where: { symbol: metadata.symbol, market: metadata.market, timeframe: '1d', dataVersion: 'canonical.v1' },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (latestBar && latestBar.tradeDate.toISOString().slice(0, 10) > latestDate) return 'NEW_COMPLETED_DAILY_BAR_AVAILABLE'
    }
    const newerBrokerCapture = await prisma.screenshotCapture.findFirst({
      where: {
        userId: review.userId,
        confirmedAt: { gt: review.generatedAt },
        rows: {
          some: {
            status: 'confirmed',
            rowType: { in: ['holding', 'trade', 'order', 'pending_order'] },
            fieldsJson: { contains: `\"symbol\":\"${metadata.symbol}\"` },
          },
        },
      },
      select: { id: true },
    })
    if (newerBrokerCapture) return 'NEWER_BROKER_CAPTURE_AVAILABLE'
    const active = await prisma.strategyVersion.findFirst({ where: { strategyKey: version.strategyKey, isActive: true }, orderBy: { activatedAt: 'desc' } })
    if ((metadata.sourceStrategyVersionId || active) && active?.id !== metadata.sourceStrategyVersionId) return 'ACTIVE_STRATEGY_VERSION_CHANGED'
    return null
  }

  async decide(input: ReanchorDecisionInput) {
    if (!input.confirmedBy.trim() || input.acknowledgedNoBrokerExecution !== true) {
      return { status: 'blocked', code: 'HUMAN_CONFIRMATION_REQUIRED', requiresHumanConfirmation: true }
    }
    const [review, version] = await Promise.all([
      prisma.dailyReviewRun.findFirst({ where: { id: input.reviewId, userId: input.userId } }),
      prisma.strategyVersion.findUnique({ where: { id: input.versionId }, include: { strategy: true } }),
    ])
    if (!review || !version || version.strategy.userId !== input.userId) return { status: 'blocked', code: 'REANCHOR_CANDIDATE_NOT_FOUND' }
    const validation = parseJson<any>(version.validationJson, {})
    const metadata = validation.reanchor
    if (!metadata || metadata.reviewId !== input.reviewId || metadata.candidateHash !== input.candidateHash) {
      return { status: 'blocked', code: 'REANCHOR_CANDIDATE_HASH_MISMATCH' }
    }
    if (metadata.state === 'suggestion_only' || validation.activatable === false) {
      return { status: 'blocked', code: 'SINGLE_CONFIRMATION_SUGGESTION_NOT_ACTIVATABLE', requiresHumanConfirmation: false }
    }
    if (metadata.decision) {
      if (metadata.decision.value !== input.decision) return { status: 'blocked', code: 'REANCHOR_DECISION_CONFLICT', decision: metadata.decision }
      return this.resolutionState(input.userId, input.reviewId, version.id)
    }
    const freshnessBlocker = await this.freshnessBlocker(version, review, metadata)
    if (freshnessBlocker) {
      validation.activatable = false
      validation.reanchor = { ...metadata, state: 'stale', staleReason: freshnessBlocker }
      await prisma.strategyVersion.update({ where: { id: version.id }, data: { validationJson: JSON.stringify(validation) } })
      return { status: 'blocked', code: 'REANCHOR_CANDIDATE_STALE', staleReason: freshnessBlocker }
    }
    validation.reanchor = {
      ...metadata,
      state: 'decision_recorded',
      decision: {
        value: input.decision,
        confirmedBy: input.confirmedBy.trim(),
        decidedAt: new Date().toISOString(),
        reason: input.reason?.trim() || null,
        acknowledgedNoBrokerExecution: true,
      },
    }
    await prisma.strategyVersion.update({ where: { id: version.id }, data: { validationJson: JSON.stringify(validation) } })
    return this.resolutionState(input.userId, input.reviewId, version.id)
  }

  private async resolutionState(userId: string, reviewId: string, lastVersionId: string) {
    const rows = await prisma.strategyVersion.findMany({
      where: { strategy: { userId, type: 'grid_downtrend_defensive' }, validationJson: { contains: `\"reviewId\":\"${reviewId}\"` } },
      include: { strategy: true },
      orderBy: { createdAt: 'asc' },
    })
    const candidates = rows.map((row) => ({ row, validation: parseJson<any>(row.validationJson, {}), config: parseJson<DowntrendDefensiveConfig>(row.versionBundleJson, {} as DowntrendDefensiveConfig) }))
    const remaining = candidates.filter(({ validation }) => !validation.reanchor?.decision && validation.reanchor?.state !== 'stale')
    const stale = candidates.filter(({ validation }) => validation.reanchor?.state === 'stale')
    if (stale.length > 0) return { status: 'blocked', code: 'REANCHOR_CANDIDATE_STALE', staleVersionIds: stale.map(({ row }) => row.id) }
    const alreadyResolved = candidates.length > 0 && candidates.every(({ validation }) => ['resolved_confirmed', 'resolved_rejected'].includes(validation.reanchor?.state))
    if (alreadyResolved) {
      return {
        status: 'resolved',
        confirmedVersionIds: candidates.filter(({ validation }) => validation.reanchor?.state === 'resolved_confirmed').map(({ row }) => row.id),
        rejectedSymbols: candidates.filter(({ validation }) => validation.reanchor?.state === 'resolved_rejected').map(({ validation }) => String(validation.reanchor?.symbol)),
        decisions: candidates.map(({ row, validation }) => ({ versionId: row.id, symbol: validation.reanchor?.symbol, decision: validation.reanchor?.decision })),
      }
    }
    if (remaining.length > 0) {
      return {
        status: 'awaiting_other_decisions',
        lastVersionId,
        remainingCandidates: remaining.map(({ row, validation }) => ({ versionId: row.id, symbol: validation.reanchor?.symbol })),
      }
    }
    const confirmed = candidates.filter(({ validation }) => validation.reanchor?.decision?.value === 'confirm')
    const rejected = candidates.filter(({ validation }) => validation.reanchor?.decision?.value === 'reject')
    const review = await prisma.dailyReviewRun.findFirst({ where: { id: reviewId, userId } })
    if (!review) return { status: 'blocked', code: 'REANCHOR_REVIEW_NOT_FOUND' }
    for (const candidate of confirmed) {
      const blocker = await this.freshnessBlocker(candidate.row, review, candidate.validation.reanchor)
      if (!blocker) continue
      candidate.validation.activatable = false
      candidate.validation.reanchor = { ...candidate.validation.reanchor, state: 'stale', staleReason: blocker }
      await prisma.strategyVersion.update({
        where: { id: candidate.row.id },
        data: { validationJson: JSON.stringify(candidate.validation) },
      })
      return { status: 'blocked', code: 'REANCHOR_CANDIDATE_STALE', staleReason: blocker, staleVersionIds: [candidate.row.id] }
    }
    await prisma.$transaction([
      ...confirmed.flatMap(({ row, validation, config }) => [
        prisma.strategyVersion.updateMany({ where: { strategyKey: row.strategyKey, isActive: true }, data: { isActive: false } }),
        prisma.strategyVersion.update({
          where: { id: row.id },
          data: {
            isActive: true,
            activatedAt: new Date(),
            validationJson: JSON.stringify({ ...validation, reanchor: { ...validation.reanchor, state: 'resolved_confirmed' } }),
          },
        }),
        prisma.strategy.update({ where: { id: row.strategyId }, data: { isActive: true, parameters: JSON.stringify(config) } }),
      ]),
      ...rejected.map(({ row, validation }) => prisma.strategyVersion.update({
        where: { id: row.id },
        data: { validationJson: JSON.stringify({ ...validation, activatable: false, reanchor: { ...validation.reanchor, state: 'resolved_rejected' } }) },
      })),
    ])
    return {
      status: 'resolved',
      confirmedVersionIds: confirmed.map(({ row }) => row.id),
      rejectedSymbols: rejected.map(({ validation }) => String(validation.reanchor?.symbol)),
      decisions: candidates.map(({ row, validation }) => ({ versionId: row.id, symbol: validation.reanchor?.symbol, decision: validation.reanchor?.decision })),
    }
  }
}

export const downtrendReanchorService = new DowntrendReanchorService()
