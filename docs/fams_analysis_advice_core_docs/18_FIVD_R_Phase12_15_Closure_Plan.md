# FIVD-R Phase 12-15 收口计划

版本：v0.1  
日期：2026-06-02  
目标：把“研究/观察可用”升级为“可信研究工作台”，但不放行交易动作。

## 0. 当前基线

依据 `docs/audit/FAMS_FIVD_R_GPT_AUDIT_PACKET.md`：

- FIVD-R 已实现 summary、position detail、candidate scoring、refresh operation、snapshot、watch、risk alert、manual trade draft gate。
- `test:production-readiness` 当前通过。
- `test:trade-action-readiness` 当前按预期失败，失败原因是 `validation_evidence`。
- `tradeActionReady=false`。
- `manualTradeDraftAllowed=false`。
- `ADD / REDUCE / AUTO_TRADE` 未放行。

本阶段不是让 FIVD-R 更激进，而是让它更可信、可解释、不可误用。

## 1. 总原则

本轮开发只追求四件事：

1. 数据缺口可行动。
2. 候选评分不误导。
3. 前端明确区分研究、观察、阻断、缺数。
4. `validation_evidence` gate 不被任何路径绕过。

硬边界：

- `validation_evidence failed => 不允许 formal ADD / REDUCE`。
- manual trade draft 继续 blocked。
- `AUTO_TRADE` 永远 out of scope。
- LLM 不直接生成买入、加仓、减仓、卖出指令。
- 不修改测试让 `test:trade-action-readiness` 虚假通过。
- 不降低、绕过、隐藏 `validation_evidence`。

## 2. 开发路线总览

里程碑：

- M0：安全边界冻结与状态命名收口。
- M1：DataGapSummary 数据缺口闭环。
- M2：Candidate FIVD-R 候选评分语义修正。
- M3：前端 Research-only / Trade-blocked 体验收口。
- M4：Trade Gate Contract Tests 防绕过测试。
- M5：Validation Evidence 失败归因系统。

优先级：

- M1-M4 必须优先完成。
- M5 作为下一轮专项推进，不与 UI 收口混在一起。

## 3. M0：安全边界冻结与状态命名收口

目标：避免把 `productionReady=true` 误解为“交易可用”。

新增文件：

```text
backend/src/services/analysis/fivdRCapabilityState.ts
backend/src/services/analysis/fivdRProhibitedActions.ts
frontend/src/types/fivdRCapability.ts
```

新增状态：

```ts
export type FivdRCapabilityState =
  | "RESEARCH_READY"
  | "OBSERVE_ONLY"
  | "DATA_INSUFFICIENT"
  | "TRADE_BLOCKED"
  | "SYSTEM_UNAVAILABLE";
```

新增后端函数：

```ts
export function deriveFivdRCapabilityState(input: {
  summaryStatus: "available" | "partial" | "insufficient" | "blocked";
  blockedReasons: string[];
  missingData: string[];
  prohibitedActions: string[];
  validationEvidencePassed: boolean;
  dataGapSummary?: DataGap[];
}): FivdRCapabilityState
```

状态规则：

- `validation_evidence failed => TRADE_BLOCKED`。
- required research data missing => `DATA_INSUFFICIENT`。
- research result available but trade gate failed => `OBSERVE_ONLY`。
- research sufficient and no severe blockers => `RESEARCH_READY`。
- system/API/operation failure => `SYSTEM_UNAVAILABLE`。

统一输出字段：

```ts
capabilityState: FivdRCapabilityState
researchAvailable: boolean
observeAllowed: boolean
formalTradeActionAllowed: boolean
manualTradeDraftAllowed: boolean
autoTradeAllowed: false
```

涉及接口：

```text
GET  /api/v1/analysis/fivd-r
GET  /api/v1/analysis/fivd-r/summary
POST /api/v1/analysis/fivd-r/candidates
POST /api/v1/analysis/fivd-r/manual-trade-draft
```

禁止动作集中定义：

```ts
export const AUTO_TRADE_ALWAYS_PROHIBITED = true;

export function deriveProhibitedActions(input: {
  validationEvidencePassed: boolean;
  dataSufficient: boolean;
}) {
  const prohibited = ["AUTO_TRADE"];
  if (!input.validationEvidencePassed || !input.dataSufficient) {
    prohibited.push("ADD", "REDUCE");
  }
  return prohibited;
}
```

验收标准：

- 所有 FIVD-R API 都返回 `capabilityState`。
- `validation_evidence failed` 时 `capabilityState` 必须是 `TRADE_BLOCKED` 或 `OBSERVE_ONLY`。
- `autoTradeAllowed` 永远是 `false`。
- `formalTradeActionAllowed` 在 `validation_evidence failed` 时永远是 `false`。
- 前端不再单独展示 `productionReady=true` 作为交易可用信号。

测试：

```text
backend/src/services/analysis/__tests__/fivdRCapabilityState.test.ts
```

覆盖：

- validation failed。
- data insufficient。
- research ready but trade blocked。
- system unavailable。
- auto trade prohibited。

## 4. M1：DataGapSummary 数据缺口闭环

目标：把 broad blocker 变成用户和开发都能执行的补数任务。

新增类型：

```text
backend/src/services/analysis/dataGapTypes.ts
frontend/src/types/dataGap.ts
```

```ts
export type DataGapSeverity = "blocking" | "degrading" | "optional";

export type DataGapCategory =
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
  | "provider_health";

export type DataGapRequiredFor =
  | "research"
  | "observe"
  | "manual_trade_draft"
  | "formal_trade_action";

export type DataGap = {
  gapId: string;
  assetId?: string;
  symbol?: string;
  assetName?: string;
  assetType: "stock" | "etf" | "fund" | "bond_fund" | "gold" | "cash" | "unknown";
  severity: DataGapSeverity;
  category: DataGapCategory;
  blockedReason: string;
  missingFields: string[];
  requiredFor: DataGapRequiredFor[];
  userMessage: string;
  developerMessage: string;
  suggestedAction: string;
  providerCandidates: string[];
  lastAttemptAt?: string;
  lastError?: string;
  evidenceRefs: string[];
};
```

新增服务：

```text
backend/src/services/analysis/dataGapSummaryService.ts
```

必须映射的 blocked reasons：

- `fundamental_factset_insufficient`
- `valuation_metrics_missing`
- `financial_report_missing`
- `fund_like_value_factset_missing`
- `gold_macro_value_factset_missing`
- `asset_identity_missing`
- `validation_evidence`
- `market_regime_retest_insufficient`

股票映射：

