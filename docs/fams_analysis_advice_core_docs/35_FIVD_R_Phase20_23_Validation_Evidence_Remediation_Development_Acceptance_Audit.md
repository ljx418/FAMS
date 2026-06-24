# FIVD-R Phase 20-23 Validation Evidence Remediation Development Acceptance Audit

日期：2026-06-03

## 1. 阶段目标

本阶段实现 validation evidence 攻关的工程闭环：把 `validation_evidence` 失败从 taxonomy 摘要推进为候选级失败矩阵和策略修复报告。

本阶段不放行交易动作：

- 不修改 `validation_evidence` gate。
- 不修改 `test:trade-action-readiness` 使其虚假通过。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。
- manual trade draft 继续依赖真实 `validationDecision.usableForTradingAdvice=true`。

## 2. 已实现内容

新增 screener artifact：

```text
strategy_failure_matrix.json
strategy_remediation_report.json
```

`strategy_failure_matrix.json` 内容：

- 候选级 `failedChecks`。
- `failedReason`。
- `sampleSize` / `tradeCount`。
- `affectedRegimes`。
- `parameterSensitivityStatus`。
- `groupStabilityStatus`。
- `recommendation`：
  - `retest`
  - `narrow_scope`
  - `retire`
  - `requires_new_strategy_family`
- 修复队列：
  - `retest_queue`
  - `retire_queue`
  - `expand_sample_queue`
  - `regime_specific_queue`
  - `manual_review_queue`

`strategy_remediation_report.json` 内容：

- 每个候选的修复决策。
- 晋级前必须补齐的证据。
- 是否需要新策略族。
- 交易动作禁止列表。

## 3. 修改文件

```text
backend/src/services/screener/stockScreenerService.ts
backend/src/services/analysis/analysisService.ts
backend/scripts/verify-stock-screener-service.ts
docs/fams_analysis_advice_core_docs/18_FIVD_R_Phase12_15_Closure_Plan.md
docs/fams_analysis_advice_core_docs/35_FIVD_R_Phase20_23_Validation_Evidence_Remediation_Development_Acceptance_Audit.md
```

## 4. 规格审计

审计结论：

- 新增报告只从既有 `validation_evidence_matrix`、OOS 多窗口复验和候选处置结果派生。
- 交易 gate 仍由 `validationDecision.usableForTradingAdvice` 和 readiness 脚本控制。
- `strategy_failure_matrix` 中即使出现 `manual_review_queue`，也不能单独放行交易动作。
- `strategy_remediation_report` 只给出研究修复路径，不生成交易建议。

## 5. 验收命令

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:screener-service
npm run test:strategy-tournament-backtest
npm run test:fivd-r-validation-taxonomy
npm run test:fivd-r-trade-gate-contract
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

预期：

- `test:trade-action-readiness` 在真实 validation evidence 通过前继续失败。
- 失败 blocker 仍应为 `validation_evidence`。

## 6. 当前验收状态

已完成：

```text
node node_modules/typescript/bin/tsc: passed
npm run test:screener-service: passed
npm run test:strategy-tournament-backtest: passed
npm run test:fivd-r-validation-taxonomy: passed
npm run test:fivd-r-trade-gate-contract: passed
npm run test:production-readiness: passed
npm run test:trade-action-readiness: expected failed
frontend npm run build: passed
```

`screener-service` 新增断言：

- `strategyFailureMatrix.schemaVersion=fams.screener.strategy_failure_matrix.v1`
- 修复队列存在。
- 所有候选继续禁止 `AUTO_TRADE`。
- `strategyRemediationReport.schemaVersion=fams.screener.strategy_remediation_report.v1`
- `usableForTradingAdvice` 与 validation decision 保持一致。
- 修复报告不会放行交易动作。

生产/交易 readiness 结果：

```text
analysisAdviceReady=true
productionReady=true
tradeActionReady=false
readyForManualTradeDraft=false
latestEvidence.operationId=15fae43c-c208-47b7-9596-90dedc99377b
latestEvidence.acceptanceStatus=insufficient
latestEvidence.validationDecision=OBSERVE_ONLY
scanCoveragePercent=100
providerSuccessRate=98.61
cacheHitRate=99.95
backtestDays=60
bestSampleSize=3766
bestCredibility=high
blockerGateIds=validation_evidence
```

审计结论：

- Phase 20-23 的失败矩阵和修复报告已实现。
- 当前仍没有真实候选同时通过四项 validation evidence。
- 交易动作继续被 `validation_evidence` 阻断。

## 7. 下一步

真实长样本复跑建议：

```bash
cd backend
FAMS_LONG_SAMPLE_SCAN_LIMIT=500 npm run run:long-sample-controlled
```

若复跑后仍无候选通过四项 validation evidence：

- 保持 `OBSERVE_ONLY`。
- 不进入 Phase 24。
- 依据 `strategy_remediation_report.json` 退役或收窄策略族。

## 8. 500 标的长样本复跑结果

已执行：

```bash
cd backend
FAMS_LONG_SAMPLE_SCAN_LIMIT=500 npm run run:long-sample-controlled
```

Operation：

```text
operationId=f3a11038-4f9b-4da0-869f-3a11677580c8
status=partial
longSampleStatus=insufficient
```

验收摘要：

```text
universeSize=5523
scannedCount=500
evaluatedCount=79
failureCount=421
scanCoveragePercent=9.05
providerSuccessRate=15.8
cacheHitRate=20
backtestDays=60
rankedCandidates=126
bestSampleSize=63
bestCredibility=low
```

失败 gate：

```text
universe_coverage failed: 9.05% < 80%
provider_success_rate failed: 15.8% < 95%
cache_hit_rate failed: 20% < 80%
trade_sample_size failed: 63 < 100
validation_evidence failed: 0 passed candidates
```

新增 artifact 验证：

```text
artifactCount=36
strategy_failure_matrix.json=present
strategy_remediation_report.json=present
strategyFailureStatus=blocked
diagnosedCandidates=20
passedCandidates=0
expandSampleQueue=20
manualReviewQueue=0
remediationStatus=research_only
usableForTradingAdvice=false
```

FIVD-R validation retest：

```text
operationId=a03a6665-ba91-4450-b3c3-2d6a2c71c33a
status=blocked
blocker=universe_coverage
prohibitedActions=ADD,REDUCE,AUTO_TRADE
```

DataGap 修正：

- 新增 `universe_coverage`、`provider_success_rate`、`cache_hit_rate`、`backtest_window`、`trade_sample_size` 结构化映射。
- `universe_coverage` 已从 fallback optional 修正为 `blocking / market_data`。
- `universe_coverage.requiredFor` 覆盖 `research`、`observe`、`manual_trade_draft`、`formal_trade_action`。

补充验证：

```text
node node_modules/typescript/bin/tsc: passed
npm run test:fivd-r-data-gap-remediation: passed
npm run test:fivd-r-validation-taxonomy: passed
npm run test:fivd-r-trade-gate-contract: passed
npm run test:production-readiness: passed
npm run test:trade-action-readiness: expected failed
```

最终审计意见：

- 500 标的复跑没有改善 trade readiness，反而暴露出更基础的覆盖和 provider 问题。
- 当前首要 blocker 从单纯 `validation_evidence` 细化为 `universe_coverage`、`provider_success_rate`、`trade_sample_size` 和四项 validation evidence 未通过。
- 下一步不应继续 Phase 24，而应先补行情缓存覆盖和 provider 成功率，再复跑 long-sample controlled。
