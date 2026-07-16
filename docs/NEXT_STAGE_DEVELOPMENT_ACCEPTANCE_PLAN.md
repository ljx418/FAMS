# 下一阶段开发及验收计划

更新时间：2026-07-16

## 1. 阶段定位

本计划用于承接当前文档状态收口后的下一阶段开发。当前阶段已经完成普通用户 UX、ChatBox 第一入口、资产 Excel 导入导出、专家页保留和全系统 E2E 的文档/验收闭环；下一阶段目标不是直接放行正式交易，而是把真实数据可信、正式回测验证、人工签核和 release gate 拆成可执行、可验收、可审计的子阶段。

二次审计后的当前状态：

```text
FAMS_NEXT_STAGE_DOCUMENTATION_STATUS=APPROVED_FOR_CONTROLLED_IMPLEMENTATION
documentationSupportsControlledNextStageDevelopment=true
documentationSupportsSubstageAcceptance=true
documentationSupportsUnattendedEndToEndAutomation=false
documentationSupportsFormalTradingRelease=false
implementationEntry=after_human_approval_and_stage_gate
machineReadableStateSource=docs/current-stage-state.json
substageManifestSource=docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json
```

自动化开发必须优先读取 `docs/current-stage-state.json` 与 `docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`，不得从旧 Markdown 历史状态中推断当前状态。

当前必须保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

允许动作：

```text
RESEARCH / OBSERVE / COMPARE / ALERT / PLAN_DRAFT / MANUAL_TRADE_DRAFT
```

禁止动作：

```text
ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

## 2. 开发顺序总览

```text
S0 文档与状态基线复核
S1 真实资产样本复验
S2 正式 provider 与字段级数据治理
S3 官方或可信 total-return benchmark
S4 formal validation 与模型有效性验证
S5 人工签核与 release blocker
S6 执行隔离与订单防线
S7 release gate 总验收
S8 ChatBox 多轮 tool-calling Agent loop 增强
```

S1 到 S8 可以在技术实现上拆分，但每个子阶段开始前必须先生成子阶段计划和验收标准；每个子阶段结束后必须生成审计包、E2E 证据和 PRD 规格检视。

## 3. 子阶段开发计划

### S0 文档与状态基线复核

目标：进入任何代码开发前，确认当前状态词、drawio、PRD、UX、ChatBox 和目标架构没有漂移。

开发对象：

```text
docs/CURRENT_STAGE_DOCUMENTATION_CONSISTENCY_AUDIT.md
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
```

验收标准：

```text
drawioPageCount <= 8
documentationConsistencyReady=true
stateDriftResolved=true
nextStagePlanActionable=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

打回条件：

```text
当前有效状态冲突
drawio 超过 8 页
专家页被描述为删除或弱化
待开发项被写成已完成
出现正式交易放行文案
```

### S1 真实资产样本复验

目标：验证资产 Excel 导入导出不只是 UI 路径可见，而是能用真实用户样本驱动资产总览、组合回测和审计链路。当前审计用户基线样本已通过 `verify-portfolio-asset-sample-revalidation.ts`，后续每个真实用户账本导入后仍必须复跑本阶段验收，不能用历史审计用户样本替代真实用户验收。

实现实体：

```text
frontend/src/pages/Assets.tsx
frontend/src/pages/Dashboard.tsx
backend/src/routes/asset.ts
backend/src/routes/template.ts
PortfolioBacktestInputBuilder
asset_excel_flow_audit.json
portfolio_asset_sample_revalidation_audit.json
```

验收标准：

```text
realAssetSampleImported=true
assetPreviewValidationPassed=true
assetExportWorkbookReadable=true
dashboardAssetSummaryUpdated=true
portfolioBacktestInputBuiltFromImportedAssets=true
dataHealthNoticeShownForMissingMarketData=true
auditUserBaselineRevalidated=true
newUserWorkbookRequiresRevalidation=true
noOrderCreated=true
```

用户体验验收：

```text
用户能下载模板
用户能导入真实资产 Excel
用户能看到错误行和修复建议
用户能确认导入
用户能导出当前资产
用户能从 Dashboard 看到资产摘要
用户能从资产样本进入组合回测输入
```

### S2 正式 provider 与字段级数据治理

目标：把 research/free-source 数据和正式 provider 数据分层，确保字段级证据、覆盖率、新鲜度和交叉验证可见。

实现实体：

```text
FormalDataProviderService
ProviderFreshnessService
FieldEvidenceRef
dataGovernanceAudit
15_data_governance_audit.json
```

字段 contract：

```text
sourceProvider
sourceEndpoint
asOfDate
fetchedAt
freshnessStatus
coverageStatus
crossCheckStatus
evidenceRefs
providerMode
```

验收标准：

```text
providerMode in formal / research_fallback / unavailable
criticalFieldsHaveEvidenceRefs=true
staleFieldsVisible=true
coverageBelowThresholdBlocksFormalValidation=true
researchFallbackNotPromotedToFormal=true
providerSecretNotLogged=true
```