- `fundamental_factset_insufficient`
  - category: `fundamental`
  - severity: `degrading`
  - missingFields: `roe`, `grossMargin`, `netProfitGrowth`, `operatingCashFlow`, `debtRatio`, `financialReportPeriod`
  - requiredFor: research, observe, manual_trade_draft, formal_trade_action
  - suggestedAction: 刷新或补齐股票基本面事实集，包含最近一期财报、ROE、毛利率、现金流和负债率。

- `valuation_metrics_missing`
  - category: `valuation`
  - severity: `degrading`
  - missingFields: `pe`, `pb`, `marketCap`, `industryPercentile`, `historicalPercentile`
  - requiredFor: research, observe, manual_trade_draft, formal_trade_action
  - suggestedAction: 补齐估值指标和行业/历史分位，不能仅依赖技术面评分。

- `financial_report_missing`
  - category: `financial_report`
  - severity: `blocking`
  - missingFields: `latestFinancialReport`, `reportDate`, `auditEvidenceRef`
  - requiredFor: manual_trade_draft, formal_trade_action
  - suggestedAction: 接入或刷新财报原文/摘要证据，形成 evidenceRefs。

基金 / 债基映射：

- `fund_like_value_factset_missing`
  - category: `fund_factset`
  - severity: `degrading`
  - missingFields: `fundType`, `navHistory`, `drawdown`, `fee`, `manager`, `holdings`, `riskLevel`
  - requiredFor: research, observe, manual_trade_draft, formal_trade_action
  - suggestedAction: 补齐基金类型、净值历史、回撤、费用、基金经理和持仓风格。

黄金映射：

- `gold_macro_value_factset_missing`
  - category: `gold_macro`
  - severity: `degrading`
  - missingFields: `goldPriceSource`, `realRateProxy`, `usdTrend`, `inflationExpectation`, `volatility`, `drawdown`
  - requiredFor: research, observe
  - suggestedAction: 补齐黄金宏观事实集，注意黄金不能套用股票估值模型。

候选股身份缺失：

- `asset_identity_missing`
  - category: `asset_identity`
  - severity: `blocking`
  - missingFields: `assetId`, `assetType`, `market`, `exchange`, `name`
  - requiredFor: research, observe, manual_trade_draft, formal_trade_action
  - suggestedAction: 调用 Asset Identity Resolver，创建 research identity 或明确标注无法识别。

Validation：

- `validation_evidence`
  - category: `validation_evidence`
  - severity: `blocking`
  - missingFields: `passedOosValidation`, `passedWalkForward`, `passedParameterSensitivity`, `passedRegimeRetest`
  - requiredFor: manual_trade_draft, formal_trade_action
  - suggestedAction: 复跑并审计 validation evidence。未通过前只允许 RESEARCH / OBSERVE。

输出接入位置：

- FIVD-R summary。
- Position FIVD-R detail。
- holdings research。
- candidate FIVD-R scoring。
- manual trade draft blocked response。
- validation retest audit response。

建议修改文件：

```text
backend/src/services/analysis/analysisService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/src/services/position/positionAdviceService.ts
backend/src/routes/analysis.ts
frontend/src/pages/Analysis.tsx
frontend/src/services/analysisService.ts
frontend/src/types/analysis.ts
```

新增前端组件：

```text
frontend/src/components/analysis/DataGapPanel.tsx
frontend/src/components/analysis/DataGapBadge.tsx
frontend/src/components/analysis/DataGapList.tsx
```

验收标准：

- 22 个真实持仓中，所有 partial/blocked 都能输出 `dataGapSummary`。
- `601127` 至少能显示 `fundamental_factset_insufficient` 和 `validation_evidence` 的结构化 gap。
- 基金样本能显示 `fund_like_value_factset_missing` 的结构化 gap。
- 黄金样本能显示 `gold_macro_value_factset_missing` 的结构化 gap。
- 现金类不生成估值 gap，只显示 no valuation required。
- candidate `asset_identity_missing` 能明确提示需做 identity resolve。
- 不允许通过隐藏 gap 把 status 从 partial 改成 available。

测试：

```text
backend/src/services/analysis/__tests__/dataGapSummaryService.test.ts
backend/src/services/analysis/__tests__/fivdRDataGapIntegration.test.ts
frontend/src/components/analysis/__tests__/DataGapPanel.test.tsx
```

## 5. M2：Candidate FIVD-R 候选评分语义修正

目标：避免“高 totalScore + needs_more_evidence”误导用户。

后端候选评分输出改为：

```ts
type FivdRCandidateScore = {
  symbol: string;
  name?: string;
  rank: number;
  signalScore: number;
  researchScore: number;
  evidenceAdjustedScore: number;
  dimensions: {
    strategy: number;
    valuation: number;
    expectedReturn: number;
    risk: number;
    evidenceQuality: number;
    marketState: number;
    portfolioFit?: number;
  };
  disposition:
    | "watch_candidate"
    | "observe_only"
    | "needs_more_evidence"
    | "avoid"
    | "trade_blocked";
  capabilityState: FivdRCapabilityState;
  blockers: string[];
  dataGapSummary: DataGap[];
  evidenceRefs: string[];
  allowedActions: Array<"RESEARCH" | "OBSERVE" | "SNAPSHOT" | "WATCH" | "RISK_ALERT">;
  prohibitedActions: Array<"ADD" | "REDUCE" | "AUTO_TRADE">;
};
```

评分语义：

- `signalScore`：策略信号分，来自策略命中、趋势改善、流动性、回撤控制、技术特征。
- `researchScore`：FIVD-R 原始研究分，来自 valuation proxy、expected return proxy、risk、market state、evidence quality。
- `evidenceAdjustedScore`：证据折扣后分。

折扣公式：

```ts
evidenceAdjustedScore =
  researchScore
  * assetIdentityMultiplier
  * validationMultiplier
  * dataCompletenessMultiplier
  * tradeabilityMultiplier;
```

建议倍率：

- `asset_identity_missing => assetIdentityMultiplier = 0.3`
- `validation_evidence failed => validationMultiplier = 0.5 for research, 0 for trade`
- `critical market data missing => dataCompletenessMultiplier = 0.2`
- `partial fundamentals => dataCompletenessMultiplier = 0.7`

默认排序：

```text
evidenceAdjustedScore desc
```

Asset Identity 处理：

新增：

```text
backend/src/services/asset/researchAssetIdentityService.ts
```

职责：

- 对候选 symbol 调用现有 Asset Identity Resolver。
- 如果本地 Asset 已存在，返回 assetId。
- 如果本地不存在但可识别，创建 lightweight research identity，或返回 resolvedIdentity 但不污染正式持仓。
- 如果无法识别，返回 `asset_identity_missing` DataGap。
- 不能为了评分伪造完整资产事实。

验收标准：

