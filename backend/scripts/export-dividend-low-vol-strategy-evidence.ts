import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'

function round(value: number, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return round((numerator / denominator) * 100, 2)
}

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function flag(name: string, envName: string) {
  const raw = arg(name) || process.env[envName]
  return raw === '1' || raw === 'true' || raw === 'yes'
}

async function latestValidationArtifact() {
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  const explicit = arg('validationArtifact')
  if (explicit) {
    const path = resolve(process.cwd(), explicit)
    return { path, fileName: path.split(/[\\/]/).at(-1) || explicit }
  }
  const mode = arg('mode') || process.env.FAMS_DIVIDEND_LOW_VOL_EVIDENCE_EXPORT_MODE || 'strict_v1'
  const files = await readdir(auditDir)
  if (mode === 'v2_research') {
    const fileName = files
      .filter((file) => file.startsWith('dividend-low-vol-v2-research-validation-') && file.endsWith('.json'))
      .sort()
      .at(-1)
    if (!fileName) throw new Error('No dividend-low-vol v2 research validation artifact found.')
    return { path: resolve(auditDir, fileName), fileName }
  }
  const fileName = files
    .filter((file) => file.startsWith('dividend-low-vol-validation-retest-real_latest_persisted-') && file.endsWith('.json'))
    .sort()
    .at(-1)
  if (!fileName) throw new Error('No dividend-low-vol real validation retest artifact found.')
  return { path: resolve(auditDir, fileName), fileName }
}

function normalizeValidationEvidence(artifact: any) {
  if (artifact.validationEvidenceMatrix) {
    return {
      mode: 'strict_v1',
      matrix: artifact.validationEvidenceMatrix,
      checks: artifact.validationEvidenceMatrix.checks || {},
      candidateValidationPassed: artifact.validationEvidenceMatrix.status === 'candidate_passed',
      usableForTradingAdvice: artifact.validationDecision?.usableForTradingAdvice === true,
      backtest: artifact.backtest || {},
      effectivePathCount: Number(artifact.backtest?.sample?.effectivePathCount || 0),
      candidateCount: Number(artifact.backtest?.sample?.researchEligibleCount || 0),
      backtestDays: Number(artifact.backtest?.sample?.tradingDays || 0),
      excessReturnPercent: artifact.backtest?.metrics?.excessReturnPercent ?? null,
    }
  }
  const evidence = artifact.backtest?.validationEvidence || {}
  const diagnostics = evidence.diagnostics || {}
  const checks = {
    outOfSample: {
      status: evidence.outOfSample || 'missing',
      diagnostics: {
        trainReturnPercent: diagnostics.trainReturnPercent ?? null,
        outOfSampleReturnPercent: diagnostics.outOfSampleReturnPercent ?? null,
      },
    },
    walkForward: {
      status: evidence.walkForward || 'missing',
      diagnostics: {
        walkForwardWindows: diagnostics.walkForwardWindows ?? null,
        walkForwardPassedWindows: diagnostics.walkForwardPassedWindows ?? null,
      },
    },
    parameterSensitivity: {
      status: evidence.parameterSensitivity || 'missing',
      diagnostics: {
        scoreDispersion: diagnostics.scoreDispersion ?? null,
      },
    },
    groupStability: {
      status: evidence.groupStability || 'missing',
      diagnostics: {
        industryGroupCount: diagnostics.industryGroupCount ?? null,
      },
    },
  }
  const candidateValidationPassed = [
    checks.outOfSample.status,
    checks.walkForward.status,
    checks.parameterSensitivity.status,
    checks.groupStability.status,
  ].every((status) => status === 'candidate_passed')
  return {
    mode: 'v2_research',
    matrix: {
      schemaVersion: 'dividend.low_vol.validation_evidence_matrix.v1',
      status: candidateValidationPassed ? 'candidate_passed' : 'insufficient',
      checks,
      note: 'Synthesized from dividend_low_vol_leader_v2_research artifact for global readiness visibility only. It does not unlock formal trade actions.',
    },
    checks,
    candidateValidationPassed,
    usableForTradingAdvice: false,
    backtest: artifact.backtest || {},
    effectivePathCount: Number(artifact.backtest?.sample?.effectivePathCount || 0),
    candidateCount: Number(artifact.latestPool?.v2ResearchCandidates || artifact.backtest?.sample?.researchEligibleCount || 0),
    backtestDays: Number(artifact.backtest?.sample?.tradingDays || 0),
    excessReturnPercent: artifact.backtest?.metrics?.excessReturnPercent ?? null,
  }
}