### S3 官方或可信 total-return benchmark

目标：组合回测不能只依赖 proxy benchmark；total-return benchmark 缺失时必须降级 validation。

实现实体：

```text
BenchmarkQualificationService
totalReturnBenchmarkAdapter
16_benchmark_qualification_audit.json
PortfolioBacktestEngine
```

验收标准：

```text
benchmarkType in official_total_return / trusted_total_return / free_source_total_return / price_index / research_proxy / unavailable
deprecated benchmark alias proxy must be normalized to research_proxy
researchProxyBenchmarkMarkedInsufficient=true
benchmarkSourceRefsPresent=true
dividendContributionSeparated=true
capitalGainContributionSeparated=true
costDragVisible=true
```

Benchmark 枚举以 `docs/BENCHMARK_ENUM_CONTRACT.md` 为准。

### S4 formal validation 与模型有效性验证

目标：把“可复算”与“模型有效”分开，输出 OOS、walk-forward、参数敏感性和分组稳定性。

实现实体：

```text
FormalValidationService
ModelEffectivenessAudit
17_formal_validation_audit.json
validation_failure_taxonomy.json
```

最低验收门槛：

```text
effectivePathCount >= 30
industryGroupCount >= 3
walkForwardWindows >= 6
walkForwardPassedRatio >= 0.6
parameterSensitivityStatus != insufficient
groupStabilityStatus != insufficient
tradeConstraintsComplete=true
totalReturnBenchmarkAvailable=true or validationStatus=insufficient
```

指标公式以 `docs/FORMAL_VALIDATION_METRIC_DEFINITIONS.md` 为准。自动化实现不得只按自然语言阈值解释 `effectivePathCount`、`walkForwardPassedRatio` 或 `industryGroupCount`。

### S5 人工签核与 release blocker

目标：人工计划草案必须进入人工签核流程，但人工签核未完成前仍不能创建订单。

实现实体：

```text
ManualSignoffService
manualTradePlanDraftReview
18_manual_signoff_audit.json
formalTradingBlockers
```

验收标准：

```text
manualDraftGenerated=true
manualReviewerRequired=true
manualSignoffCompleted=false before approval
formalTargetWeightPercent=0 before release
canCreateOrder=false
orderCreateAllowed=false
```

### S6 执行隔离与订单防线

目标：即使后续进入 release review，也必须先验证 paper/sandbox 隔离和订单创建防线。

实现实体：

```text
ExecutionIsolationService
OrderIntentBlocker
paperTradingAdapter
13_execution_isolation_audit.json
trade_boundary_wording_audit.json
```

验收标准：

```text
realOrderAdapterDisabled=true
paperOrSandboxOnly=true
orderCreateBlockedWithoutReleaseGate=true
chatBoxOrderIntentBlocked=true
expertPageOrderIntentBlocked=true
apiOrderIntentBlocked=true
```

### S7 release gate 总验收

目标：集中判断 FTR-1 到 FTR-6 是否全部通过。未全绿时，不允许声明正式交易可用。

实现实体：

```text
ReleaseGateService
14_release_gate_audit.json
SUMMARY_FOR_GPT.md
acceptance-report.html
```

验收标准：

```text
dataGovernancePassed=true
benchmarkQualificationPassed=true
formalValidationStatus=passed
formalValidationPassed=true
manualSignoffPassed=true
executionIsolationPassed=true
humanReviewCompleted=true
releaseApprovalStatus=pending
formalTradingUnlocked=false until explicit release approval
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

说明：S7 可以要求 formal validation 作为独立 gate 通过，但正式交易动作仍必须等待独立人工 release approval。`formalValidationPassed=true` 不等于 `formalTradingUnlocked` 字段可以置为 true。

### S8 ChatBox 多轮 tool-calling Agent loop 增强

目标：在不改变交易边界的前提下增强 ChatBox 的多轮上下文、连续工具调用和任务追踪。SSE streaming endpoint、流式事件 schema 和结构化 final response 已通过 `verify-chatbox-streaming.ts` 建立基线；本阶段后续重点不是重新证明 streaming 存在，而是把它纳入完整多轮 tool-calling agent loop。

实现实体：

```text
FamsChatBox.tsx
backend/src/routes/chat.ts
famsChatService
chatLlmPlannerService
piAgentCoreAdapter
chat_session_audit.json
chatbox_streaming_audit.json
multi_turn_agent_loop_audit.json
```

验收标准：

```text
chatStreamingReady=true
streamingBaselineAuditPassed=true
multiTurnContextReady=true
toolCallProgressVisible=true
operationStatusLinked=true
multiStepToolCallingReady=true
unsafeIntentBlocked=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

## 4. 阶段性验收矩阵