- 使用真实选股条件生成至少 10 个候选。
- 每个候选返回 `signalScore`、`researchScore`、`evidenceAdjustedScore`。
- `asset_identity_missing` 候选不能因为 `signalScore` 高而排在可观察候选前面。
- `validation_evidence failed` 时，没有任何候选输出 `ADD / REDUCE / AUTO_TRADE`。
- 前端明确显示“策略信号强，但证据不足”。
- 支持一键 snapshot/watch/risk alert，但不支持交易动作。

测试：

```text
backend/src/services/analysis/__tests__/fivdRCandidateScoring.test.ts
backend/src/services/asset/__tests__/researchAssetIdentityService.test.ts
frontend/src/pages/__tests__/AnalysisCandidateScoring.test.tsx
```

## 6. M3：前端 Research-only / Trade-blocked 体验收口

目标：让用户一眼看懂：

- 这个结果能不能研究。
- 能不能观察。
- 为什么不能交易。
- 缺什么数据。
- 下一步该做什么。

新增组件：

```text
frontend/src/components/analysis/FivdRStatusBanner.tsx
frontend/src/components/analysis/TradeGatePanel.tsx
frontend/src/components/analysis/FivdRCapabilityBadge.tsx
frontend/src/components/analysis/DataGapPanel.tsx
frontend/src/components/analysis/CandidateScoreBreakdown.tsx
frontend/src/components/analysis/EvidenceRefsPanel.tsx
```

固定 banner：

```text
当前为研究/观察模式，交易动作未放行。
原因：validation_evidence 未通过。
本页面不得作为买入、加仓、减仓或自动交易指令。
```

数据不足文案：

```text
当前分析结果为 partial。
原因：关键事实集缺失或数据源证据不足。
请先补齐下方数据缺口，再进行更高置信度判断。
```

候选身份缺失文案：

```text
该候选具有策略信号，但资产身份尚未完整确认。
当前只能作为研究线索，不能进入交易建议。
```

页面区域：

- Portfolio Summary：研究状态、交易状态、持仓数量、核心 blockers、`dataGapSummary` 聚合、最近 validation evidence 状态。
- Position Modal：评分、expected return、trading discipline、position advice impact、data gaps、trade gate、evidence refs。
- Candidate Scoring Panel：`signalScore`、`researchScore`、`evidenceAdjustedScore`、disposition、blockers、allowedActions、prohibitedActions、`dataGapSummary`。

允许操作：

- 保存快照。
- 加入观察。
- 创建风险提醒。
- 触发验证审计。
- 触发基础设施审计。

禁止操作：

- 买入。
- 加仓。
- 减仓。
- 自动交易。
- validation 未通过时 manual trade draft。

验收标准：

- Analysis 页面首屏不被完整刷新阻塞。
- Summary 快路径优先展示。
- Full refresh 必须走 Operation + 轮询。
- Position 弹窗失败时有超时、重试、错误说明。
- Candidate scoring 后默认按 `evidenceAdjustedScore` 排序。
- 所有 partial/blocked 状态都能看到 `dataGapSummary`。
- 用户不会把 FIVD-R 误解为交易放行。

测试：

```text
cd frontend
npm run build
```

Playwright smoke test：

- 打开 Analysis 页面。
- 查看 summary。
- 打开 Position FIVD-R。
- 执行 Candidate Scoring。
- 检查 Trade Gate banner。
- 检查 prohibitedActions 展示。

## 7. M4：Trade Gate Contract Tests 防绕过测试

目标：给所有“可能被误用成交易动作”的路径加合同测试。

新增测试：

```text
backend/src/services/analysis/__tests__/fivdRTradeGateContract.test.ts
backend/src/routes/__tests__/analysisFivdRTradeGateRoutes.test.ts
backend/src/services/llm/__tests__/llmTradeActionGuardrail.test.ts
```

必测场景：

1. Portfolio summary：
   - Given `validation_evidence failed`
   - Then prohibitedActions includes `ADD`, `REDUCE`, `AUTO_TRADE`
   - And `formalTradeActionAllowed=false`

2. Position detail：
   - Given `validation_evidence failed`
   - Then `tradingDiscipline.formalTradeActionAllowed=false`
   - And `positionAdviceImpact.validationGateMultiplier=0`

3. Candidate scoring：
   - Given `validation_evidence failed`
   - Then no candidate `allowedActions` contains `ADD` or `REDUCE`
   - And `prohibitedActions` includes `AUTO_TRADE`

4. Manual trade draft：
   - Given `validation_evidence failed`
   - When `manualTradeDraft(requestedActions=["ADD"])`
   - Then `status=blocked`
   - And `blockedReasons` includes `validation_evidence`

5. LLM explanation：
   - Given high score but validation failed
   - Then output must not contain imperative trade instruction.

禁止句式：

```text
建议买入
建议加仓
建议减仓
立即买入
可以下单
执行交易
```

允许句式：

```text
可以继续研究
可以加入观察
当前交易动作被阻断
需要补齐证据
```

6. Snapshot / watch / risk alert：
   - Only research/audit artifacts created.
   - No transaction/manual trade draft created.

验收命令：

```text
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness
```

注意：

- `test:trade-action-readiness` 仍应失败，除非真实 `validation_evidence` 通过。

## 8. M5：Validation Evidence 失败归因系统

目标：不要试图“攻关到通过”，先解释为什么失败。

当前状态：

- `passedCandidates=0`
- `failedCandidates=20`
- `insufficientCandidates=20`
- OOS windows=30
- passedWindows=0
- insufficientWindows=30
- blocked gates 包含 `validation_evidence`、`out_of_sample`、`parameter_sensitivity`、`market_regime_retest`、`candidate_disposition`

新增报告：

```text
validation_failure_taxonomy.json
strategy_failure_matrix.json
regime_failure_matrix.json
parameter_failure_matrix.json
candidate_failure_matrix.json
trade_constraint_failure_matrix.json
```

数据结构：

```ts
type ValidationFailureTaxonomy = {
  runId: string;
  strategyTournamentOperationId: string;
  validationRetestOperationId: string;
  summary: {
    passedCandidates: number;
    failedCandidates: number;
    insufficientCandidates: number;
    tradeActionAllowed: false;
  };
  failureCategories: Array<{
    category:
      | "out_of_sample"
      | "walk_forward"
      | "parameter_sensitivity"
      | "market_regime"
      | "sample_size"
      | "trade_constraint"
      | "candidate_quality"
      | "data_quality";
    severity: "critical" | "major" | "minor";
    affectedStrategies: string[];
    affectedCandidates: string[];
    evidenceRefs: string[];
    explanation: string;
    nextAction: string;
  }>;
  recommendation:
    | "keep_research_only"
    | "narrow_strategy_scope"
    | "retest_with_longer_window"
    | "retire_strategy"
    | "requires_new_strategy_family";
};
```

失败分类规则：

