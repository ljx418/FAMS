# FIVD-R Phase 19 Validation Taxonomy and Research History Development Acceptance Audit

日期：2026-06-03

## 1. 阶段目标

本阶段继续主线 Phase 12-15 收口计划，目标是把 FIVD-R 从“能给出 blocked/partial”推进到“能解释为什么 blocked，并能复盘研究观察历史”。

本阶段不放行交易动作：

- `validation_evidence` 未通过时，`ADD / REDUCE / AUTO_TRADE` 继续禁止。
- manual trade draft 继续 blocked。
- snapshot/watch/risk-alert 只作为研究观察记录，不转换为交易草案或交易动作。
- LLM 或前端文案不得输出买入、加仓、减仓、自动交易指令。

## 2. 开发内容

### 2.1 Validation Evidence 失败归因

已接入真实 validation retest 输出中的 `validationFailureTaxonomy`：

- 展示 failure category。
- 展示 severity。
- 展示 affected candidates / strategies。
- 展示 evidence refs。
- 展示 next action。
- 明确 `tradeActionAllowed=false`、`manualTradeDraftAllowed=false`、`autoTradeAllowed=false`。

前端 Analysis 页面新增/强化：

- Validation failure taxonomy panel。
- critical/major failure 分类展示。
- 禁止交易动作展示。
- 推荐保持 research-only / observe-only。

### 2.2 Research Snapshot / Watch History

新增后端接口：

```text
GET /api/v1/analysis/fivd-r/watch
```

接口返回：

```text
schemaVersion=fivd.r.watch_list.v1
allowedActions=RESEARCH, OBSERVE, SNAPSHOT, WATCH, RISK_ALERT
prohibitedActions=ADD, REDUCE, AUTO_TRADE
```

前端 Analysis 页面新增 Research History 面板：

- 最近 research snapshots。
- 最近 watch records。
- snapshot/watch 均明确标注为研究复盘/观察记录。
- 不展示交易执行入口。

### 2.3 Intervention Review 查询修正

`listReviews` 支持按 `runId`、`positionId`、`decision`、`limit` 查询，并返回 JSON-safe review records。

`verifyChain` 保持使用 raw Prisma records，以便校验 hash chain 时仍可访问原始 `evidenceRefsJson` 和 `createdAt`。

## 3. 修改文件

```text
backend/src/services/analysis/fivdRInterventionService.ts
backend/src/routes/analysis.ts
frontend/src/services/analysisService.ts
frontend/src/pages/Analysis.tsx
docs/fams_analysis_advice_core_docs/18_FIVD_R_Phase12_15_Closure_Plan.md
docs/fams_analysis_advice_core_docs/33_FIVD_R_Phase19_Validation_Taxonomy_Research_History_Development_Acceptance_Audit.md
```

## 4. 真实数据验收

### 4.1 Validation Retest

命令：

```bash
curl -s -X POST http://localhost:4000/api/v1/analysis/fivd-r/validation-retest
```

结果摘要：

```text
schemaVersion=fivd.r.validation_evidence_retest_audit.v1
status=blocked
decision=CONTINUE_RESEARCH_ONLY
operationId=bfc3bed4-ae01-4fb9-8297-d8421c4c9fbc
sourceOperationId=15fae43c-c208-47b7-9596-90dedc99377b
summary.blocker=validation_evidence
usableForTradingAdvice=false
rankedCandidates=20
diagnosedCandidates=20
passedCandidates=0
failedCandidates=20
insufficientCandidates=20
oos.windows=30
oos.passedWindows=0
oos.insufficientWindows=30
regimeBuckets=23
insufficientRegimeBuckets=23
```

生成 taxonomy 摘要：

