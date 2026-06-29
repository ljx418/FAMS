import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const generatedAt = new Date().toISOString()

async function latestV2Artifact() {
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  const files = await readdir(auditDir).catch(() => [])
  const fileName = files
    .filter((file) => file.startsWith('dividend-low-vol-v2-research-validation-') && file.endsWith('.json'))
    .sort()
    .at(-1)
  if (!fileName) return null
  const payload = JSON.parse(await readFile(resolve(auditDir, fileName), 'utf8'))
  return { fileName, payload }
}

async function main() {
  const pagePath = resolve(repoRoot, 'frontend/src/pages/DividendLowVol.tsx')
  const servicePath = resolve(repoRoot, 'frontend/src/services/analysisService.ts')
  const layoutPath = resolve(repoRoot, 'frontend/src/components/layout/AppLayout.tsx')
  const appPath = resolve(repoRoot, 'frontend/src/App.tsx')
  const strategyRoutePath = resolve(process.cwd(), 'src/routes/strategy.ts')

  const [pageSource, serviceSource, layoutSource, appSource, strategyRouteSource, v2Artifact] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(servicePath, 'utf8'),
    readFile(layoutPath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(strategyRoutePath, 'utf8'),
    latestV2Artifact(),
  ])

  const checks = {
    defaultAllALimit6000: /const\s+DEFAULT_ALL_A_LIMIT\s*=\s*6000/.test(pageSource),
    pageUsesPersistedOnlyAllScope: /getDividendLowVolCandidates\('',\s*scanLimit,\s*\{\s*scope:\s*'all',\s*persistedOnly:\s*true\s*\}\)/.test(pageSource),
    pageLoadsV2ResearchValidation: pageSource.includes('getDividendLowVolV2ResearchValidation()'),
    pageLoadsManualDraftReadiness: pageSource.includes('getDividendLowVolManualDraftReadiness()'),
    pageLoadsManualTradeDraft: pageSource.includes('getDividendLowVolManualTradeDraft(3)'),
    pageLoadsManualWatchlist: pageSource.includes('getDividendLowVolManualWatchlist()'),
    pageLoadsManualWorkflowAudit: pageSource.includes('getDividendLowVolManualWorkflowAudit()'),
    pageCreatesManualTradeDraft: pageSource.includes('createDividendLowVolManualTradeDraft(selectedSymbols.length') && pageSource.includes('使用锁定 Top 3'),
    pageUsesCurrentFilteredTop3ForDraft: pageSource.includes('draftTopCandidates.map((candidate) => candidate.identity.symbol)') && pageSource.includes("selectionSource: 'current_filter_top3'"),
    pageLocksActiveTop3Selection: pageSource.includes('activeTop3Selection') && pageSource.includes('lockCurrentTop3Selection') && pageSource.includes('已锁定'),
    pageUsesSameTop3ForTradingZones: pageSource.includes('const selectedSymbols = getActiveSelectionSymbols()') && pageSource.includes('getDividendLowVolTradingZones(selectedSymbols'),
    pageUsesSameTop3ForRollingBacktest: pageSource.includes('runDividendLowVolRollingBacktest(selectedSymbols') && pageSource.includes('Top3 3 年滚动回测'),
    pageShowsTop3InputScope: pageSource.includes('本次区间/滚动回测输入标的') && pageSource.includes('本次工作台输入'),
    pageShowsFiveStepWorkbench: pageSource.includes('红利低波 5 步工作台')
      && pageSource.includes('1. 加载候选池')
      && pageSource.includes('2. 锁定 Top 3')
      && pageSource.includes('3. 查看买卖区间')
      && pageSource.includes('4. 运行滚动回测')
      && pageSource.includes('5. 生成观察草案'),
    pageUsesPartialLoadingFallback: pageSource.includes('Promise.allSettled') && pageSource.includes('部分诊断卡片加载失败，候选池仍可使用'),
    serviceCanCreateDraftWithSelectedSymbols: serviceSource.includes('selectedSymbols?: string[]') && serviceSource.includes('selectionSource?: string') && serviceSource.includes('filterSnapshot?: Record<string, unknown>'),
    pageReviewsManualTradeDraft: pageSource.includes('reviewDividendLowVolManualTradeDraft') && pageSource.includes('批准进入观察') && pageSource.includes('需要补数据') && pageSource.includes('拒绝草案'),
    pageShowsManualWatchlist: pageSource.includes('人工观察清单') && pageSource.includes('观察清单不是正式交易清单'),
    pageCreatesManualPretradeCheck: pageSource.includes('createDividendLowVolManualPretradeCheck') && pageSource.includes('生成执行前检查单') && pageSource.includes('执行前人工检查单'),
    pageReviewsManualPretradeCheck: pageSource.includes('reviewDividendLowVolManualPretradeCheck') && pageSource.includes('继续观察') && pageSource.includes('仍需复核') && pageSource.includes('拒绝执行') && !pageSource.includes('批准执行'),
    pageShowsManualWorkflowAudit: pageSource.includes('人工路径审计链') && pageSource.includes('complete_observation_workflow'),
    pageShowsManualAcceptanceReview: pageSource.includes('人工验收回看') && pageSource.includes('getDividendLowVolManualAcceptanceReview'),
    pageLoadsManualAcceptanceDecision: pageSource.includes('getDividendLowVolManualAcceptanceDecision') && pageSource.includes('setManualAcceptanceDecision'),
    pageCanDecideManualAcceptance: pageSource.includes('decideDividendLowVolManualAcceptance') && pageSource.includes('验收通过') && pageSource.includes('继续复核') && pageSource.includes('拒绝验收'),
    pageShowsValidationGapDiagnostics: pageSource.includes('getDividendLowVolValidationGapDiagnostics') && pageSource.includes('验证缺口') && pageSource.includes('验证缺口诊断'),
    pageShowsTradingZoneCard: pageSource.includes('买入/卖出观察区间与滚动策略') && pageSource.includes('tradingZoneRows') && pageSource.includes('tradingZoneColumns'),
    pageShowsDecisionSummary: pageSource.includes('今日策略状态')
      && pageSource.includes('候选池研究可用')
      && pageSource.includes('全局底座')
      && pageSource.includes('正式交易锁定'),
    pageShowsDataTrust: pageSource.includes('dataTrust') && pageSource.includes('数据可信') && pageSource.includes('displayLabel'),
    pageShowsCalculationReplay: pageSource.includes('calculationAudit') && pageSource.includes('复算') && pageSource.includes('formulaVersion'),
    pageRenamesCompletenessToDisplayCompleteness: pageSource.includes('展示字段齐全') && !pageSource.includes('完整率 {formatScore(pool.metricCompletenessSummary.completenessPercent)}%'),
    pageHidesDataReadinessDebugInCollapse: pageSource.includes('展开数据来源、provider 升级项与恢复命令') && pageSource.includes('data-readiness-detail'),
    pageLoadsTradingZonesFromPersistedPool: pageSource.includes('getDividendLowVolTradingZones') && pageSource.includes('persistedOnly: true'),
    pageRunsRollingBacktest: pageSource.includes('runDividendLowVolRollingBacktest') && pageSource.includes('滚动回测'),
    pageShowsV2ResearchCard: pageSource.includes('V2 研究验证诊断'),
    pageShowsManualDraftGate: pageSource.includes('人工交易计划草案 Gate') && pageSource.includes('草案复核'),
    pageShowsManualDraftTop3: pageSource.includes('本次 Top 3 人工草案') && pageSource.includes('suggestedDraftWeightPercent'),
    pageKeepsResearchOnlyWarning: pageSource.includes('不构成交易指令') && pageSource.includes('AUTO_TRADE'),
    scanButtonUsesQueuedOperation: pageSource.includes("executionMode: 'queued'"),
    serviceExposesV2Endpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/v2/research-validation'),
    serviceExposesManualDraftEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-draft-readiness'),
    serviceExposesManualTradeDraftEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-trade-draft'),
    serviceExposesManualWatchlistEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-watchlist'),
    serviceExposesManualPretradeCheckEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check'),
    serviceExposesManualPretradeReviewEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check/review'),
    serviceExposesManualWorkflowAuditEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-workflow-audit'),
    serviceExposesManualAcceptanceReviewEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-acceptance-review'),
    serviceExposesManualAcceptanceDecisionEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-acceptance-decision'),
    serviceCanPersistManualAcceptanceDecision: serviceSource.includes('decideDividendLowVolManualAcceptance') && serviceSource.includes('/api/v1/strategy/dividend-low-vol/manual-acceptance-review/decision') && serviceSource.includes("method: 'POST'"),
    serviceExposesValidationGapDiagnosticsEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/validation-gap-diagnostics'),
    serviceExposesTradingZoneEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/trading-zones') && serviceSource.includes('persistedOnly'),
    servicePassesSymbolsForPersistedTradingZones: serviceSource.includes("{ persistedOnly: true, symbols: symbols.join(',')"),
    serviceExposesRollingBacktestEndpoint: serviceSource.includes('/api/v1/strategy/dividend-low-vol/rolling-backtest'),
    serviceCanPersistManualTradeDraft: serviceSource.includes('createDividendLowVolManualTradeDraft') && serviceSource.includes("method: 'POST'"),
    serviceCanReviewManualTradeDraft: serviceSource.includes('reviewDividendLowVolManualTradeDraft') && serviceSource.includes('/review') && serviceSource.includes("method: 'POST'"),
    leftMenuHasIndependentEntry: layoutSource.includes("key: 'dividend-low-vol'") && layoutSource.includes('红利低波策略'),
    appRouteHasIndependentPage: appSource.includes('path="dividend-low-vol"') && appSource.includes('<DividendLowVol />'),
    backendFiltersPersistedTradingZonesBySymbols: strategyRouteSource.includes('requestedSymbolSet') && strategyRouteSource.includes('pool.candidates.filter'),
    v2ArtifactResearchOnly: Boolean(
      v2Artifact
        && v2Artifact.payload?.validationDecision?.usableForTradingAdvice === false
        && Array.isArray(v2Artifact.payload?.validationDecision?.prohibitedActions)
        && v2Artifact.payload.validationDecision.prohibitedActions.includes('ADD')
        && v2Artifact.payload.validationDecision.prohibitedActions.includes('REDUCE')
        && v2Artifact.payload.validationDecision.prohibitedActions.includes('AUTO_TRADE'),
    ),
  }

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `Dividend Low Vol frontend runtime contract failed: ${name}`)
  }

  const audit = {
    schemaVersion: 'dividend.low_vol.frontend_runtime_contract.v1',
    generatedAt,
    strategyId: 'dividend_low_vol_leader_v1',
    status: 'passed',
    checks,
    frontend: {
      pagePath,
      servicePath,
      route: '/dividend-low-vol',
      defaultLoadMode: 'persisted_all_latest_by_symbol',
      defaultLimit: 6000,
      rebuildRequiresExplicitQueuedScan: true,
    },
    v2ResearchValidation: {
      artifactFileName: v2Artifact?.fileName || null,
      status: v2Artifact?.payload?.status || 'missing',
      v2ResearchCandidates: v2Artifact?.payload?.latestPool?.v2ResearchCandidates || null,
      usableForTradingAdvice: v2Artifact?.payload?.validationDecision?.usableForTradingAdvice ?? false,
      prohibitedActions: v2Artifact?.payload?.validationDecision?.prohibitedActions || ['ADD', 'REDUCE', 'AUTO_TRADE'],
    },
    policy: {
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      notTradingAdvice: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
    },
  }

  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, `dividend-low-vol-frontend-runtime-contract-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(auditPath, JSON.stringify(audit, null, 2))

  console.log(JSON.stringify({
    ok: true,
    auditPath,
    checks,
    v2ResearchValidation: audit.v2ResearchValidation,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