- OOS 全失败 => `out_of_sample critical`
- regimeBuckets insufficient => `market_regime major`
- 参数轻微变动收益大幅变化 => `parameter_sensitivity critical`
- 涨跌停/停牌/流动性约束导致收益消失 => `trade_constraint major`
- 候选身份/数据缺失过多 => `data_quality major`
- 样本不足 => `sample_size major`

输出接入：

```text
POST /api/v1/analysis/fivd-r/validation-retest
GET  /api/v1/analysis/fivd-r/validation-report/latest
```

前端显示：

- 为什么不能交易。
- 哪个验证失败。
- 失败比例。
- 下一步应该优化策略、补数据，还是扩大样本。

验收标准：

- validation evidence 未通过时，系统能说明失败类别。
- 至少覆盖 OOS、walk-forward、参数敏感性、市场状态、样本不足。
- 不能把失败包装成通过。
- `test:trade-action-readiness` 未通过时仍是预期结果。
- 生成 `validation_failure_taxonomy.json` artifact。

## 9. 两周执行节奏

第 1-2 天：M0 安全状态收口。

交付：

- `FivdRCapabilityState`
- `deriveProhibitedActions`
- 状态字段接入 API
- 基础测试

第 3-6 天：M1 DataGapSummary。

交付：

- DataGap 类型
- DataGapSummaryService
- blocked reason 映射
- summary/position/candidate/holdings 接入
- 前端 DataGapPanel

第 7-9 天：M2 Candidate scoring。

交付：

- `signalScore/researchScore/evidenceAdjustedScore`
- Asset Identity Resolver 接入
- CandidateScoreBreakdown
- 默认 `evidenceAdjustedScore` 排序

第 10-12 天：M3 前端体验。

交付：

- Research-only banner
- TradeGatePanel
- 状态徽章
- partial/blocked 解释
- operation progress 优化

第 13-14 天：M4 合同测试。

交付：

- Trade gate contract tests
- LLM guardrail tests
- manual trade draft blocked tests
- candidate no trade action tests

M5 建议作为下一轮单独做。

## 10. 每日开发验收命令

后端：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness
```

前端：

```bash
cd frontend
npm run build
```

预期：

- `tsc`：通过。
- `test:fivd-r-core`：通过。
- `test:production-readiness`：通过。
- `test:trade-action-readiness`：继续失败，除非真实 validation evidence 通过。
- `frontend build`：通过。

## 11. Definition of Done

本轮真正完成的标准：

1. 所有 partial/blocked 都有 `dataGapSummary`。
2. 用户能看懂为什么是 partial/blocked。
3. 候选股高策略分不会被误解为推荐买入。
4. 前端明确显示研究/观察/交易阻断边界。
5. 所有可能产生交易动作的路径都有 gate contract tests。
6. `validation_evidence` 未通过时，没有任何接口、前端、LLM 文案输出 formal `ADD / REDUCE`。
7. manual trade draft 继续 blocked。
8. `AUTO_TRADE` 继续不可用。

## 12. 2026-06-02 实施同步

本计划在 2026-06-02 已完成 M0-M5 的第一轮落地，当前结论为：FIVD-R 已从“部分研究可用”升级为“可信研究/观察工作台”，但交易动作仍未放行。

### 12.1 M0 安全边界冻结

已实现：

- 后端新增 `backend/src/services/analysis/fivdRCapabilityState.ts`。
- 后端新增 `backend/src/services/analysis/fivdRProhibitedActions.ts`。
- FIVD-R summary、position detail、candidate scoring、manual trade draft 均返回 `capabilityState`、`researchAvailable`、`observeAllowed`、`formalTradeActionAllowed`、`manualTradeDraftAllowed`、`autoTradeAllowed=false`。
- `validation_evidence` 未通过时，`formalTradeActionAllowed=false`，`manualTradeDraftAllowed=false`。
- `AUTO_TRADE` 继续 out of scope。

### 12.2 M1 DataGapSummary

已实现：

- 后端新增 `backend/src/services/analysis/dataGapTypes.ts`。
- 后端新增 `backend/src/services/analysis/dataGapSummaryService.ts`。
- 已映射 `fundamental_factset_insufficient`、`valuation_metrics_missing`、`financial_report_missing`、`fund_like_value_factset_missing`、`gold_macro_value_factset_missing`、`asset_identity_missing`、`validation_evidence`、`market_regime_retest_insufficient`。
- 输出已接入 FIVD-R summary、position detail、holdings research、candidate scoring、manual trade draft blocked response、validation retest audit response。
- 前端新增 `frontend/src/components/analysis/DataGapPanel.tsx`，并接入 FIVD-R 面板、持仓研究详情和候选评分。

### 12.3 M2 Candidate Scoring 语义修正

已实现：

- Candidate scoring 从单一 `totalScore` 拆为 `signalScore`、`researchScore`、`evidenceAdjustedScore`。
- 前端默认展示 `evidenceAdjustedScore`，避免高策略信号被误解为可交易。
- 后端新增 `backend/src/services/asset/researchAssetIdentityService.ts`，用于候选资产身份解析。
- 存在 `asset_identity_missing` 时，candidate 只能作为研究线索，不允许进入 observe/action-ready。
- validation evidence 未通过时，所有候选均禁止 `ADD / REDUCE / AUTO_TRADE`。

### 12.4 M3 前端 Research-only / Trade-blocked UX

已实现：

- 新增 `frontend/src/components/analysis/FivdRStatusBanner.tsx`。
- 新增 `frontend/src/components/analysis/CandidateScoreBreakdown.tsx`。
- Analysis 页 FIVD-R 分区明确展示 research/observe/manual draft/formal trade/auto trade 的边界。
- Candidate scoring 区域增加固定说明：高策略信号只代表研究线索，validation evidence 未通过时不得转换为交易动作。

### 12.5 M4 Trade Gate Contract Tests

已实现：

- 新增 `backend/scripts/verify-fivd-r-trade-gate-contract.ts`。
- 新增 npm script：`npm run test:fivd-r-trade-gate-contract`。
- 覆盖 portfolio summary、position detail、candidate scoring、manual trade draft、LLM guardrail、snapshot/watch/risk-alert 不产生交易记录。
- 补强 `backend/src/services/llm/llmService.ts` 的交易指令过滤词，覆盖 `加仓`、`减仓`、`建议买入`、`建议加仓`、`建议减仓`、`立即买入`、`可以下单`、`执行交易`。

### 12.6 M5 Validation Evidence 失败归因

已实现：

- `POST /api/v1/analysis/fivd-r/validation-retest` 现在同时产出 `validation_evidence_retest_report.json` 和 `validation_failure_taxonomy.json`。
- 新增 API：`GET /api/v1/analysis/fivd-r/validation-report/latest`。
- 新增 schema：`fivd.r.validation_failure_taxonomy.v1`。
- 前端 Analysis 页 FIVD-R 分区新增“Validation Evidence 失败归因”面板。

当前真实失败归因类别：

- `validation_evidence`：critical
- `out_of_sample`：critical
- `parameter_sensitivity`：critical
- `market_regime`：major
- `sample_size`：major

新增验证脚本：

```bash
npm run test:fivd-r-validation-taxonomy
```

### 12.7 当前验收结果

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:fivd-r-trade-gate-contract
npm run test:fivd-r-validation-taxonomy
```

