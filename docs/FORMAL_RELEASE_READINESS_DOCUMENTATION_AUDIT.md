# FAMS Formal Release Readiness 文档独立审计

审计日期：2026-07-16

> 2026-08-20 实施补记：FTR-0 至 FTR-6 工程能力已经实现并通过合同/负例验证；正式 provider 授权、合格 benchmark、0/7 候选统计验证、五角色签核和最终人工审批仍保持阻塞。当前机器状态以 `docs/current-stage-state.json` 为准。

## 1. 最终结论

```text
documentationSupportsControlledNextStageDevelopment=true
documentationSupportsSubstageAcceptance=true
documentationSupportsUnattendedEndToEndAutomation=false
documentationSupportsFormalTradingRelease=false
fatalSpecificationGap=none_found
majorSpecificationGap=none_found
nextStageImplementationStatus=not_started
implementationEntry=after_human_approval_and_ftr_0_gate
```

当前文档已经足够指导 FTR-0 至 FTR-6 的受控自动化开发、阶段验收、失败打回和审计产物生成。该结论只批准实施“Formal Release Readiness Closure”，不批准正式交易 release，不批准自动启用生产订单适配器。

下一阶段自动化能够达到的最高声明是：

```text
formalTradingReleaseReviewReady=true
releaseApprovalStatus=pending_human_approval
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 2. 审计范围与权威来源

机器状态优先级：

1. `docs/current-stage-state.json`
2. `docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`
3. `docs/fams-ftr-substage-acceptance-manifest.schema.json`
4. `docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md`
5. `docs/ARCHITECTURE_CURRENT_TARGET.md`
6. `docs/target-architecture-gap.drawio`

旧 `STAGE_AUTOMATION_EXECUTION_PLAN.md` 只记录已完成 S0-S8 历史基线，不得覆盖当前 FTR 状态。

## 3. 第一轮独立审计：架构事实

审计方法：检索 `backend/src` 与 `frontend/src`，核对 drawio 和 Markdown 声称的存量代码实体；再检查目标 Service 是否被错误标记为已存在。

### 已找到的存量实体

```text
FamsChatBox
PortfolioBacktestInputBuilder
PortfolioBacktestEngine
buildDataGovernanceAudit
buildBenchmarkQualificationAudit
buildFormalValidationAudit
buildManualSignoffAudit
buildExecutionIsolationAudit
buildReleaseGateAudit
formalProviderIngestionService
marketDataFreshnessService
portfolioBenchmarkService
portfolioBacktestReviewService
```

### 正确保持为待新增/待拆分的目标实体

```text
FormalDataProviderService
BenchmarkQualificationService
FormalValidationService
ManualSignoffService
ExecutionIsolationService
ReleaseGateService
```

本轮发现并修复两处事实性命名错误：

- `buildReleaseDataGovernanceAudit` 修正为实际存在的 `buildDataGovernanceAudit`。
- 不存在的存量 `OrderIntentBlocker` 修正为实际分布在 `buildExecutionIsolationAudit`、`portfolioBacktest.ts` 和 `famsChatService.ts` 的内嵌阻断合同。

结论：当前架构、缺口和目标实体分类与代码事实一致；目标 Service 未被冒充为已实现。

## 4. 第二轮独立审计：状态与合同一致性

机器检查结果：

```text
current-stage-state.json JSON parse=passed
FTR manifest JSON parse=passed
schema draft=2020-12
stageOrder=FTR-0..FTR-6
stageCount=7
nextStageImplementationStatus=not_started
supportsFormalTradingUnlock=false
```

交易边界：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

Benchmark 合同已统一为：

```text
official_total_return
trusted_total_return
free_source_total_return
price_index
research_proxy
unavailable
```

FTR-3 进一步收紧为：只有 `official_total_return` 或 `trusted_total_return` 能计入 `releaseEffectivePathCount`。`free_source_total_return` 只能保留研究/formal-review 能力，不能用于 formal release 判绿。

旧仓库基线命令已实际复跑：

```text
cd backend && npm run test:next-stage-documentation-baseline
result=passed
drawioPageCount=8
tradeBoundaryLocked=true
unsafeTradeUnlockLines=[]
```

结论：当前状态、benchmark、formal validation 和交易边界无致命或重大规格漂移。

## 5. 第三轮独立审计：验收可执行性与 anti-false-green

每个 FTR 子阶段均已具备非空的：

```text
entryCriteria
commands
requiredArtifacts
artifactSchemas
automatedGates
manualGates
userAcceptanceScenarios
exitClaims
rollbackConditions
exitCodePolicy
```

其中 FTR-0 有 4 条命令；FTR-1 至 FTR-6 分别有 1 至 3 条命令。每阶段均声明产物 schema 的 `existing` 或 `planned_in_stage` 状态，防止把计划中的合同冒充为现有文件。

中央计划和 drawio 共同覆盖：

1. 真实资产 Excel -> Dashboard -> ChatBox/Backtest -> Operations 证据。
2. Release candidate -> total-return/OOS/walk-forward/参数/分组 -> 16/17 审计。
3. 数据/模型/风控/合规/final release 五角色 -> 签核/打回 -> artifact hash。
4. ChatBox/Backtest/API 交易动作 -> blocked -> 无订单/无持仓变更。

Anti-false-green 硬规则包括：

- 目标 Service 不能标成已实现。
- free source/research proxy 不能通过正式 benchmark gate。
- candidate 失败或 insufficient 不能静默移除。
- 自动化不能写入人工签核通过。
- 截图不能替代机器产物和 artifact hash。
- FTR-6 只能生成 review package，不能自行解锁交易。

结论：没有“三无验收章节”；用户场景、操作步骤、量化门槛和失败打回均可追溯。

## 6. Drawio 审计

```text
drawioReadable=true
drawioPageCount=8
drawioPageLimit=8
allPagesNamed=true
currentTargetEntityRelationDocumented=true
userPathsDocumented=true
exitGatesDocumented=true
tradeBoundaryDocumented=true
```

第 2 页按固定五列表示：

```text
当前代码实体 -> 当前缺口/内嵌实现 -> 目标实体 -> 审计证据 -> 用户结果
```

第 7 页提供四类用户操作路径和 FTR 顺序，第 8 页提供自动验收、人工门禁、允许声明、Hard Fail 和失败归属。解析证据已由原始 XML 重新生成到 `docs/read-drawio-output.txt`。

## 7. 未消除但已正确建模的风险

以下风险不能在文档阶段伪造关闭，但已有责任阶段、证据和人工 gate：

| 风险 | 当前状态 | 关闭阶段 |
| --- | --- | --- |
| 正式 provider 授权和凭据 | 外部阻断 | FTR-1 + 人工数据 owner |
| official/trusted benchmark 资格 | 外部阻断 | FTR-2 + 授权复核 |
| 当前 0/7 candidate formal validation passed | insufficient | FTR-3 + 模型 reviewer |
| 五角色签核缺失 | missing | FTR-4 人工签核 |
| 生产订单 adapter | disabled | FTR-5 保持禁用；另行高风险审批 |
| 正式 release 决策 | pending | FTR-6 后仍由人类决定 |

这些是下一阶段要闭环的业务/外部 gate，不是文档规格缺口。

## 8. 放行意见

文档阶段可以提交人类审核。人类认可 drawio 和范围后，可从 FTR-0 开始受控实现。每个子阶段必须按 manifest 先写子阶段计划，再实现、真实数据验收、PRD 检视、审计包和失败打回。

不得批准：

```text
unattended end-to-end release
formalTradingReleaseReady=true
formalTradingUnlocked=true
autoTradeUnlocked=true
canCreateOrder=true
orderCreateAllowed=true
productionAdapterEnabled=true
```

最终审计等级：`PASS_FOR_CONTROLLED_DEVELOPMENT_DOCUMENTATION / NOT_FORMAL_TRADING_RELEASE`。
