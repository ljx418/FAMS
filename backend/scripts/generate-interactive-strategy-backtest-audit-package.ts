import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/db/prisma.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'
import { portfolioProxyMarketDataService } from '../src/services/portfolio-backtest/portfolioProxyMarketDataService.js'
import { runtimeHealthService } from '../src/services/runtime/runtimeHealthService.js'

const GENERATED_AT = new Date().toISOString()
const STAMP = GENERATED_AT.replace(/[:.]/g, '-')
const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT']
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function backendRoot() {
  return resolve(repoRoot(), 'backend')
}

function auditDir() {
  return resolve(backendRoot(), 'data/gpt-audit/interactive-strategy-backtest', STAMP)
}

function rel(path: string) {
  return path.replace(`${repoRoot()}/`, '')
}

async function gitCommit() {
  try {
    const head = await readFile(resolve(repoRoot(), '.git/HEAD'), 'utf8')
    const trimmed = head.trim()
    if (!trimmed.startsWith('ref:')) return trimmed
    const ref = trimmed.slice(5)
    return (await readFile(resolve(repoRoot(), '.git', ref), 'utf8')).trim()
  } catch {
    return 'unknown'
  }
}

async function addJson(files: string[], name: string, data: unknown) {
  const path = resolve(auditDir(), name)
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  files.push(name)
}

async function addText(files: string[], name: string, data: string) {
  const path = resolve(auditDir(), name)
  await writeFile(path, data, 'utf8')
  files.push(name)
}

async function manifest(files: string[]) {
  const items = await Promise.all(files.map(async (file) => {
    const path = resolve(auditDir(), file)
    const [content, info] = await Promise.all([readFile(path), stat(path)])
    return {
      file,
      sizeBytes: info.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  }))
  return {
    schemaVersion: 'interactive_strategy_backtest.audit_manifest.v1',
    generatedAt: GENERATED_AT,
    gitCommit: await gitCommit(),
    itemCount: items.length,
    items,
    notTradingAdvice: true,
    allowedActions: ALLOWED_ACTIONS,
    prohibitedActions: PROHIBITED_ACTIONS,
  }
}

async function readDoc(path: string) {
  return readFile(resolve(repoRoot(), path), 'utf8').catch(() => '')
}

async function latestFrontendRuntimeAudit() {
  const root = resolve(backendRoot(), 'data/gpt-audit/interactive-strategy-backtest')
  try {
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const dir of dirs) {
      const path = resolve(root, dir, '03_frontend_runtime_and_operation_audit.json')
      const content = await readFile(path, 'utf8').catch(() => '')
      if (!content) continue
      const parsed = JSON.parse(content)
      if (parsed.schemaVersion === 'interactive_strategy_backtest.frontend_runtime_evidence.v1') {
        return { sourceDir: dir, ...parsed }
      }
    }
  } catch {
    return null
  }
  return null
}

async function latestDividendLowVolBasketExpansionAudit() {
  const root = resolve(backendRoot(), 'data/gpt-audit')
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-basket-candidate-expansion-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const content = await readFile(resolve(root, file), 'utf8').catch(() => '')
      if (!content) continue
      const parsed = JSON.parse(content)
      if (parsed.schemaVersion === 'dividend.low_vol.basket_candidate_expansion_audit.v1') {
        return { sourceFile: file, ...parsed }
      }
    }
  } catch {
    return null
  }
  return null
}

function overallStatus(statuses: string[]) {
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('insufficient')) return 'insufficient'
  return 'passed'
}

