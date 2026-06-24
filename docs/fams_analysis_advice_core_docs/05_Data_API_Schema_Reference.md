# 数据、API 与 Schema 参考

版本：v0.2  
日期：2026-06-02

---

# 1. 数据表

## 1.1 valuation_runs

```sql
CREATE TABLE valuation_runs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  position_id TEXT,
  portfolio_id TEXT,
  model_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  valuation_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 1.2 valuation_factsets

```sql
CREATE TABLE valuation_factsets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  factset_schema_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  missing_data_json TEXT NOT NULL,
  conflict_flags_json TEXT NOT NULL,
  blocked_reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 1.3 valuation_scores

```sql
CREATE TABLE valuation_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  valuation_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  growth_score REAL NOT NULL,
  financial_risk_score REAL NOT NULL,
  timing_score REAL NOT NULL,
  portfolio_fit_score REAL NOT NULL,
  evidence_quality_score REAL NOT NULL,
  composite_score REAL NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 1.4 expected_return_distributions

```sql
CREATE TABLE expected_return_distributions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  horizon TEXT NOT NULL,
  expected_return_pct REAL,
  expected_pnl_amount REAL,
  probability_of_gain REAL,
  probability_of_loss REAL,
  probability_of_stop_loss REAL,
  probability_of_take_profit REAL,
  p05 REAL,
  p25 REAL,
  p50 REAL,
  p75 REAL,
  p95 REAL,
  expected_max_drawdown REAL,
  cvar5 REAL,
  method_json TEXT NOT NULL,
  sample_size INTEGER,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 1.5 trading_disciplines

```sql
CREATE TABLE trading_disciplines (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  discipline_type TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  review_cadence TEXT NOT NULL,
  max_allowed_weight REAL,
  target_weight_multiplier REAL NOT NULL,
  add_conditions_json TEXT NOT NULL,
  reduce_conditions_json TEXT NOT NULL,
  stop_conditions_json TEXT NOT NULL,
  take_profit_conditions_json TEXT NOT NULL,
  invalidation_conditions_json TEXT NOT NULL,
  human_confirmation_required INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

## 1.6 advice_replay_runs

```sql
CREATE TABLE advice_replay_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  review_frequency TEXT NOT NULL,
  initial_portfolio_mode TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
```

## 1.7 advice_replay_slices

```sql
CREATE TABLE advice_replay_slices (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  slice_start_date TEXT NOT NULL,
  slice_end_date TEXT NOT NULL,
  mode TEXT NOT NULL,
  initial_market_value REAL NOT NULL,
  final_market_value REAL,
  total_return REAL,
  benchmark_return REAL,
  buy_hold_return REAL,
  excess_return_vs_benchmark REAL,
  excess_return_vs_buy_hold REAL,
  max_drawdown REAL,
  trade_count INTEGER,
  turnover REAL,
  risk_budget_violation_count INTEGER,
  status TEXT NOT NULL
);
```

## 1.8 advice_decision_logs

```sql
CREATE TABLE advice_decision_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  slice_id TEXT NOT NULL,
  review_date TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  current_weight REAL,
  bucket TEXT,
  valuation_score REAL,
  quality_score REAL,
  growth_score REAL,
  financial_risk_score REAL,
  timing_score REAL,
  portfolio_fit_score REAL,
  evidence_quality_score REAL,
  expected_return_distribution_ref TEXT,
  model_action TEXT,
  allowed_action TEXT,
  blocked_reasons_json TEXT NOT NULL,
  discipline_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 1.9 simulated_trades

```sql
CREATE TABLE simulated_trades (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  slice_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  side TEXT NOT NULL,
  planned_weight_before REAL,
  planned_weight_after REAL,
  quantity REAL,
  price REAL,
  amount REAL,
  fee REAL,
  slippage REAL,
  reason TEXT,
  created_at TEXT NOT NULL
);
```

## 1.10 replay_portfolio_snapshots

```sql
CREATE TABLE replay_portfolio_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  slice_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  total_market_value REAL NOT NULL,
  cash_value REAL,
  cash_ratio REAL,
  positions_json TEXT NOT NULL,
  weekly_return REAL,
  drawdown REAL,
  benchmark_value REAL,
  buy_hold_value REAL,
  created_at TEXT NOT NULL
);
```

## 1.11 probability_calibration_results