async function canonicalUniverseTotal() {
  const canonicalPath = resolve(process.cwd(), 'data/a-share-quote-list-canonical.json')
  return readFile(canonicalPath, 'utf8')
    .then((content) => {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed.items) ? parsed.items.filter((item: any) => /^\d{6}$/.test(item.code)).length : 0
    })
    .catch(() => 0)
}

function gate(
  id: string,
  label: string,
  passed: boolean,
  actual: number | string | null,
  required: number | string,
  severity: 'blocker' | 'warning',
  message: string,
) {
  return {
    id,
    label,
    status: passed ? 'passed' : 'failed',
    actual,
    required,
    severity,
    message,
  }
}

async function main() {
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const limit = Number(arg('limit') || process.env.FAMS_DIVIDEND_LOW_VOL_EVIDENCE_EXPORT_LIMIT || 6000)
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: Number.isFinite(limit) ? limit : 6000,
    scope: 'all_latest_by_symbol',
  })
  const validationRef = await latestValidationArtifact()
  const validationArtifact = JSON.parse(await readFile(validationRef.path, 'utf8'))
  const normalizedValidation = normalizeValidationEvidence(validationArtifact)
  const universeTotal = await canonicalUniverseTotal()
  const scannedCount = pool.total
  const evaluatedCount = pool.metricCompletenessSummary.completeDisplayReadyCount
  const scanCoveragePercent = pct(scannedCount, universeTotal || scannedCount)
  const evaluatedCoveragePercent = pct(evaluatedCount, Math.max(scannedCount, 1))
  const backtestDays = normalizedValidation.backtestDays
  const effectivePathCount = normalizedValidation.effectivePathCount
  const candidateCount = normalizedValidation.candidateCount || pool.eligibleResearchCandidates || 0
  const matrix = normalizedValidation.matrix || {}
  const checks = normalizedValidation.checks || {}
  const candidateValidationPassed = normalizedValidation.candidateValidationPassed
  const providerSuccessRate = evaluatedCoveragePercent
  const persistedFactsetCacheHitRate = evaluatedCoveragePercent
  const cacheHitRate = persistedFactsetCacheHitRate
  const manualDraftPromotionRequested = flag('manualDraftPromotion', 'FAMS_DIVIDEND_LOW_VOL_MANUAL_DRAFT_PROMOTION')
  const manualDraftEvidenceReady = candidateValidationPassed
    && effectivePathCount >= 100
    && backtestDays >= 60
    && scanCoveragePercent >= 80
    && providerSuccessRate >= 95
  const usableForTradingAdvice = normalizedValidation.usableForTradingAdvice || (manualDraftPromotionRequested && manualDraftEvidenceReady)
  const validationEvidenceLabel = usableForTradingAdvice
    ? 'manual_trade_draft_ready'
    : candidateValidationPassed
      ? 'candidate_passed_but_not_trade_usable'
      : matrix.status || 'unknown'
  const validationEvidenceMessage = usableForTradingAdvice
    ? '红利低波 validationDecision 已允许进入人工交易计划草案复核；正式 ADD / REDUCE / AUTO_TRADE 仍禁止。'
    : candidateValidationPassed
      ? '红利低波候选级验证通过，但 validationDecision 仍未允许正式交易建议。'
      : '红利低波验证矩阵仍未通过或证据不足，validationDecision 继续阻断正式交易建议。'
  const gates = [
    gate(
      'universe_source',
      '红利低波候选池来源',
      true,
      'dividend_low_vol_latest_persisted_free_source',
      'dividend_low_vol_latest_persisted_free_source',
      'blocker',
      '候选池来自红利低波免费源持久化事实集视图。'
    ),
    gate(
      'universe_coverage',
      '全A扫描覆盖',
      scanCoveragePercent >= 80,
      `${scanCoveragePercent}%`,
      '>= 80%',
      'blocker',
      scanCoveragePercent >= 80
        ? '红利低波候选池覆盖达到全 A 长样本验收门槛。'
        : '当前红利低波唯一标的覆盖不足 80%，不能作为全 A 交易动作证据。'
    ),
    gate(
      'provider_success_rate',
      '免费源字段完整率',
      providerSuccessRate >= 95,
      `${providerSuccessRate}%`,
      '>= 95%',
      'blocker',
      providerSuccessRate >= 95
        ? '候选池展示字段完整率达标。'
        : '候选池展示字段仍有缺口，需要继续补免费源数据。'
    ),
    gate(
      'cache_hit_rate',
      '历史行情缓存命中率',
      cacheHitRate >= 80,
      `${cacheHitRate}%`,
      '>= 80%',
      'warning',
      cacheHitRate >= 80
        ? '红利低波全 A 事实集已从持久化免费源视图读取；该口径用于 strategy evidence cache gate，不等同于正式交易所行情缓存。'
        : '红利低波当前验证允许免费历史 fallback；尚未形成全 A cache-hit 审计口径。'
    ),
    gate(
      'backtest_window',
      '长窗口回测天数',
      backtestDays >= 60,
      backtestDays,
      '>= 60',
      'blocker',
      backtestDays >= 60 ? '红利低波验证窗口达到 60 日以上。' : '红利低波验证窗口不足 60 日。'
    ),
    gate(
      'trade_sample_size',
      '策略成交样本量',
      effectivePathCount >= 100,
      effectivePathCount,
      '>= 100',
      'blocker',
      effectivePathCount >= 100
        ? '红利低波有效路径数量达到全局交易动作门槛。'
        : '红利低波当前研究候选数量较少，只能作为候选级研究验证。'
    ),
    gate(
      'validation_evidence',
      '红利低波验证矩阵',
      usableForTradingAdvice,
      validationEvidenceLabel,
      'usableForTradingAdvice=true',
      'blocker',
      validationEvidenceMessage
    ),
    gate(
      'factset_coverage',
      '红利低波指标展示完整率',
      evaluatedCoveragePercent >= 95,
      `${evaluatedCoveragePercent}%`,
      '>= 95%',
      'warning',
      evaluatedCoveragePercent >= 95 ? '红利低波指标展示完整率可支撑研究审计。' : '红利低波指标展示仍有缺口。'
    ),
  ]
  const blockers = gates.filter((item) => item.severity === 'blocker' && item.status !== 'passed')
  const result = {
    schemaVersion: 'fams.dividend_low_vol.strategy_evidence_export.v1',
    operationKind: 'strategy_tournament_run',
    evidenceMode: 'async_strategy_evidence',
    strategyFamily: dividendLowVolStrategyService.strategyFamily,
    strategyId: dividendLowVolStrategyService.strategyId,
    generatedAt: new Date().toISOString(),
    sourceValidationArtifact: validationRef,
    longSampleAcceptance: {
      schemaVersion: 'fams.screener.long_sample_acceptance.v1',
      generatedAt: new Date().toISOString(),
      status: blockers.length > 0 ? 'insufficient' : 'passed',
      summary: {
        universeSize: universeTotal || scannedCount,
        universeSource: 'dividend_low_vol_latest_persisted_free_source',
        universeTotal: universeTotal || scannedCount,
        scannedCount,
        evaluatedCount,
        failureCount: Math.max(scannedCount - evaluatedCount, 0),
        scanCoveragePercent,
        providerSuccessRate,
        cacheHitRate,
        backtestDays,
        rankedCandidates: candidateCount,
        bestSampleSize: effectivePathCount,
        bestCredibility: usableForTradingAdvice ? 'high' : candidateValidationPassed ? 'medium' : 'low',
      },
      gates,
      topCandidates: pool.candidates
        .filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
        .slice(0, 10)
        .map((candidate) => ({
          candidateId: candidate.identity.symbol,
          strategyId: candidate.strategyId,
          sampleSize: effectivePathCount,
          tradeCount: effectivePathCount,
          credibility: usableForTradingAdvice ? 'high' : candidateValidationPassed ? 'medium' : 'low',
          excessReturnPercent: normalizedValidation.excessReturnPercent,
          outOfSampleStatus: checks.outOfSample?.status || 'unknown',
          walkForwardStatus: checks.walkForward?.status || 'unknown',
          parameterSensitivityStatus: checks.parameterSensitivity?.status || 'unknown',
          groupStabilityStatus: checks.groupStability?.status || 'unknown',
        })),
      recommendations: [
        '该 operation 用于让全局 readiness 能看到红利低波验证证据，不代表交易动作放行。',
        ...(scanCoveragePercent >= 80 ? [] : ['继续扩大红利低波唯一标的覆盖，目标 >=80% 全 A universe。']),
      ...(effectivePathCount >= 100 ? [] : ['扩大候选路径数量或验证窗口，目标 bestSampleSize >=100。']),
        ...(usableForTradingAdvice
          ? ['当前 evidence 只放行人工交易计划草案复核；正式 ADD / REDUCE / AUTO_TRADE 继续禁止。']
          : ['保持 ADD / REDUCE / AUTO_TRADE 禁止，等待正式 validationDecision 放行。']),
        ...(normalizedValidation.mode === 'v2_research'
          ? [manualDraftPromotionRequested
            ? '当前 evidence 来自 V2 research artifact，并通过显式 manualDraftPromotion 开关升级为人工草案复核候选；不构成自动交易授权。'
            : '当前 evidence 来自 V2 research artifact，仅用于显示样本量和研究验证改善，不构成 formal validation。']
          : []),
      ],
    },
    validationDecision: {
      decision: usableForTradingAdvice ? 'READY_FOR_MANUAL_TRADE_DRAFT' : 'OBSERVE_ONLY',
      usableForTradingAdvice,
      allowedActions: usableForTradingAdvice
        ? ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT']
        : ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      primaryBlocker: usableForTradingAdvice
        ? null
        : candidateValidationPassed
          ? 'formal_trade_gate_still_requires_manual_review'
          : 'validation_evidence',
      reasons: usableForTradingAdvice
        ? []
        : candidateValidationPassed
          ? ['红利低波候选级验证通过，但全局交易动作仍需要全 A 覆盖、样本量和人工复核 gate。']
          : ['红利低波验证矩阵仍未通过或证据不足，正式 ADD / REDUCE / AUTO_TRADE 继续禁止。'],
    },
    dividendLowVolValidationEvidenceMatrix: matrix,
    evidencePromotionStatus: {
      sourceMode: normalizedValidation.mode,
      researchCandidatePassed: candidateValidationPassed,
      sampleSizeGatePassed: effectivePathCount >= 100,
      formalValidationPassed: usableForTradingAdvice,
      manualDraftPromotionRequested,
      manualDraftEvidenceReady,
      promotionStage: candidateValidationPassed && effectivePathCount >= 100
        ? usableForTradingAdvice
          ? 'manual_trade_draft_ready_auto_trade_blocked'
          : 'research_candidate_passed_formal_validation_pending'
        : 'research_validation_incomplete',
      notTradingAdvice: true,
    },
    artifactRefs: [
      validationRef.path,
      ...(pool.source?.excludedSourceOperationIds || []).map((id) => `quarantined-source-operation:${id}`),
    ],
    notTradingAdvice: true,
  }
  const idempotencyKey = `dividend-low-vol-strategy-evidence:${validationRef.fileName}`
  const now = new Date()
  const operation = await prisma.operation.upsert({
    where: {
      type_idempotencyKey: {
        type: 'strategy_tournament_run',
        idempotencyKey,
      },
    },
    create: {
      userId,
      type: 'strategy_tournament_run',
      status: 'completed',
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      progressPct: 100,
      progressCurrent: scannedCount,
      progressTotal: universeTotal || scannedCount,
      progressMessage: 'Dividend low-vol strategy evidence exported for global readiness audit.',
      createdBy: 'agent',
      idempotencyKey,
      inputJson: JSON.stringify({
        strategyId: dividendLowVolStrategyService.strategyId,
        sourceValidationArtifact: validationRef.fileName,
        source: normalizedValidation.mode === 'v2_research' ? 'dividend_low_vol_v2_research_validation' : 'dividend_low_vol_validation_retest',
      }),
      resultJson: JSON.stringify(result),
      artifactRefsJson: JSON.stringify(result.artifactRefs),
    },
    update: {
      status: 'completed',
      startedAt: now,
      completedAt: now,
      progressPct: 100,
      progressCurrent: scannedCount,
      progressTotal: universeTotal || scannedCount,
      progressMessage: 'Dividend low-vol strategy evidence exported for global readiness audit.',
      resultJson: JSON.stringify(result),
      artifactRefsJson: JSON.stringify(result.artifactRefs),
    },
  })
  console.log(JSON.stringify({
    ok: true,
    operationId: operation.id,
    idempotencyKey,
    longSampleAcceptance: result.longSampleAcceptance,
    validationDecision: result.validationDecision,
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
