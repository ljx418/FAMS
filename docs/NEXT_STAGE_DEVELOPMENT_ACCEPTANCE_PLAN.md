# FAMS 下一阶段开发及验收计划

更新时间：2026-09-14

## 0. 2026-09-14 当前执行口径

本节覆盖后文中与“逐阶段人工签核”冲突的历史表述。FTR 工程服务已经实现；本阶段工作是以授权真实数据完成业务门禁，并把非前置人工验收集中到自动化范围完成后执行。

```text
humanReviewExecutionMode=batch_after_automated_scope
preAutomationPrerequisites=public_source_terms_and_local_noncommercial_scope + H00300_trusted_total_return_contract + frozen_release_candidate_set
automatedEvidenceStatus=provisional_until_human_pass
automationSelfApprovalAllowed=false
implementationApprovalRequired=true
implementationEntry=after_external_document_review_and_explicit_human_approval
productionUnlockStage=separate_future_high_risk_stage
```

执行顺序以门禁为准：`A0 -> A1 -> A2 -> A3 -> A3R0A -> A3R0B -> A3R0C -> A3R1 -> A0-v2 -> A1-v2 -> A2-v2 -> A3-v2 -> A4 -> A5 -> A6 -> A7`。A3 原候选真实结果为 `2/6 failed`；A3R0C 免费来源六时点回填和 A3R1 候选 v2 `5/6` 真实窗口验证已通过。当前只允许重新冻结并重跑 v2 正式 artifact 链；A4 仍需等待 A0-v2 至 A3-v2 全部通过。A1-A5 之间不插入产品/模型/风险/合规人工核查；A6 一次完成全部核查。任何 A6 否决都会根据 `PRD_COMPLETION_TRACEABILITY_MATRIX.md` 失效下游证据并打回责任阶段。

A0 的来源条款、用途声明和 benchmark trust decision 是运行输入，不是 release 签核。A6 只能独立复核 A0 artifact 的适用范围、有效期和哈希，不能补造或追认缺失证据；复核失败必须回到 A0，而不是修改 A1-A5 摘要后继续。

## 1. 阶段结论

下一阶段统一命名为：

```text
Formal Release Readiness Closure
stageId=formal_release_readiness_closure
```

当前 S0-S8 受控自动化开发已经完成并通过阶段验收，不再作为待开发内容。下一阶段只处理正式 release 仍未闭环的能力：正式数据治理、可信 total-return benchmark、formal validation、人工签核、执行隔离回归和最终 release review package。

本计划可以支撑后续受控自动化开发和子阶段验收，但不授权无人值守 release，也不自动开放真实交易：

```text
documentationStatus=accepted
implementationStatus=in_progress
implementationApprovalRequired=true
supportsUnattendedEndToEndAutomation=false
supportsFormalTradingUnlock=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
productionAdapterEnabled=false
```

实施批准已由项目负责人在 2026-09-14 明确给出；批准范围止于 A6 集中人工核查前的 provisional package。公开来源仅用于本机个人非商业范围，不能被描述为商业授权。

机器状态源：`docs/current-stage-state.json`。

下一阶段门禁源：`docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`。

## 2. 当前真实基线

历史验收链兼容说明：`S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8` 已完成并成为只读基线；这些编号不是本轮 FTR 待开发阶段。自动化仍可用该序列验证旧审计脚本，但不得将其重新标记为 pending。

最新 2026-07-16 审计结果：

| 能力 | 当前实现 | 当前业务状态 | 下一阶段含义 |
| --- | --- | --- | --- |
| S0-S8 受控开发 | 已实现并验收 | `accepted` | 作为不可倒退基线 |
| 字段级数据治理合同 | `PortfolioBacktestEngine.buildDataGovernanceAudit` 与 `15_data_governance_audit.json` 已实现 | `blocked` | 正式 provider、授权、候选级完整 evidence 待补 |
| Benchmark 合同 | `portfolioBenchmarkService` 与 benchmark audit 已实现 | formal review passed，formal trading blocked | official/trusted total-return 待人工确认 |
| Formal validation 合同 | 引擎内嵌 audit 和指标定义已实现 | `insufficient`，`0/7 passed` | 真实 candidate 集合须达到统计门槛 |
| 人工签核合同 | review service 和 audit 已实现 | data/model/risk/compliance/final_release 全部 missing | 建立不可伪造签核链 |
| 执行隔离 | paper/sandbox 与 blocker 已实现 | `ready_for_paper_review` | 作为回归门，生产适配器保持 disabled |
| Release gate | 引擎内嵌 gate audit 已实现 | `blocked` | 目标是生成完整人类 release review package |