已执行并通过：

```bash
cd frontend
npm run build
```

按预期失败：

```bash
cd backend
npm run test:trade-action-readiness
```

失败原因仍为真实 `validation_evidence` blocker：

- `tradeActionReady=false`
- `readyForManualTradeDraft=false`
- `blockerGateIds=["validation_evidence"]`
- `ADD / REDUCE / AUTO_TRADE` 未放行

## 13. 2026-06-02 DataGap Remediation 第一段同步

在 DataGapSummary 已能解释缺口之后，新增第一段“缺口到补数/复验动作”的闭环。

新增后端：

```text
backend/src/services/analysis/dataGapRemediationService.ts
backend/scripts/verify-fivd-r-data-gap-remediation.ts
```

新增 API：

```text
POST /api/v1/analysis/fivd-r/data-gap-remediation-plan
POST /api/v1/analysis/fivd-r/data-gap-remediation-operation
```

新增 npm script：

```bash
npm run test:fivd-r-data-gap-remediation
```

前端 Analysis 页 FIVD-R 分区新增 `Data Gap Remediation` 面板，可生成补数计划并执行当前已有执行器支持的动作。

当前可执行动作：

- 股票基本面/估值/部分财报摘要缺口：`refresh_stock_factset` -> `batch_factset_refresh` / `scope=stock_factset`。
- validation evidence / market regime retest 缺口：`run_validation_retest_audit` -> `fivd_r_validation_retest_audit`。

新增 Phase 16 后，`asset_identity_missing` 已从 planned 升级为可执行 research identity remediation。

新增后端：

```text
backend/scripts/verify-fivd-r-asset-identity-remediation.ts
```

新增 API：

```text
POST /api/v1/analysis/fivd-r/asset-identity-resolution
```

新增 npm script：

```bash
npm run test:fivd-r-asset-identity-remediation
```

当前可执行动作补充：

- `asset_identity_missing`：`resolve_asset_identity` -> `fivd_r_asset_identity_resolution`。
- 输出 `asset_identity_resolution_report.json`，schema=`fivd.r.asset_identity_resolution_report.v1`。
- 可命中本地正式资产，也可生成 lightweight research identity。
- 无法识别的 symbol 保持 unresolved，并继续输出 `asset_identity_missing`。
- 本动作不写入正式 `Asset` 表，不补齐估值/基本面事实集，不改变 validation gate。

当前 unsupported：

- `fund_like_value_factset_missing`：尚未有完整 fund factset refresh Operation。
- `gold_macro_value_factset_missing`：尚未有完整 gold macro factset refresh Operation。

设计边界：