```sql
CREATE TABLE probability_calibration_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  horizon TEXT NOT NULL,
  predicted_gain_bucket TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  predicted_avg_probability REAL,
  realized_gain_rate REAL,
  calibration_error REAL,
  p05_p95_coverage REAL,
  p25_p75_coverage REAL,
  created_at TEXT NOT NULL
);
```

## 1.12 intervention_events

```sql
CREATE TABLE intervention_events (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT,
  decision_id TEXT,
  intervention_type TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
```

## 1.13 valuation_model_versions

```sql
CREATE TABLE valuation_model_versions (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  params_json TEXT NOT NULL,
  training_window TEXT,
  validation_report_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  promoted_at TEXT
);
```

## 1.14 model_tuning_trials

```sql
CREATE TABLE model_tuning_trials (
  id TEXT PRIMARY KEY,
  base_model_version TEXT NOT NULL,
  candidate_model_version TEXT NOT NULL,
  params_json TEXT NOT NULL,
  objective_score REAL,
  return_score REAL,
  drawdown_score REAL,
  calibration_score REAL,
  risk_violation_score REAL,
  validation_report_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

# 2. API 参考

## 2.1 POST /api/v1/analysis/valuation/run

输入：

```json
{
  "assetId": "601127.SH",
  "positionId": "pos_xxx",
  "purpose": "holding_review",
  "modelVersion": "fivd-r-v1",
  "valuationDate": "2026-05-31"
}
```

输出：

```json
{
  "runId": "val_run_xxx",
  "status": "partial",
  "thesisType": "reduce_risk",
  "scores": {},
  "valuation": {},
  "expectedReturnDistribution": [],
  "tradingDiscipline": {},
  "positionAdviceImpact": {},
  "evidenceRefs": [],
  "blockedReasons": []
}
```

## 2.2 POST /api/v1/analysis/advice/refresh

输出 Operation：

```json
{
  "operationId": "op_analysis_advice_xxx",
  "status": "queued"
}
```

## 2.3 GET /api/v1/analysis/advice/:assetId

返回：

```text
latest valuation run
scores
expected return distribution
trading discipline
position advice impact
evidence gaps
AI explanation draft
```

## 2.4 POST /api/v1/analysis/replay/run

输入：

```json
{
  "modelVersion": "fivd-r-v1",
  "startMode": "fixed",
  "fixedStarts": ["3m", "2m", "1m"],
  "reviewFrequency": "weekly",
  "endDate": "2026-05-31",
  "benchmark": "CSI300",
  "modes": ["gate_strict", "research_only", "buy_hold", "benchmark"]
}
```

输出：

```json
{
  "operationId": "op_replay_xxx",
  "runId": "replay_xxx"
}
```

## 2.5 GET /api/v1/analysis/replay/:runId/report

返回：

```text
replay summary
portfolio curves
decision timeline
simulated trades
action quality
probability calibration
score effectiveness
risk budget report
```

---

# 3. Operation 类型

```text
valuation.run
valuation.batch_refresh
expected_return.compute
trading_discipline.generate
advice_replay.run
advice_replay.slice_run
probability_calibration.compute
model_tuning.trial
model_version.promote
```

---

# 4. Artifacts

## valuation.run

```text
valuation_output.json
evidence_gate_report.json
score_breakdown.json
expected_return_distribution.json
trading_discipline.json
```

## advice_replay.run

```text
replay_summary.json
slice_results.json
portfolio_curves.json
decision_timeline.json
simulated_trades.csv
action_quality_report.json
probability_calibration.json
score_effectiveness_report.json
risk_budget_report.json
model_comparison_report.json
```

---

# 5. FIVD-R 当前 API Addendum

2026-06-02 当前真实实现的 FIVD-R API：

```text
GET  /api/v1/analysis/fivd-r
GET  /api/v1/analysis/fivd-r/summary
POST /api/v1/analysis/fivd-r/refresh-operation
POST /api/v1/analysis/fivd-r/candidates
POST /api/v1/analysis/fivd-r/snapshots
GET  /api/v1/analysis/fivd-r/snapshots
POST /api/v1/analysis/fivd-r/watch
POST /api/v1/analysis/fivd-r/risk-alert
POST /api/v1/analysis/fivd-r/validation-retest
GET  /api/v1/analysis/fivd-r/validation-report/latest
POST /api/v1/analysis/fivd-r/infrastructure-audit
POST /api/v1/analysis/fivd-r/manual-trade-draft
```

## 5.1 通用 Capability 字段

FIVD-R 主输出应包含：

```ts
type FivdRCapabilityState =
  | "RESEARCH_READY"
  | "OBSERVE_ONLY"
  | "DATA_INSUFFICIENT"
  | "TRADE_BLOCKED"
  | "SYSTEM_UNAVAILABLE"