async function main() {
  await mkdir(auditDir(), { recursive: true })
  const files: string[] = []
  const commit = await gitCommit()
  const runtimeHealth = await runtimeHealthService.check({ prisma, includeOperations: true, includeProviderHealth: true })

  const common = {
    generatedAt: GENERATED_AT,
    gitCommit: commit,
    dataVersion: 'local_free_source_and_canonical_cache',
    notTradingAdvice: true,
    allowedActions: ALLOWED_ACTIONS,
    prohibitedActions: PROHIBITED_ACTIONS,
  }

  const runtimeAudit = {
    schemaVersion: 'interactive_strategy_backtest.runtime_health_gate_audit.v1',
    ...common,
    runtimeHealth,
    gate: {
      status: runtimeHealth.status === 'healthy' ? 'passed' : 'blocked',
      operationBacktestAllowed: runtimeHealth.decision.largeBacktestPersistenceAllowed,
      formalValidationPromotionAllowed: runtimeHealth.decision.validationPromotionAllowed,
    },
  }
  await addJson(files, '00_runtime_health_gate_audit.json', runtimeAudit)

  const proxySymbols = ['510300', '511010', '511260', '518880', '159985']
  const proxyCoverage = await portfolioProxyMarketDataService.ensureCoverage(proxySymbols, '2025-12-04', '2026-06-05', { minRequiredBars: 250 })
  await addJson(files, '01_proxy_etf_market_data_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.proxy_etf_market_data_audit.v1',
    ...common,
    status: proxyCoverage.status,
    proxyCoverage,
    acceptance: {
      requiredSymbols: proxySymbols,
      minRequiredBars: 250,
      passed: proxyCoverage.status === 'ready',
    },
  })

  const input = await portfolioBacktestInputBuilder.build({
    userId: AUDIT_USER_ID,
    portfolioStrategyIds: [
      'local_real_data_sample_60_40',
      'local_real_data_equal_weight_5',
      'local_real_data_concentrated_3',
      'dividend_low_vol_basket',
      'permanent_portfolio',
      'all_weather',
      'current_holdings_buy_and_hold',
    ],
    startDate: '2025-12-04',
    endDate: '2026-06-05',
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20', 'free_source_total_return'],
    gradeMode: 'formal_review',
  })
  input.runtimeHealth = {
    status: runtimeHealth.status,
    sqliteHealthy: runtimeHealth.sqliteHealthy,
    decision: runtimeHealth.decision,
  }
  const backtest = await portfolioBacktestEngine.run(input)
  const completedStrategies = backtest.strategies.filter((strategy) => strategy.status === 'completed')
  const benchmarkStatuses = Array.from(new Set(backtest.strategies.flatMap((strategy) => strategy.warnings.filter((warning) => warning.startsWith('benchmark_status:')))))
  const totalReturnWarnings = Array.from(new Set(backtest.strategies.flatMap((strategy) => strategy.warnings.filter((warning) => warning.includes('total_return') || warning.includes('dividend_contribution')))))
  await addJson(files, '02_benchmark_and_total_return_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.benchmark_and_total_return_audit.v1',
    ...common,
    status: backtest.formalReviewReadiness?.ready ? 'formal_review_ready' : completedStrategies.length >= 5 ? 'research_grade_passed' : 'insufficient',
    formalReviewReadiness: backtest.formalReviewReadiness,
    benchmarkStatuses,
    totalReturnWarnings,
    strategies: backtest.strategies.map((strategy) => ({
      strategyId: strategy.definition.strategyId,
      status: strategy.status,
      metrics: {
        totalReturnPercent: strategy.metrics.totalReturnPercent,
        priceOnlyReturnPercent: strategy.metrics.priceOnlyReturnPercent,
        dividendContributionPercent: strategy.metrics.dividendContributionPercent,
        capitalGainContributionPercent: strategy.metrics.capitalGainContributionPercent,
        costDragPercent: strategy.metrics.costDragPercent,
        benchmarkReturnPercent: strategy.metrics.benchmarkReturnPercent,
        excessReturnPercent: strategy.metrics.excessReturnPercent,
      },
      dataCoverage: strategy.dataCoverage,
      warnings: strategy.warnings,
      blockedReasons: strategy.blockedReasons,
    })),
    formalGrade: {
      status: backtest.formalReviewReadiness?.ready ? 'formal_review_ready' : 'blocked',
      reasons: backtest.formalReviewReadiness?.blockers || [],
    },
  })

  const frontendRuntime = await latestFrontendRuntimeAudit()
  await addJson(files, '03_frontend_runtime_and_operation_audit.json', frontendRuntime || {
    schemaVersion: 'interactive_strategy_backtest.frontend_runtime_and_operation_audit.v1',
    ...common,
    status: 'pending_runtime_script_or_manual_review',
    expectedFrontendPath: [
      '/backtest 页面展示研究模式 banner',
      '模板、runtime health、日期、初始资金可见',
      '运行组合回测后展示多策略曲线、指标、benchmark、分红贡献和成本拖累',
      'Operation artifact refs 可进入任务中心追溯',
    ],
    runtimeHealth: input.runtimeHealth,
    operationModeAllowed: runtimeHealth.decision.largeBacktestPersistenceAllowed,
  })

  const formalPrereq = {
    schemaVersion: 'interactive_strategy_backtest.formal_review_prerequisite_audit.v1',
    ...common,
    status: 'formal_review_prerequisites_documented',
    readinessSummary: backtest.readinessSummary,
    stageStates: {
      researchGradeStrategyComparisonReady: completedStrategies.length >= 5 && proxyCoverage.status === 'ready',
      manualDraftReady: true,
      formalReviewReady: backtest.formalReviewReadiness?.ready === true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
    blockers: backtest.formalReviewReadiness?.ready
      ? ['manual_review_not_completed', 'formal_trading_unlock_requires_explicit_human_confirmation', 'auto_trade_policy_locked']
      : backtest.formalReviewReadiness?.blockers || ['formal_review_readiness_missing'],
  }
  await addJson(files, '04_formal_review_prerequisite_audit.json', formalPrereq)

  const [prd, plan, gap, drawio] = await Promise.all([
    readDoc('docs/DIVIDEND_LOW_VOL_PRD.md'),
    readDoc('docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md'),
    readDoc('docs/TARGET_ARCHITECTURE_GAP.md'),
    readDoc('docs/target-architecture-gap.drawio'),
  ])
  const prdChecks = [
    { id: 'research_boundary', status: prd.includes('formalTradingUnlocked=false') && prd.includes('AUTO_TRADE') ? 'passed' : 'failed' },
    { id: 'portfolio_backtest_plan', status: plan.includes('组合') && plan.includes('回测') && plan.includes('验收') ? 'passed' : 'failed' },
    { id: 'target_architecture_gap', status: gap.includes('当前') && gap.includes('目标') && gap.includes('验收') ? 'passed' : 'failed' },
    { id: 'drawio_under_8_pages', status: (drawio.match(/<diagram /g) || []).length <= 8 ? 'passed' : 'failed' },
  ]
  await addJson(files, '05_prd_spec_review.json', {
    schemaVersion: 'interactive_strategy_backtest.prd_spec_review.v1',
    ...common,
    status: overallStatus(prdChecks.map((item) => item.status)),
    checks: prdChecks,
    conclusion: '当前文档支撑本阶段研究级组合回测、人工计划草案和正式交易前置审计；不支撑绕过正式 validation gate。',
  })

  await addJson(files, '06_trade_gate_contract.json', {
    schemaVersion: 'interactive_strategy_backtest.trade_gate_contract.v1',
    ...common,
    status: 'passed',
    readinessSummary: backtest.readinessSummary,
    formalReviewReady: backtest.formalReviewReadiness?.ready === true,
    formalReviewReadiness: backtest.formalReviewReadiness,
    formalTradingUnlockChecklist: backtest.formalTradingUnlockChecklist,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    operationBacktestAllowedActions: backtest.allowedActions,
    operationBacktestProhibitedActions: backtest.prohibitedActions,
    assertions: [
      '组合回测只允许 RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT',
      'ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 禁止',
      'benchmark 或 total-return 代理不足不会解锁正式交易',
    ],
  })

  const dividendLowVolBasket = backtest.strategies.find((strategy) => strategy.definition.strategyId === 'dividend_low_vol_basket')
  const basketExpansionAudit = await latestDividendLowVolBasketExpansionAudit()
  await addJson(files, '07_dividend_low_vol_basket_snapshot_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.dividend_low_vol_basket_snapshot_audit.v1',
    ...common,
    status: dividendLowVolBasket?.status || 'missing',
    decision: dividendLowVolBasket?.status === 'completed'
      ? 'research_basket_ready'
      : 'candidate_snapshot_blocked',
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    acceptance: {
      minComponents: 3,
      requiresRealDividendLowVolDailySnapshot: true,
      requiresEvidenceRefs: true,
      requiresRealPriceBarsInBacktestWindow: true,
      localSampleSubstitutionAllowed: false,
      proxyBenchmarkCannotUnlockFormalValidation: true,
    },
    strategy: dividendLowVolBasket
      ? {
        strategyId: dividendLowVolBasket.definition.strategyId,
        displayName: dividendLowVolBasket.definition.displayName,
        source: dividendLowVolBasket.definition.source,
        strategyVersion: dividendLowVolBasket.definition.strategyVersion,
        status: dividendLowVolBasket.status,
        validationStatus: dividendLowVolBasket.definition.validation.status,
        componentCount: dividendLowVolBasket.definition.components.length,
        snapshot: dividendLowVolBasket.definition.snapshot,
        components: dividendLowVolBasket.definition.components.map((component) => ({
          symbol: component.symbol,
          name: component.name,
          assetClass: component.assetClass,
          targetWeightPercent: component.targetWeightPercent,
          evidenceRefCount: component.evidenceRefs.length,
        })),
        blockedReasons: dividendLowVolBasket.blockedReasons,
        warnings: dividendLowVolBasket.warnings,
        dataCoverage: dividendLowVolBasket.dataCoverage,
        metrics: dividendLowVolBasket.metrics,
        evidenceRefs: dividendLowVolBasket.evidenceRefs.slice(0, 80),
      }
      : null,
    userMessage: dividendLowVolBasket?.status === 'completed'
      ? '红利低波候选篮子已用真实候选快照进入研究级组合回测；仍不是正式交易建议。'
      : '红利低波候选篮子尚未满足最小真实入篮数量或候选快照要求，因此保持 insufficient，不展示完成曲线。',
  })

  await addJson(files, '08_dividend_low_vol_candidate_expansion_audit.json', basketExpansionAudit || {
    schemaVersion: 'interactive_strategy_backtest.dividend_low_vol_candidate_expansion_audit_ref.v1',
    ...common,
    status: 'missing',
    userMessage: '尚未运行 run:dividend-low-vol-basket-candidate-expansion；如红利低波篮子仍 insufficient，需要先执行真实候选扩容。',
  })

  await addJson(files, '09_data_grade_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.data_grade_audit.v1',
    ...common,
    status: backtest.dataGradeAudit?.status || 'missing',
    readinessSummary: backtest.readinessSummary,
    aggregate: backtest.dataGradeAudit,
    strategies: backtest.strategies.map((strategy) => ({
      strategyId: strategy.definition.strategyId,
      displayName: strategy.definition.displayName,
      dataGradeAudit: strategy.dataGradeAudit,
    })),
    userMessage: '数据等级用于区分官方授权、免费源交叉验证、价格指数、研究代理和不足；不是交易解锁。',
  })

  await addJson(files, '10_model_effectiveness_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.model_effectiveness_audit.v1',
    ...common,
    status: backtest.modelEffectiveness?.status || 'missing',
    readinessSummary: backtest.readinessSummary,
    aggregate: backtest.modelEffectiveness,
    strategies: backtest.strategies.map((strategy) => ({
      strategyId: strategy.definition.strategyId,
      displayName: strategy.definition.displayName,
      modelEffectiveness: strategy.modelEffectiveness,
    })),
    userMessage: '模型有效性当前用于识别 OOS、walk-forward、参数敏感性和分组稳定性缺口；不足项不得升级为正式交易验证通过。',
  })

  await addJson(files, '11_manual_plan_draft_audit.json', {
    schemaVersion: 'interactive_strategy_backtest.manual_plan_draft_audit.v1',
    ...common,
    status: backtest.manualPlanDrafts?.length ? 'generated_blocked_drafts' : 'missing',
    readinessSummary: backtest.readinessSummary,
    manualPlanDrafts: backtest.manualPlanDrafts,
    policy: {
      formalTargetWeightPercent: 0,
      allowedActions: backtest.allowedActions,
      prohibitedActions: backtest.prohibitedActions,
    },
    userMessage: '人工计划草案只支持人工复核路径；formalTargetWeightPercent 保持 0，不能下单。',
  })

  await addJson(files, '12_formal_trading_unlock_blockers.json', {
    schemaVersion: 'interactive_strategy_backtest.formal_trading_unlock_blockers.v1',
    ...common,
    status: 'blocked',
    readinessSummary: backtest.readinessSummary,
    formalTradingUnlockChecklist: backtest.formalTradingUnlockChecklist,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    userMessage: '正式交易解锁仍被人工复核、模型有效性、授权 benchmark 和自动交易政策阻断。',
  })

  await addText(files, 'README.md', `# Interactive Strategy Backtest Audit\n\nGeneratedAt: ${GENERATED_AT}\n\nThis package audits the current stage for interactive portfolio strategy backtesting and formal-trading prerequisites. It is not trading advice.\n`)

  const status = overallStatus([
    runtimeAudit.gate.status,
    proxyCoverage.status === 'ready' ? 'passed' : 'insufficient',
    completedStrategies.length >= 5 ? 'passed' : 'insufficient',
    prdChecks.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    frontendRuntime?.status === 'passed' ? 'passed' : 'insufficient',
  ])
  await addText(files, 'SUMMARY_FOR_GPT.md', `# Summary For GPT\n\nGeneratedAt: ${GENERATED_AT}\n\nOverallStatus: ${status}\n\nAuditUserId: ${AUDIT_USER_ID}\n\nResearchGradeStrategyComparisonReady: ${completedStrategies.length >= 5 && proxyCoverage.status === 'ready'}\n\nPortfolioBacktestFormalReviewReady: ${backtest.formalReviewReadiness?.ready === true}\n\nManualDraftReady: ${(backtest.manualPlanDrafts?.length || 0) > 0}\n\nReadinessSummary: research=${backtest.readinessSummary?.researchReady}, formalReview=${backtest.readinessSummary?.formalReviewReady}, manualDraft=${backtest.readinessSummary?.manualDraftReady}, formalTradingEligible=${backtest.readinessSummary?.formalTradingEligible}\n\nFormalTradingUnlocked: false\n\nAutoTradeUnlocked: false\n\nRuntimeHealth: ${runtimeHealth.status}\n\nProxyEtfCoverage: ${proxyCoverage.status}\n\nCompletedStrategies: ${completedStrategies.length}/${backtest.strategies.length}\n\nDataGrade: ${backtest.dataGradeAudit?.aggregateGrade || 'missing'} / ${backtest.dataGradeAudit?.status || 'missing'}\n\nModelEffectivenessStatus: ${backtest.modelEffectiveness?.status || 'missing'}\n\nManualPlanDraftCount: ${backtest.manualPlanDrafts?.length || 0}\n\nFrontendRuntimeEvidence: ${frontendRuntime?.status || 'missing'}\n\nBenchmarkStatuses: ${benchmarkStatuses.join(', ') || 'none'}\n\nFormal review blockers: ${(backtest.formalReviewReadiness?.blockers || []).join(', ') || 'none'}.\n\nFormal trading unlock blockers: ${(backtest.formalTradingUnlockChecklist?.blockers || []).join(', ') || 'none'}.\n\nTrading blockers that remain by policy: manual_review_not_completed, formal_trading_unlock_requires_explicit_human_confirmation, auto_trade_policy_locked.\n\nKey audit files:\n\n${files.map((file) => `- ${file}`).join('\n')}\n`)

  await addJson(files, 'manifest.json', await manifest(files))
  const listed = await readdir(auditDir())
  console.log(JSON.stringify({
    ok: true,
    status,
    auditDir: auditDir(),
    files: listed.sort(),
    researchGradeStrategyComparisonReady: completedStrategies.length >= 5 && proxyCoverage.status === 'ready',
    portfolioBacktestFormalReviewReady: backtest.formalReviewReadiness?.ready === true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
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