- remediation plan 不会把 unsupported/planned 动作包装为已完成。
- 执行 remediation 只启动当前已有执行器支持的动作。
- stock factset refresh 不保证补齐财报原文/PDF 证据。
- validation retest 只刷新审计和失败归因，不等于交易放行。
- asset identity resolution 只形成 research identity artifact，不等于资产入账或交易可用。
- remediation 不改变 `validation_evidence` gate，不允许 `ADD / REDUCE / AUTO_TRADE`。

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-data-gap-remediation
npm run test:fivd-r-asset-identity-remediation
npm run test:fivd-r-core
npm run test:fivd-r-trade-gate-contract
npm run test:fivd-r-validation-taxonomy
npm run test:production-readiness
```

已执行并通过：

```bash
cd frontend
npm run build
```

按预期失败：

```bash
cd backend
npm run test:trade-action-readiness
```

失败原因仍为真实 `validation_evidence` blocker。

## 14. 2026-06-02 Phase 17 Market Data Remediation 同步

新增开发前计划与审计文档：

```text
docs/fams_analysis_advice_core_docs/20_FIVD_R_Phase17_MarketData_Remediation_Development_Acceptance_Audit.md
```

新增后端：

```text
backend/scripts/verify-fivd-r-market-data-remediation.ts
```

新增 npm script：

```bash
npm run test:fivd-r-market-data-remediation
```

实现变化：

- `market_bar_cache_preheat` Operation 输入支持 `symbols`。
- queued worker / retry replay 会保留 `symbols`，不再回退到默认 universe。
- DataGap remediation 中有 symbol 的 `market_data` / `provider_health` gap 映射为 `refresh_market_data_cache`。
- `refresh_market_data_cache` -> `market_bar_cache_preheat`，默认 queued 执行。

真实数据验收：

- fixture symbols：`601127`、`600000`。
- `requestedSymbols=2`，`universeSource=provided_symbols`。
- 当前本地缓存已足够，`attemptedSymbols=0`、`afterSufficientSymbols=2`，Operation status=`completed`。
- artifactRefs 包含 `market_bar_cache_preheat_report.json`。

边界：

- 行情预热只补 K 线缓存、coverage 和 `market_feature_daily`。
- 不补基金净值、黄金宏观、基本面、估值或财报事实集。
- 不改变 `validation_evidence` gate，不允许 `ADD / REDUCE / AUTO_TRADE`。

## 15. 2026-06-03 剩余主线补全计划

用户审查后确认：FIVD-R 不能只展示门禁和缺口，必须形成可用于真实持仓和选股研究的评分工作台。同时，现金、余额宝、银行卡等现金类资产只影响组合现金占比，不应作为分析建议、持仓研究或 FIVD-R 评分对象。

### 15.1 Phase 18.11：现金类资产分析边界收口

目标：

- 现金类资产保留在资产账本、组合总值和现金占比中。
- 现金类资产不生成单标的分析建议。
- 现金类资产不进入持仓研究列表、FIVD-R position detail、candidate scoring 或 market trace。

开发任务：

- 后端 `generateInvestmentSuggestions` 过滤现金 market trace。
- 后端 `getHoldingsResearch` 默认过滤现金持仓。
- `portfolio_targets` 不再输出“现金 maintain”类伪建议。
- 前端只在组合总览展示现金占比，不展示现金持仓研究卡片。

验收标准：

- `investment-suggestions` 中 `cashInSuggestions=0`。
- `marketDataTrace` 中 `cashInMarketTrace=0`。
- `holdings-research` 中 `cashHoldings=[]`。
- `portfolio_view.cash_pct` 仍保留。

禁止事项：

- 不删除现金资产或现金持仓账本。
- 不把现金缺口包装成交易建议。

### 15.2 Phase 18.12：FIVD-R 前端实质评分视图

目标：

- FIVD-R 前端首屏不只展示 `blocked`，必须展示研究评分、证据质量、价值评分、预计收益、交易纪律、证据折扣和下一步动作。
- 用户能一眼区分“研究评分可用”和“交易动作阻断”。

开发任务：

- Portfolio FIVD-R 增加研究评分摘要：`researchAvailable`、`evidenceQualityScore`、`dataGapSummaryMeta`、validation blocker。
- Position FIVD-R 增加评分卡：valuation composite、expected return sample/window、discipline action、position advice impact。
- Candidate FIVD-R 增加完整排序表、折扣原因、观察/风险提醒动作。
- DataGapPanel 增加“下一步优先级”视角。

验收标准：

- 打开 Analysis -> FIVD-R 时，首屏能看到评分和阻断原因。
- 打开单持仓 FIVD-R 时，能看到 valuation / expected return / trading discipline / impact 四类摘要。
- Candidate scoring 默认按 `evidenceAdjustedScore` 排名。
- 页面文案不暗示 `ADD / REDUCE / AUTO_TRADE` 已放行。

### 15.3 Phase 18.13：持仓研究事实集与技术指标补齐

目标：

- 持仓研究从“很多缺口”收口到“每类资产至少有可解释的研究事实集”。

开发任务：

- 股票：补齐财报关键字段、估值指标、行业/历史分位、技术特征展示。
- ETF/基金：补齐净值历史、回撤、费用、规模、持仓、基金经理/管理人。
- 债基：补齐风险等级、久期代理、信用风险代理。
- 黄金：继续保留 gold price / DXY / TIP / TIP-IEF 代理，并在前端明确其研究含义。

验收标准：

- 每个非现金持仓都有 `researchFactStatus`。
- partial/blocked 持仓都有可行动 `dataGapSummary`。
- 至少股票、基金/债基、黄金各 1 个真实样本能展示对应事实集摘要。

### 15.4 Phase 18.14：选股到 FIVD-R 研究闭环

目标：

- 用户通过策略筛选出的候选，可以进入 FIVD-R 排名、观察池、快照和风险提醒闭环。

开发任务：

- 候选评分表支持排序、筛选和候选级研究动作。
- `asset_identity_missing` 候选必须继续降权并进入“证据不足”。
- 快照/观察/风险提醒动作展示 operation/artifact 回执。

验收标准：

- 真实选股条件至少产生 10 个候选并完成 FIVD-R scoring。
- 无任何候选在 validation evidence failed 时输出 `ADD / REDUCE / AUTO_TRADE`。
- 用户能从候选列表保存观察或风险提醒。

### 15.5 Phase 18.15：基金/债基剩余事实集补齐

目标：

- 收口当前最主要的 fund/bond blockers。

剩余 blocker：

- `fund_risk_level_missing`
- `bond_duration_proxy_missing`

开发任务：

- 调研真实 provider 或官方文档来源。
- 若无可靠来源，保持 partial 并输出明确补数计划，不伪造风险等级或久期。
- 对已接入数据生成可审计 evidenceRefs。

验收标准：

- 至少 1 个真实基金样本能展示风险等级或明确说明 provider 缺失。
- 至少 1 个真实债基样本能展示久期代理或明确说明 provider 缺失。

### 15.6 Phase 19：Validation Evidence 攻关

目标：

- 解释并改善 `validation_evidence` 失败，而不是绕过 gate。

开发任务：

- 扩展 OOS 样本窗口。
- 强化 walk-forward、参数敏感性、市场状态复验。
- 输出失败归因和下一步策略族建议。

验收标准：

- 未真实通过前，`test:trade-action-readiness` 继续按预期失败。
- `formalTradeActionAllowed=false`。
- `manualTradeDraftAllowed=false`。
- `AUTO_TRADE` 继续 out of scope。

### 15.7 今日执行范围

今日优先完成：

1. Phase 18.11 现金类资产分析边界收口。
2. 修复本地前后端启动脚本，避免 `.bin` 链接失效导致前端总览失败。
3. Phase 18.12 第一段：FIVD-R 前端实质评分视图。
4. 前后端验证：TypeScript、FIVD-R core、前端 build、真实 API smoke。

### 15.8 2026-06-03 今日实施同步

已完成：

- Phase 18.11 现金类资产分析边界收口。
  - 现金、余额宝、银行卡、小荷包等现金类资产不再生成单标的分析建议。
  - 现金类资产不再进入 `marketDataTrace`。
  - `holdings-research` 默认过滤现金类持仓。
  - `portfolio_targets` 不再输出“现金 maintain”伪建议。
  - `portfolio_view.cash_pct` 继续保留，用于组合流动性判断。
- 本地启动脚本稳定性修复。
  - `frontend npm run dev` 改为直接调用 `node node_modules/vite/bin/vite.js`。
  - `backend npm run dev` 改为直接调用 `node node_modules/tsx/dist/cli.mjs watch src/index.ts`。
  - `backend npm run build` 改为直接调用本地 TypeScript 入口。
- Phase 18.12 第一段：FIVD-R 前端实质评分视图。
  - Analysis 页 FIVD-R 面板新增“FIVD-R 研究评分总览”。
  - 展示研究评分、证据质量、价值评分、预计收益、交易纪律、缺口严重度。
  - 明确该评分只用于研究排序和证据审查，交易动作仍由 `validation_evidence` gate 控制。

真实数据验收结果：

```text
investment-suggestions:
suggestions=20
portfolioTargets=[]
marketTrace=19
cashInSuggestions=0
cashInMarketTrace=0
cashPct=0.4853

holdings-research:
holdings=19
cashHoldings=[]
```

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core

cd frontend
npm run build
```

服务 smoke：

```text
GET http://localhost:3000/ -> 200
GET http://localhost:4000/health -> 200
```

审计意见：

- 今日变更没有放行 `ADD / REDUCE / AUTO_TRADE`。
- 今日变更没有绕过 `validation_evidence`。
- 现金类资产仍保留在账本与组合现金占比中，但不再作为 FIVD-R 研究评分对象。
- FIVD-R 前端已有评分总览，但持仓研究事实集、技术指标完整性和基金/债基剩余事实集仍需在 Phase 18.13-18.15 继续收口。

### 15.9 Phase 18.13 第一段实施同步

已完成：

- `holdings-research` 为所有非现金持仓新增 `researchCoverage`。
- 覆盖技术指标、基本面/事实集、消息/事件、估值/价值四个维度。
- 每个维度显示状态、证据数量和 blocker 数量。
- 每个持仓显示覆盖分、覆盖标签、首要缺口和下一步补数动作。
- Analysis 页面新增“持仓研究覆盖率”总览，展示平均覆盖分、ready/partial/insufficient 分布和高频缺口。
- Analysis 页面持仓卡新增研究覆盖分和四维度覆盖详情。