当前数据审计显示 `asOfDate=2026-06-05` 的本地/免费源证据仍在使用。部分策略存在 price、benchmark、dividend、tradeability 的 `providerClass=unknown`、`freshnessStatus=unknown` 或 `coverageStatus=blocked`。文档不得只引用高覆盖策略并隐藏这些失败路径。

## 3. 架构决策

采用模块化单体内增量拆分，详见：

`docs/adr/ADR-2026-07-16-formal-release-readiness-modular-monolith.md`

```text
React / FamsChatBox / 专家页
  -> Fastify routes
  -> PortfolioBacktestInputBuilder
  -> PortfolioBacktestEngine（保留回测计算）
  -> FTR 独立 gate services（已实现，下一阶段输入真实授权证据）
  -> Operation / audit artifacts
  -> Backtest / Operations / ChatBox 可见结果
```

不在本阶段迁移微服务、PostgreSQL、TimescaleDB、Redis 或生产订单系统。当前 blocker 是证据和决策 gate，不是部署规模。

## 4. 子阶段顺序

### FTR-0 文档与状态基线冻结

目标：在代码开发前固定当前事实、下一阶段目标、实体状态和禁止声明。

实现/文档对象：

```text
current-stage-state.json
FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json
fams-ftr-substage-acceptance-manifest.schema.json
target-architecture-gap.drawio
CURRENT_STAGE_DOCUMENTATION_CONSISTENCY_AUDIT.md
```

用户验收：审计者打开 drawio 第 1、2、8 页，能区分已经完成的 S0-S8、下一阶段目标服务、当前真实 blocker 和人工 release 决策。

出门门槛：

```text
drawioPageCount=8
currentStageAndNextStageSeparated=true
allFtrStagesDocumented=true
currentToTargetEntityMappingComplete=true
nextStageImplementationApprovalRequired=true
tradeBoundaryFieldsAllFalse=true
```

### FTR-1 正式数据源与字段级治理

当前链路：

```text
formalProviderIngestionService
marketDataFreshnessService
PortfolioBacktestEngine.buildDataGovernanceAudit
15_data_governance_audit.json
```

目标链路：

```text
FormalDataProviderService
FormalDataFreshnessPolicy
FieldEvidenceValidator
FormalDataSnapshot
```

用户操作：在 Backtest 选择明确的 `releaseCandidateStrategyIds` 并运行正式评审；页面按候选和字段展示 provider、授权、日期、覆盖率、cross-check、evidenceRefs 和恢复动作；Operations 可打开同一 artifact。

出门门槛遵循 `FORMAL_DATA_GOVERNANCE_CONTRACT.md`：

```text
providerAuthorizationVerified=true
criticalFieldsHaveEvidenceRefs=true
noCriticalProviderUnknown=true
noCriticalFreshnessUnknownOrStale=true
noCriticalCoverageBlocked=true
researchFallbackPromotedToFormal=false
formalDataGovernancePassed=true
```

任一候选缺口不能由其他策略的高覆盖率抵消。

### FTR-2 官方或可信 total-return benchmark

当前链路：

```text
portfolioBenchmarkService
PortfolioBacktestEngine.buildBenchmarkQualificationAudit
16_benchmark_qualification_audit.json
```

目标链路：

```text
FormalBenchmarkService.qualificationAudit
OfficialTotalReturnBenchmarkAdapter
TrustedTotalReturnBenchmarkAdapter
```

用户操作：用户在组合比较中选择 benchmark，查看类型、授权状态、总回报曲线、分红贡献、成本拖累和证据。免费源或 price index 必须显示降级原因。

出门门槛：

```text
benchmarkType in official_total_return / trusted_total_return
benchmarkAuthorizationReviewed=true
benchmarkSourceRefsPresent=true
deprecatedAliasesPersisted=false
researchProxyCannotPassFormalValidation=true
benchmarkQualificationPassed=true
```

### FTR-3 Formal validation

当前链路：

```text
PortfolioBacktestEngine.buildFormalValidationAudit
17_formal_validation_audit.json
FORMAL_VALIDATION_METRIC_DEFINITIONS.md
```

目标链路：

```text
ReleaseCandidateSet
FTR-3R0 Point-in-time Data Gate
FormalValidationService
ValidationFailureTaxonomy
```

`releaseCandidateStrategyIds` 是本次拟 release 的策略和版本；`excludedStrategyIds` 必须记录排除原因。失败策略不得为获得全绿而静默移出 candidate 集合。

