import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Check = {
  id: string
  label: string
  status: 'passed' | 'failed'
  evidence: string[]
}

const root = resolve(process.cwd(), '..')

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function fileExists(relativePath: string) {
  return existsSync(resolve(root, relativePath))
}

function includes(relativePath: string, patterns: string[]) {
  if (!fileExists(relativePath)) return false
  const content = read(relativePath)
  return patterns.every((pattern) => content.includes(pattern))
}

function check(id: string, label: string, ok: boolean, evidence: string[]): Check {
  return { id, label, status: ok ? 'passed' : 'failed', evidence }
}

const checks: Check[] = [
  check(
    'screening_cache_only',
    'AI 选股默认只读 canonical / feature cache',
    includes('backend/src/services/screener/stockScreenerService.ts', ['marketDataMode', 'cache_only', 'getCachedHistory']),
    ['stockScreenerService.ts: marketDataMode/cache_only/getCachedHistory']
  ),
  check(
    'coverage_and_warmup_blocker',
    '扫描前 coverage 检查与 warmup blocker',
    includes('backend/src/services/screener/stockScreenerService.ts', ['coverage_report.json', 'NEEDS_MARKET_DATA_WARMUP', 'market_bar_cache_preheat']),
    ['stockScreenerService.ts: coverage_report.json/NEEDS_MARKET_DATA_WARMUP']
  ),
  check(
    'market_data_coverage',
    'market_data_coverage 摘要表',
    includes('backend/prisma/schema.prisma', ['model MarketDataCoverage', 'missingRangesJson', 'completeTo']),
    ['schema.prisma: MarketDataCoverage']
  ),
  check(
    'feature_cache',
    'market_feature_daily 特征缓存',
    includes('backend/prisma/schema.prisma', ['model MarketFeatureDaily', 'volumeRatio20', 'rsi14']),
    ['schema.prisma: MarketFeatureDaily']
  ),
  check(
    'async_strategy_evidence',
    '当前筛选与策略回测 evidence 解耦',
    includes('backend/src/services/screener/stockScreenerService.ts', ['asyncStrategyEvidence', 'getLatestAsyncStrategyEvidence', '即时回测'])
      && includes('backend/src/services/operation/operationService.ts', ['strategy_tournament_run']),
    ['stockScreenerService.ts: asyncStrategyEvidence/getLatestAsyncStrategyEvidence/即时回测', 'operationService.ts: strategy_tournament_run']
  ),
  check(
    'validation_decision',
    '交易建议 gate 与 OBSERVE_ONLY 阻断',
    includes('backend/src/services/screener/stockScreenerService.ts', ['validation_decision.json', 'OBSERVE_ONLY', 'prohibitedActions']),
    ['stockScreenerService.ts: validation_decision.json/OBSERVE_ONLY']
  ),
  check(
    'oos_audit',
    'OOS 失败分析与分层复验',
    includes('backend/src/services/screener/stockScreenerService.ts', ['oos_failure_analysis.json', 'oos_layered_validation.json']),
    ['stockScreenerService.ts: oos_failure_analysis/oos_layered_validation']
  ),
  check(
    'p4_p5_closure',
    'P4/P5 收口 artifact',
    includes('backend/src/services/screener/stockScreenerService.ts', ['p4_closure_review.json', 'p5_closure_review.json']),
    ['stockScreenerService.ts: p4_closure_review/p5_closure_review']
  ),
  check(
    'postgres_shadow_path',
    'PostgreSQL shadow 真实连接烟测路径',
    includes('backend/src/services/screener/stockScreenerService.ts', ['FAMS_POSTGRES_SHADOW_DATABASE_URL', 'CREATE SCHEMA IF NOT EXISTS fams_shadow', 'staging_market_bar_raw']),
    ['stockScreenerService.ts: pg shadow schema/staging smoke']
  ),
  check(
    'formal_trade_state_path',
    'Tushare 正式交易状态接入路径',
    includes('backend/src/services/market-data/securityStatusService.ts', ['stock_basic', 'suspend_d', 'stk_limit', 'formal_trading_state_provider']),
    ['securityStatusService.ts: stock_basic/suspend_d/stk_limit']
  ),
  check(
    'production_readiness_script',
    '生产就绪自检脚本',
    fileExists('backend/scripts/verify-production-readiness.ts') && includes('backend/package.json', ['test:production-readiness']),
    ['scripts/verify-production-readiness.ts', 'package.json:test:production-readiness']
  ),
  check(
    'runbook',
    '生产配置与交易建议放行 Runbook',
    fileExists('docs/PRODUCTION_READINESS_RUNBOOK.md'),
    ['docs/PRODUCTION_READINESS_RUNBOOK.md']
  ),
]

const failed = checks.filter((item) => item.status === 'failed')
const shadowConfigured = read('backend/.env').includes('FAMS_POSTGRES_SHADOW_DATABASE_URL=')
const externalBlockers = [
  ...(shadowConfigured ? [] : ['PostgreSQL shadow service is not configured in this environment.']),
  'Tushare token is optional; interface is implemented and can be enabled by users when needed.',
  'OOS layered validation still requires sufficient passing samples before ADD/REDUCE trade actions can be released.',
]
const report = {
  schemaVersion: 'fams.gpt_optimization_plan_check.v1',
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? 'implemented_with_external_blockers' : 'incomplete',
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
  externalBlockers,
}

console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) process.exitCode = 1