真实数据验收：

```text
GET /api/v1/analysis/holdings-research?userId=default

holdings=19
withCoverage=19
cashHoldings=0
avgCoverage=48
labels:
  data_insufficient=9
  partial=9
  research_ready=1
topGaps:
  validation_evidence
  financial_report_missing
```

验收结论：

- 19 个真实非现金持仓全部具备研究覆盖率摘要。
- 现金类资产没有进入持仓研究。
- 当前覆盖率平均值偏低，说明 FIVD-R 仍处于“可信研究台建设”阶段，还不是交易动作系统。
- 主要剩余缺口是 `validation_evidence` 和财报/事实集证据。

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core

cd frontend
npm run build
```

服务 smoke：

```text
GET http://localhost:4000/health -> 200, database=ok, activeFivdRRefresh=null
GET http://localhost:3000/ -> 200
```

下一段主线：

- Phase 18.13 第二段：继续补齐持仓研究里的实际事实集覆盖，优先股票技术指标/基本面字段与 evidenceRefs 完整性。
- Phase 18.14：选股候选到 FIVD-R 排名、观察池、快照、风险提醒闭环。
- Phase 18.15：基金/债基风险等级与久期代理事实集收口。

### 15.10 Phase 18.13 第二段实施同步

已完成：

- `holdings-research` 新增 `researchEvidenceDetails`。
- 后端结构化输出技术指标字段、基本面 facts、估值字段、消息事件摘要。
- 前端持仓卡展示事实集可用/缺失计数和关键技术指标。
- 前端持仓详情弹窗展示完整技术字段、基本面事实、估值依据和 blocker。

真实数据验收：

```text
holdings=19
cashHoldings=0
withCoverage=19
withEvidenceDetails=19
avgCoverage=47
technicalAvailableSum=125
technicalMissingSum=160
fundamentalAvailableSum=231
fundamentalMissingSum=24
```

关键样本：

```text
赛里斯:
technicalSource=market_feature_daily
technicalAvailable=15
technicalMissing=0
fundamentalAvailable=9
valuationStatus=available

中期债（一年）:
technicalSource=position_advice_factset
technicalAvailable=5
technicalMissing=10
valuationStatus=partial
```

已执行：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

结果：

- TypeScript 通过。
- FIVD-R core 通过。
- production-readiness 通过。
- trade-action-readiness 按预期失败，原因是 `validation_evidence`。
- 前端 build 通过。
- 前后端 smoke 均通过。

审计意见：

- 该段只提升研究事实透明度，不提升交易权限。
- `validation_evidence` gate 仍生效。
- 当前最大研究缺口从“页面没有实质内容”转为“已有字段明细，但部分资产类型的技术字段和基金/债基专属事实仍需补齐”。

### 15.11 Phase 18.14 实施同步

已完成：

- 候选 FIVD-R 卡片新增“保存快照”研究动作。
- 候选已支持“保存快照 / 加入观察 / 风险提醒”三类研究闭环动作。
- 候选快照 payload 明确记录 `scope=candidate`、`summary`、`evidenceGate`、`allowedActions`、`prohibitedActions`、`blockedReasons`。
- 前端 `saveFivdRResearchSnapshot` 支持通用研究 result，便于候选级快照保存。

真实数据验收：

```text
candidate scoring:
analyzed=10
observable=10
manualReviewEligible=0
blocked=10
anyTradeAllowed=false
allProhibitTrade=true
sortedByEvidenceAdjusted=true

candidate snapshot:
scope=candidate
artifact=fivd_r_research_snapshot.json
prohibitedActions=ADD,REDUCE,AUTO_TRADE
```

已执行：

```bash
cd backend
node node_modules/typescript/bin/tsc

cd frontend
npm run build
```

沿用本轮完整验收：

- `npm run test:fivd-r-core` 通过。
- `npm run test:production-readiness` 通过。
- `npm run test:trade-action-readiness` 按预期失败，blocker 为 `validation_evidence`。

审计意见：

- Phase 18.14 没有新增交易动作。
- Snapshot/watch/risk-alert 只产生研究 artifact 或观察记录。
- validation evidence 未通过时，候选继续禁止 `ADD / REDUCE / AUTO_TRADE`。
- 下一步应补候选观察池/历史快照列表统一入口，以及候选级基本面/估值事实集增强。

### 15.12 Phase 18.15 实施同步

已完成：

- 基金/债基事实集新增 `riskLevelProxy`。
- 债基事实集新增 `durationProxy`。
- value assessment facts 新增基金风险等级代理、风险分代理、债基久期桶代理、估算久期年限、债券配置比例、前十大债券集中度。
- holdings research 新增 `researchEvidenceDetails.fundLike`。
- Analysis 持仓卡和详情弹窗展示基金/债基专属研究代理。
- 过滤旧 position advice cache 中已被实时 factset 闭环的陈旧 blocker。

真实数据验收：

```text
totalHoldings=19
fundLike=13
withFundLike=13
riskAvailable=13
durationAvailable=3
remainingFundRiskGaps=0
remainingDurationGaps=0
remainingNavGaps=0
remaining gaps:
  validation_evidence
  fund_holdings_factset_missing
  bond_credit_risk_proxy_missing
```

样本：

```text
中期债（一年）:
coverage=62
risk=low / 5.73
duration=short / 1.2 年
navSample=117
gaps=validation_evidence

红利低波:
coverage=62
risk=medium / 29.26
duration=not_applicable
navSample=117
gaps=validation_evidence

恒生科技:
coverage=57
risk=high / 81.79
navSample=117
gaps=fund_holdings_factset_missing, validation_evidence
```

已执行：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

结果：

- TypeScript 通过。
- FIVD-R core 通过。
- production-readiness 通过。
- trade-action-readiness 按预期失败，blocker 为 `validation_evidence`。
- 前端 build 通过。
- 前后端 smoke 均通过。

审计意见：

- Phase 18.15 只提升基金/债基研究事实集，不放行交易动作。
- 风险等级和久期均明确标注为研究级代理，不是官方评级或真实组合加权久期。
- `ADD / REDUCE / AUTO_TRADE` 继续禁止。
- 下一步主线建议进入 Phase 19：validation evidence 失败归因与改进；同时补候选观察池/历史快照列表统一入口。

### 15.13 Phase 19 实施同步

已完成：

- Validation evidence retest 输出 `validationFailureTaxonomy` 并接入前端 Analysis 页面。
- 失败归因覆盖 `validation_evidence`、`out_of_sample`、`parameter_sensitivity`、`market_regime`、`sample_size`。
- 新增候选/持仓研究快照和观察历史统一面板。
- 新增 `GET /api/v1/analysis/fivd-r/watch`，统一返回 research/observe allowed actions 与 ADD/REDUCE/AUTO_TRADE prohibited actions。
- 修正 intervention review 查询，使 watch/history 可按 decision、runId、positionId、limit 查询。

真实数据验收：

```text
validation retest:
status=blocked
decision=CONTINUE_RESEARCH_ONLY
rankedCandidates=20
diagnosedCandidates=20
passedCandidates=0
failedCandidates=20
insufficientCandidates=20
oosWindows=30
passedWindows=0
insufficientWindows=30
regimeBuckets=23
insufficientRegimeBuckets=23