type FivdRCapabilityFlags = {
  capabilityState: FivdRCapabilityState
  researchAvailable: boolean
  observeAllowed: boolean
  formalTradeActionAllowed: boolean
  manualTradeDraftAllowed: boolean
  autoTradeAllowed: false
}
```

## 5.2 DataGap

```ts
type DataGap = {
  gapId: string
  assetId?: string
  symbol?: string
  assetName?: string
  assetType: "stock" | "etf" | "fund" | "bond_fund" | "gold" | "cash" | "unknown"
  severity: "blocking" | "degrading" | "optional"
  category:
    | "asset_identity"
    | "market_data"
    | "valuation"
    | "fundamental"
    | "financial_report"
    | "fund_factset"
    | "gold_macro"
    | "validation_evidence"
    | "tradeability"
    | "news_event"
    | "provider_health"
  blockedReason: string
  missingFields: string[]
  requiredFor: Array<"research" | "observe" | "manual_trade_draft" | "formal_trade_action">
  userMessage: string
  developerMessage: string
  suggestedAction: string
  providerCandidates: string[]
  lastAttemptAt?: string
  lastError?: string
  evidenceRefs: string[]
}
```

输出位置：

- `GET /api/v1/analysis/fivd-r`
- `GET /api/v1/analysis/fivd-r/summary`
- `GET /api/v1/analysis/holdings-research`
- `POST /api/v1/analysis/fivd-r/candidates`
- `POST /api/v1/analysis/fivd-r/manual-trade-draft`
- `POST /api/v1/analysis/fivd-r/validation-retest`

## 5.3 Candidate Score

```ts
type FivdRCandidateScore = {
  symbol: string
  name?: string
  rank: number
  totalScore: number
  signalScore: number
  researchScore: number
  evidenceAdjustedScore: number
  disposition:
    | "manual_review_eligible"
    | "watch_candidate"
    | "observe_only"
    | "needs_more_evidence"
    | "avoid"
    | "retire_candidate"
    | "trade_blocked"
    | "blocked"
  capabilityState: FivdRCapabilityState
  allowedActions: string[]
  prohibitedActions: Array<"ADD" | "REDUCE" | "AUTO_TRADE">
  blockers: string[]
  dataGapSummary: DataGap[]
  evidenceRefs: string[]
}
```

排序规则：

```text
evidenceAdjustedScore desc
signalScore desc
symbol asc
```

## 5.4 Validation Failure Taxonomy

```ts
type FivdRValidationFailureTaxonomy = {
  schemaVersion: "fivd.r.validation_failure_taxonomy.v1"
  generatedAt: string
  runId: string
  sourceOperationId?: string | null
  sourceOperationType?: string | null
  status: "blocked_for_trading" | "needs_more_samples" | "ready_for_manual_review"
  summary: {
    passedCandidates: number
    failedCandidates: number
    insufficientCandidates: number
    diagnosedCandidates: number
    tradeActionAllowed: false
    manualTradeDraftAllowed: false
    autoTradeAllowed: false
    blocker?: string | null
    oosWindows?: number
    failedWindows?: number
    insufficientWindows?: number
    regimeBuckets?: number
    insufficientRegimeBuckets?: number
  }
  failureCategories: Array<{
    category: string
    severity: "critical" | "major" | "minor"
    affectedStrategies: string[]
    affectedCandidates: string[]
    evidenceRefs: string[]
    explanation: string
    nextAction: string
  }>
  recommendation:
    | "keep_research_only"
    | "narrow_strategy_scope"
    | "retest_with_longer_window"
    | "retire_strategy"
    | "requires_new_strategy_family"
  prohibitedActions: Array<"ADD" | "REDUCE" | "AUTO_TRADE">
  allowedActions: string[]
  evidenceRefs: string[]
  nextActions: string[]
}
```

artifact：

```text
validation_failure_taxonomy.json
```

该 schema 只解释 validation evidence 失败原因，不放行交易动作。

## 5.5 Data Gap Remediation

新增 API：

```text
POST /api/v1/analysis/fivd-r/data-gap-remediation-plan
POST /api/v1/analysis/fivd-r/data-gap-remediation-operation
POST /api/v1/analysis/fivd-r/asset-identity-resolution
```

计划 schema：

```ts
type FivdRDataGapRemediationPlan = {
  schemaVersion: "fivd.r.data_gap_remediation_plan.v1"
  generatedAt: string
  sourceRunId?: string | null
  summary: {
    totalGaps: number
    executableActions: number
    plannedActions: number
    unsupportedActions: number
    blockedByValidationActions: number
  }
  actions: Array<{
    actionId: string
    status: "executable" | "planned" | "unsupported" | "blocked_by_validation"
    category: string
    gapIds: string[]
    symbols: string[]
    operationType?: "batch_factset_refresh" | "fivd_r_validation_retest_audit" | "fivd_r_asset_identity_resolution" | "market_bar_cache_preheat"
    operationInput?: Record<string, unknown>
    userMessage: string
    developerMessage: string
    expectedArtifacts: string[]
    limitations: string[]
  }>
  auditOpinion: {
    severity: "minor" | "major"
    conclusion: string
  }
}
```

执行 schema：

```ts
type FivdRDataGapRemediationExecution = {
  schemaVersion: "fivd.r.data_gap_remediation_execution.v1"
  generatedAt: string
  userId: string
  plan: FivdRDataGapRemediationPlan
  startedOperations: Array<{
    actionId: string
    operationId: string
    operationType: string
    status: string
  }>
  skippedActions: Array<{
    actionId: string
    status: string
    reason: string
  }>
  auditOpinion: {
    severity: "minor" | "major"
    conclusion: string
  }
}
```

当前可执行动作：

- `refresh_stock_factset` -> `batch_factset_refresh` / `scope=stock_factset`
- `run_validation_retest_audit` -> `fivd_r_validation_retest_audit`
- `resolve_asset_identity` -> `fivd_r_asset_identity_resolution`
- `refresh_market_data_cache` -> `market_bar_cache_preheat`

当前 planned/unsupported：

- `refresh_fund_factset`：unsupported。
- `refresh_gold_macro_factset`：unsupported。

该 API 只做补数/复验闭环，不放行交易动作。

资产身份解析报告：

```ts
type FivdRAssetIdentityResolutionReport = {
  schemaVersion: "fivd.r.asset_identity_resolution_report.v1"
  generatedAt: string
  userId: string
  runId: string
  sourceRunId?: string | null
  requestedSymbols: string[]
  summary: {
    requestedSymbols: number
    resolvedCount: number
    unresolvedCount: number
    lightweightResearchIdentities: number
    matchedOfficialAssets: number
  }
  identities: Array<{
    symbol: string
    name?: string | null
    assetId?: string | null
    assetType: string
    market: string
    exchange?: string | null
    confidenceScore: number
    resolved: boolean
    lightweightResearchIdentity: boolean
    matchedAsset?: Record<string, unknown> | null
    candidates: Array<Record<string, unknown>>
    evidenceRefs: string[]
    evidence: string[]
    warnings: string[]
  }>
  blockedReasons: string[]
  allowedActions: ["RESEARCH", "OBSERVE"]
  prohibitedActions: Array<"ADD" | "REDUCE" | "AUTO_TRADE">
  auditOpinion: {
    severity: "minor" | "major"
    conclusion: string
  }
  operationId: string
  artifactRefs: string[]
}
```

边界：

- 不创建正式 `Asset` 记录。
- 不把 unresolved symbol 包装成 resolved。
- 不补齐 valuation/fundamental/financial_report facts。
- 不允许 `ADD / REDUCE / AUTO_TRADE`。

Symbol 级行情预热输入：

```ts
type MarketBarCachePreheatInput = {
  userId: string
  symbols?: string[]
  limit?: number
  days?: number
  chunkSize?: number
  concurrency?: number
  forceRefresh?: boolean
  executionMode?: "inline" | "queued"
}
```

当 `symbols` 存在时：

- `universeSource="provided_symbols"`。
- `requestedSymbols` 必须等于去重后的输入 symbol 数。
- queued worker 和 retry replay 必须保留 `symbols`。