当前 v1 红利低波产品候选的 artifact/semantic 验证已通过，但业务门禁只有 2/6。六个历史决策时点已由免费来源完成真实回填；A3R1 候选 v2 使用逐窗口冻结快照和 20 只真实 qfq 评估行情通过 `5/6`，未使用最新候选、当前 8 只成分或未来公告回填历史。该隔离结果只允许重新冻结 v2 正式 artifact 链，不能直接宣称 FTR-3 或 FTR-4 通过。

2026-09-14 的细化执行状态：FTR-3R0A 已使用真实 BaoStock/AKShare 数据证明 2025-12-12 的历史 universe 和关键时点字段具备来源可行性；FTR-3R0B 已实现 `PointInTimeDataProviderService`、12 端点白名单、分页、公告日/上市期/行业生效期截断和 raw-hash 合同。真实单日批量运行因 `FAMS_TUSHARE_TOKEN/TUSHARE_TOKEN` 未配置而保持 `blocked_provider_not_configured`。未达到单日七数据域覆盖均 >=80% 前，不得进入 FTR-3R0C 六时点回填。

用户操作：研究用户逐策略查看 OOS、walk-forward、参数敏感性、行业/市场/流动性分组和失败原因，并能打开对应 evidence。

最低门槛：

```text
releaseEffectivePathCount >= 30
releaseEffectivePathBenchmark in official_total_return / trusted_total_return
industryGroupCount >= 3
walkForwardWindows >= 6
walkForwardPassedRatio >= 0.6
parameterSensitivityStatus != insufficient
groupStabilityStatus != insufficient
tradeConstraintsComplete=true
allReleaseCandidatesPassed=true
formalValidationStatus=passed
formalValidationPassed=true
```

`formalValidationPassed=true` 只表示模型验证 gate 通过，不等于交易解锁。

### FTR-4 集中核查队列与人工签核

当前链路：

```text
portfolioBacktestReviewService
PortfolioBacktestEngine.buildManualSignoffAudit
18_manual_signoff_audit.json
```

目标链路：

```text
DeferredHumanReviewQueue（待新增）
ManualSignoffService
ManualSignoffRecord
SignoffEvidencePolicy
```

自动化操作：A5 将 Daily UX、V2-PX、数据、benchmark、模型、风险、合规和 final release 八类审查项写入 pending 队列，并冻结输入 artifact 哈希。自动化不得写入 passed。

集中人工操作：A6 授权审核人在 Operations 一次打开完整队列，逐项复核并签核或打回；每次签核绑定 reviewer、时间、输入 artifact 哈希、结论和备注。普通用户和自动化 Agent 无签核权限。

自动化段出门门槛：

```text
batchHumanReviewReady=true
allQueuedArtifactHashesPresent=true
humanAcceptanceStatus=pending_batch_review
manualSignoffPassed=false
downstreamEvidenceStatus=provisional_until_human_pass
```

集中核查出门门槛：

```text
requiredRoles=data/model/risk/compliance/final_release
allRequiredSignedOff=true
reviewerAndTimestampPresent=true
signedArtifactHashesMatch=true
automationSelfApprovalBlocked=true
manualSignoffPassed=true
```

### FTR-5 执行隔离回归

当前链路：

```text
PortfolioBacktestEngine.buildExecutionIsolationAudit
portfolioBacktest.ts / famsChatService.ts 内嵌交易阻断
13_execution_isolation_audit.json
```

目标链路：

```text
ExecutionIsolationService
OrderBoundaryRuntimeContract
ProductionAdapterApprovalRecord
```

用户操作：用户只能预览 paper/sandbox intent。ChatBox、专家页和 API 尝试 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 均返回 blocked，并且不创建订单、不修改持仓。

自动化出门值固定为：

```text
executionIsolationPassed=true
paperOrSandboxOnly=true
productionAdapterEnabled=false
realPositionMutationAllowed=false
orderCreateAllowed=false
```

生产适配器启用属于独立高风险人工审批，不由 FTR 自动化开发完成。

### FTR-6 Provisional 与 Final release review

当前链路：

```text
PortfolioBacktestEngine.buildReleaseGateAudit
14_release_gate_audit.json
acceptance-report.html
```

目标链路：

```text
ReleaseGateService
FormalReleaseReviewPackage
HumanReleaseDecision
```

用户操作：A5 审计者从 provisional HTML 进入每个 gate、用户场景、测试结果和原始 artifact；A6 完成集中签核；A7 使用同一组通过签核的 artifact 哈希重建 final HTML。报告必须展示状态、责任人、失败归属和打回阶段。

集中人工核查前只能声明：

```text
batchHumanReviewReady=true
humanAcceptanceStatus=pending_batch_review
downstreamEvidenceStatus=provisional_until_human_pass
```

集中人工核查全部通过后可以声明：