```text
schemaVersion=fivd.r.validation_failure_taxonomy.v1
status=blocked_for_trading
recommendation=requires_new_strategy_family
tradeActionAllowed=false
manualTradeDraftAllowed=false
autoTradeAllowed=false
failureCategories:
  validation_evidence critical
  out_of_sample critical
  parameter_sensitivity critical
  market_regime major
  sample_size major
prohibitedActions=ADD,REDUCE,AUTO_TRADE
allowedActions=RESEARCH,OBSERVE,SNAPSHOT,WATCH,RISK_ALERT
```

Artifact refs：

```text
operation_artifact:bfc3bed4-ae01-4fb9-8297-d8421c4c9fbc:validation_evidence_retest_report.json
operation_artifact:bfc3bed4-ae01-4fb9-8297-d8421c4c9fbc:validation_failure_taxonomy.json
```

### 4.2 Latest Validation Report

命令：

```bash
curl -s 'http://localhost:4000/api/v1/analysis/fivd-r/validation-report/latest?userId=default'
```

结果：

```text
返回 latest validation report。
operationId=bfc3bed4-ae01-4fb9-8297-d8421c4c9fbc
failureCategories 包含 validation_evidence、out_of_sample、parameter_sensitivity、market_regime、sample_size。
prohibitedActions 包含 ADD、REDUCE、AUTO_TRADE。
```

### 4.3 Research Snapshot List

命令：

```bash
curl -s 'http://localhost:4000/api/v1/analysis/fivd-r/snapshots?userId=default&limit=20'
```

结果：

```text
schemaVersion=fivd.r.research_snapshot_list.v1
count=16
sample.scope=candidate
sample.summary=partial
sample.artifactRefs=1
sample.createdAt=2026-06-03T12:31:18.423Z
```

### 4.4 Watch List

命令：

```bash
curl -s 'http://localhost:4000/api/v1/analysis/fivd-r/watch?userId=default&limit=20'
```

结果：

```text
schemaVersion=fivd.r.watch_list.v1
count=16
allowedActions=RESEARCH,OBSERVE,SNAPSHOT,WATCH,RISK_ALERT
prohibitedActions=ADD,REDUCE,AUTO_TRADE
sample.decision=manual_watch
```

## 5. 自动化验证

命令执行目录：

```text
backend: /mnt/c/workspace/financial-asset-manager/backend
frontend: /mnt/c/workspace/financial-asset-manager/frontend
```

结果：

```text
node node_modules/typescript/bin/tsc: passed
npm run test:fivd-r-validation-taxonomy: passed
npm run test:fivd-r-trade-gate-contract: passed
npm run test:fivd-r-core: passed
npm run test:production-readiness: passed
npm run test:trade-action-readiness: expected failed
frontend npm run build: passed
```

`test:trade-action-readiness` 失败原因：

```text
tradeActionReady=false
readyForManualTradeDraft=false
blockerGateIds=validation_evidence
validation_evidence status=failed
```

该失败符合当前 PRD 和 safety gate 预期，不应修改测试使其虚假通过。

## 6. 健康检查

```text
GET /health: ok
database=ok
runningOperations=0
queuedOperations=0
activeFivdRRefresh=null
frontend /: HTTP 200
```

## 7. PRD 规格检视

审计结论：

- 符合 research/observe 与 trade action 分离要求。
- 没有绕过 `validation_evidence` gate。
- 没有把 snapshot/watch/risk-alert 转换为交易动作。
- 前端新增历史面板后，仍明确显示交易禁止动作。
- `productionReady=true` 仅代表研究分析生产可用，不代表 `tradeActionReady=true`。

剩余风险：

- validation evidence 仍未通过，主要失败类别为 OOS、parameter sensitivity、market regime、sample size。
- 当前 taxonomy 能解释失败，但不能自动修复策略有效性。
- watch/snapshot 历史已有统一入口，但后续还需要更强筛选、搜索和按候选/持仓分组复盘。

## 8. 下一步

建议进入 Phase 20：

- 针对 validation taxonomy 做策略失败矩阵。
- 将 OOS、参数敏感性、市场状态、样本不足拆成可执行修复任务。
- 继续保持 research-only，不推动交易动作放行。