taxonomy:
status=blocked_for_trading
recommendation=requires_new_strategy_family
tradeActionAllowed=false
manualTradeDraftAllowed=false
autoTradeAllowed=false
failureCategories=validation_evidence,out_of_sample,parameter_sensitivity,market_regime,sample_size
prohibitedActions=ADD,REDUCE,AUTO_TRADE

snapshot list:
schemaVersion=fivd.r.research_snapshot_list.v1
count=16

watch list:
schemaVersion=fivd.r.watch_list.v1
count=16
allowedActions=RESEARCH,OBSERVE,SNAPSHOT,WATCH,RISK_ALERT
prohibitedActions=ADD,REDUCE,AUTO_TRADE
```

已执行：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-validation-taxonomy
npm run test:fivd-r-trade-gate-contract
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

结果：

- TypeScript 通过。
- validation taxonomy 测试通过。
- trade gate contract 测试通过。
- FIVD-R core 通过。
- production-readiness 通过。
- trade-action-readiness 按预期失败，blocker 为 `validation_evidence`。
- 前端 build 通过。
- `/health` 通过，database=ok，runningOperations=0，activeFivdRRefresh=null。
- 前端 `/` 返回 HTTP 200。

审计意见：

- Phase 19 只增强失败归因、研究复盘和观察历史，不放行交易动作。
- `validation_evidence` 仍是交易动作硬 blocker。
- manual trade draft 继续 blocked。
- Snapshot/watch/risk-alert 继续只作为研究观察 artifact。
- 下一步主线进入 Phase 20：基于 taxonomy 拆解 OOS、参数敏感性、市场状态、样本不足的策略修复矩阵。

### 15.14 Phase 23-27 Gate 执行审计同步

用户要求直接完成 Phase 23-27。本次已执行真实 readiness 和 validation gate 复核，结论为：Phase 23 只能完成阻断审计，Phase 24-27 因前置条件未满足不能实质进入。

详见：

```text
docs/fams_analysis_advice_core_docs/34_FIVD_R_Phase23_27_Trade_Readiness_Gated_Execution_Audit.md
```

真实验证摘要：

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

执行结果：

```text
npm run test:strategy-tournament-backtest: passed
npm run test:screener-service: passed
npm run test:production-readiness: passed
npm run test:trade-action-readiness: expected failed
node node_modules/typescript/bin/tsc: passed
npm run test:fivd-r-trade-gate-contract: passed
frontend npm run build: passed
```

审计意见：

- Phase 23 未能形成交易动作放行证据，原因是 `validation_evidence=failed`。
- Phase 24 manual trade draft gate 不能进入 ready。
- Phase 25 正式交易状态源增强不能替代 validation evidence。
- Phase 26 不能发布 trade action 准生产结论。
- Phase 27 不能进入受控灰度。
- `ADD / REDUCE / AUTO_TRADE` 继续禁止。

下一步：

- 回到 Phase 20-23 的 validation evidence 攻关链路。
- 将 OOS、walk-forward、参数敏感性、市场状态分层失败拆成策略修复矩阵。
- 退役不能复验的策略族，扩展真实样本窗口后重新运行 long-sample controlled validation。

### 15.15 Phase 20-23 Validation Evidence 攻关实施同步

已完成：

- 新增 `strategy_failure_matrix.json`。
- 新增 `strategy_remediation_report.json`。
- 将两个报告接入 screener artifacts 和 `data_quality_report.json`。
- FIVD-R validation taxonomy 的 evidence refs 增加两个新报告。
- `test:screener-service` 增加报告结构、修复队列和交易禁止断言。

详见：

```text
docs/fams_analysis_advice_core_docs/35_FIVD_R_Phase20_23_Validation_Evidence_Remediation_Development_Acceptance_Audit.md
```

实现边界：

- 不改变 `validationDecision.usableForTradingAdvice` 的计算。
- 不降低 OOS、walk-forward、参数敏感性、分组稳定性四项 gate。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。
- 新报告只负责把失败转成可执行修复队列，不负责交易动作放行。

当前已验证：

```text
node node_modules/typescript/bin/tsc: passed
npm run test:screener-service: passed
```

下一步需要继续执行完整回归，并用 long-sample controlled 生成真实新 artifact：

```bash
cd backend
FAMS_LONG_SAMPLE_SCAN_LIMIT=500 npm run run:long-sample-controlled
```

若复跑后仍无候选同时通过 OOS、walk-forward、参数敏感性和分组稳定性，则继续保持 `OBSERVE_ONLY`，不得进入 Phase 24。

### 15.16 Phase 20-23 长样本复跑同步

已执行：

```bash
cd backend
FAMS_LONG_SAMPLE_SCAN_LIMIT=500 npm run run:long-sample-controlled
```

结果：

```text
operationId=f3a11038-4f9b-4da0-869f-3a11677580c8
status=partial
longSampleStatus=insufficient
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
universe_coverage failed
provider_success_rate failed
cache_hit_rate failed
trade_sample_size failed
validation_evidence failed
```

新增 artifact 验收：

```text
strategy_failure_matrix.json=present
strategy_remediation_report.json=present
diagnosedCandidates=20
passedCandidates=0
expandSampleQueue=20
manualReviewQueue=0
remediationStatus=research_only
usableForTradingAdvice=false
```

已修正：

- `universe_coverage` 不再作为 fallback optional gap。
- 新增 `universe_coverage`、`provider_success_rate`、`cache_hit_rate`、`backtest_window`、`trade_sample_size` DataGap 映射。
- FIVD-R validation retest 已能把 `universe_coverage` 显示为 blocking market data gap。

验证：

```text
node node_modules/typescript/bin/tsc: passed
npm run test:fivd-r-data-gap-remediation: passed
npm run test:fivd-r-validation-taxonomy: passed
npm run test:fivd-r-trade-gate-contract: passed
npm run test:production-readiness: passed
npm run test:trade-action-readiness: expected failed
```

审计意见：

- 本次复跑未达到 Phase 23 通过条件。
- 不能进入 Phase 24。
- 下一步主线应先处理 market data coverage / provider success / cache hit rate，再重新复跑 long-sample controlled。