```text
finalFormalReleaseReviewPackageReady=true
releaseApprovalStatus=pending_human_approval
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

任何生产权限变化必须另行人工审批并建立独立变更记录。

## 5. 里程碑

| 里程碑 | 用户可见效果 | 工程出门条件 | 失败归属 |
| --- | --- | --- | --- |
| M0 文档冻结 | 看懂当前与目标，不混淆已完成/待开发 | FTR-0 全绿并人工认可 drawio | 文档阶段 |
| M1 正式数据可评审 | 看见字段级 provider、日期、覆盖率和缺口 | FTR-1 无关键字段 blocker | 数据治理 |
| M2 Benchmark 合格 | 看见官方/可信总回报比较 | FTR-2 资格和授权通过 | Benchmark |
| M3 模型验证通过 | 看见可复核统计验证，并区分策略失败与数据不足 | 重构时先有 FTR-3R0 6/6 ready；release candidates 再全部通过 FTR-3；当前 2/6 + 0/6 不通过 | 模型验证/历史数据治理 |
| M4 自动证据冻结 | 看见八类 pending 核查项 | Queue、artifactRefs 和哈希完整 | FTR-4/A5 |
| M5 隔离防线通过 | 只能 paper/sandbox，交易动作被阻断 | FTR-5 回归通过且生产适配器 disabled | 执行隔离 |
| M6 集中人工核查 | 一次完成产品、数据、模型、风险、合规复核 | 八类项目有 reviewer/time/hash/decision | A6 对应责任阶段 |
| M7 Final review package | 一份报告解释所有 gate 和责任人 | 签核哈希与原 artifact 一致 | FTR-6/A7 |

## 6. 端到端验收路径

### 路径 A：真实资产到正式评审

1. 用户导入真实资产 Excel。
2. Dashboard 展示资产摘要和数据健康。
3. 用户从 ChatBox 或 Backtest 运行组合比较。
4. 系统展示真实数据日期、benchmark 资格、formal validation 和 blocker。
5. Operations 能追溯输入资产、Operation 和 FTR artifacts。

门槛：导入资产与回测输入一致；缺数据有恢复说明；无订单创建。

### 路径 B：策略候选到模型验证

1. 研究用户选择 release candidate 和版本。
2. 运行 1 年、3 年、5 年及验证窗口。
3. 查看收益、回撤、OOS、walk-forward、参数和分组稳定性。
4. 失败策略保留在报告并说明排除/打回原因。

门槛：所有 candidate 都有完整结果；insufficient 不得写成 passed。

### 路径 C：集中人工签核与审计

1. A5 生成包含八类审查项的 `DeferredHumanReviewQueue`。
2. A6 审核人从同一入口分别打开对应冻结证据。
3. 审核人提交签核或打回，失败项触发下游 evidence invalidated。
4. 最终 release 审核人查看完整链路，A7 重建 final 报告。

门槛：缺任一角色即 blocked；自动化不能自签核。

### 路径 D：交易边界

1. 用户从 ChatBox、Backtest 或 API 请求正式交易动作。
2. 系统返回明确 blocked response 和当前缺失 gate。
3. Operations 不出现真实订单或持仓变更。

门槛：四类禁止动作在全部入口被阻断；生产适配器不可达。

## 7. 审计产物

```text
13_execution_isolation_audit.json
14_release_gate_audit.json
15_data_governance_audit.json
16_benchmark_qualification_audit.json
17_formal_validation_audit.json
18_manual_signoff_audit.json
deferred_human_review_queue.json
provider_authorization_audit.json
release_candidate_set.json
formal_release_review_manifest.json
trade_boundary_wording_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

每个 artifact 必须包含 schemaVersion、生成时间、commit、输入引用、状态、blockers、warnings 和 evidenceRefs。通过报告不能只引用截图，必须能回到机器产物。

## 8. Hard Fail 与打回规则

以下任一项出现，子阶段不得出门：

```text
把 S0-S8 写成下一阶段待开发
把已实现 FTR Service 写成待开发，或把待新增 DeferredHumanReviewQueue 写成已实现
使用免费源或 research proxy 通过正式数据/benchmark gate
隐藏失败策略或无效窗口
自动化写入人工签核通过
生产适配器在人工审批前启用
formalTradingUnlocked=true  # 禁止出现的正向状态
autoTradeUnlocked=true      # 禁止出现的正向状态
canCreateOrder=true         # 禁止出现的正向状态
orderCreateAllowed=true     # 禁止出现的正向状态
```

任一真实数据或 E2E 验收失败，必须回到对应 FTR 子阶段计划，不能通过修改报告文案判绿。