| 维度 | 必须验收 | 失败处理 |
| --- | --- | --- |
| PRD 规格 | 用户体验、研究边界、交易锁定是否一致 | 打回子阶段计划 |
| 真实数据 | 真实资产样本、正式 provider 或明确 fallback | 不得声明 formal |
| 回测验证 | total-return、成本、分红、交易约束、benchmark | validation insufficient |
| ChatBox | 工具白名单、结构化结果、审计、阻断 | 不得出门 |
| 前端体验 | 普通用户路径、专家路径、截图、可读性 | 打回 UX 修复 |
| 审计包 | JSON、SUMMARY、HTML 报告、artifactRefs | 不得声明验收通过 |
| 交易边界 | ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 阻断 | hard fail |

## 5. 每个子阶段必须生成的材料

```text
substage_acceptance_manifest.json
substage_plan.md
prd_spec_review.md
substage_acceptance_audit.json
trade_boundary_wording_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

涉及真实数据或回测的子阶段还必须生成：

```text
data_source_audit.json
calculation_replay_audit.json
model_effectiveness_audit.json
artifact_manifest.json
```

## 6. 出门条件

下一阶段整体出门前必须满足：

```text
allSubstageAcceptancePassed=true
prdSpecDeviation=none
criticalAuditFinding=none
majorOverPromiseRisk=none
formalTradingUnlocked=false unless separate release approval is granted
autoTradeUnlocked=false
humanReviewPackageReady=true
```

如果目标是“正式交易 release”，则必须另开 release 审批阶段；本计划完成只代表正式交易前置材料更完整，不自动代表正式交易可用。

## 7. 需要人工或外部复核的点

```text
正式 provider 授权与数据许可
官方 benchmark 资格
formal validation 统计口径
人工签核流程
正式交易 release gate
任何将 locked 状态改为 unlocked 的变更
```

## 8. 文档审计结论

```text
documentationSupportsNextStageDevelopment=true
documentationSupportsExitAcceptance=true
documentationSupportsFormalTradingRelease=false
chatGptBlockingAuditRequiredBeforeImplementation=false
externalReviewRequiredBeforeEachStageExit=true
```

当前无需继续阻断在文档审计上；但每个子阶段退出时仍应生成审计包并可提交 ChatGPT 或人工复核。

## 2026-07-14 文档开发阶段：架构风险闭环与 drawio 重构

更新时间：2026-07-14 15:24:06+08:00

本轮仍处于文档开发阶段，不进入业务代码实现。目标是把当前已认可的开发主线固化为可审查、可执行、可验收的架构文档，避免 drawio 相比前序文档出现信息退化。

### 当前文档修订目标

```text
documentationOnlyStage=true
businessCodeChangeAllowed=false
drawioPageCountLimit=8
drawioCurrentTargetRelationReady=true
implementationEntityStateIndexReady=true
nextStagePlanActionable=true
prdSpecDeviation=none
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### drawio 第 2 页重构要求

`docs/target-architecture-gap.drawio` 的「当前架构与目标架构差异」页必须采用四列映射，而不是抽象流程图：

| 列 | 必须回答的问题 | 示例实体 |
| --- | --- | --- |
| 当前存量实体 | 当前项目已经有哪些可复用代码、页面、服务、数据或审计产物 | `Dashboard.tsx`、`Assets.tsx`、`FamsChatBox.tsx`、`Backtest.tsx`、`DividendLowVol.tsx`、`chat.ts`、`asset.ts`、`portfolioBacktest.ts` |
| 当前风险 | 为什么当前实现还不能支撑正式交易前置出门 | 市场数据新鲜度 unknown、proxy benchmark、formal validation 不足、普通用户路径复杂、状态词漂移 |
| 目标架构实体 | 下一阶段需要新增或强化的明确代码实体 | `FormalDataProviderService`、`ProviderFreshnessService`、`BenchmarkQualificationService`、`FormalValidationService`、`ManualSignoffService`、`ExecutionIsolationService`、`ReleaseGateService` |
| 验收证据 | 开发完成后如何证明没有规格偏移和虚假验收 | `15_data_governance_audit.json`、`16_benchmark_qualification_audit.json`、`17_formal_validation_audit.json`、`18_manual_signoff_audit.json`、`acceptance-report.html` |

### 不允许出现的文档退化

以下任一情况出现，则不得声明文档阶段出门：

```text
无法从 drawio 判断当前架构与目标架构关系
无法从文档判断 PRD 规格偏移风险
无法从验收章节判断用户如何操作、如何验收、失败如何打回
待开发项被写成已完成
专家多 Tab 被删除或弱化
真实数据缺口、benchmark 缺口、formal validation 缺口被 UX 文案隐藏
出现 formalTradingUnlocked 不得为 true / autoTradeUnlocked 不得为 true / canCreateOrder 不得为 true / orderCreateAllowed 不得为 true
```

### 下一阶段开发仍未完成的明确范围

当前阶段完成后只能说明文档可以支撑下一阶段开发，不能说明正式交易可用。仍未完成：

```text
S2 正式 provider 与字段级数据治理
S3 官方或可信 total-return benchmark
S4 formal validation 与模型有效性验证
S5 人工签核与 release blocker
S6 执行隔离与订单防线
S7 release gate 总验收
S8 完整多轮 tool-calling Agent loop 增强
```
