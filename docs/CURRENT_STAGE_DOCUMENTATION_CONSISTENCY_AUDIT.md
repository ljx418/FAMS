# FAMS 当前阶段与下一阶段文档一致性审计

更新时间：2026-07-16

## 1. 审计结论

```text
documentationConsistencyReady=true
drawioCurrentTargetRelationReady=true
expertModuleTabsPreserved=true
```

以上三个状态仅表示当前文档、架构映射和既有专家入口一致；不表示 FTR-1 至 FTR-6 已实现，也不表示正式交易 release 已通过。

```text
currentControlledAutomationScopeAccepted=true
nextStageGoalDocumented=true
nextStageId=formal_release_readiness_closure
nextStageDocumentationStatus=ready_for_human_review
nextStageImplementationStatus=not_started
documentationSupportsControlledFtrDevelopment=true
documentationSupportsFtrSubstageAcceptance=true
documentationSupportsUnattendedRelease=false
documentationSupportsFormalTradingUnlock=false
fatalSpecificationGap=none_found
majorOverpromiseRisk=controlled_by_state_source_manifest_and_trade_boundary
```

当前文档已把 S0-S8 已完成基线与 FTR-0 至 FTR-6 下一阶段计划分开。人类批准实现前，任何 FTR 代码状态仍必须为 `not_started`。

## 2. 权威来源优先级

1. `docs/current-stage-state.json`：当前状态与下一阶段状态。
2. `docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`：FTR 子阶段门禁。
3. `docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md`：用户路径、里程碑和开发顺序。
4. `docs/ARCHITECTURE_CURRENT_TARGET.md` 与 `docs/target-architecture-gap.drawio`：实体和交互关系。
5. PRD 与专项合同：业务规则和指标定义。
6. 历史日期段落：只作演进证据，不覆盖以上来源。

## 3. 当前真实状态复核

| 检查项 | 最新证据 | 当前结论 |
| --- | --- | --- |
| S0-S8 | 2026-07-16 stage audit、commit `3d150c2`、drawio 状态图 | 已完成受控开发，不是下一阶段待办 |
| 数据治理 | `15_data_governance_audit.json` | 合同存在；业务 gate blocked |
| Benchmark | `16_benchmark_qualification_audit.json` | formal review 可用；official/trusted 资格未通过 |
| Formal validation | `17_formal_validation_audit.json` | `insufficient`，`0/7 passed` |
| 人工签核 | `18_manual_signoff_audit.json` | 五角色全部 missing |
| 执行隔离 | `13_execution_isolation_audit.json` | paper ready；production disabled |
| Release gate | `14_release_gate_audit.json` | blocked，交易权限全 false |

## 4. 架构事实审计

文档必须区分：

```text
现有独立实体
现有引擎内嵌方法
待新增或待拆分目标实体
外部/人工 gate
```

当前 `FormalDataProviderService`、`BenchmarkQualificationService`、`FormalValidationService`、`ManualSignoffService`、`ExecutionIsolationService`、`ReleaseGateService` 是下一阶段目标实体，不是当前已存在的独立 Service。当前实际实现主要位于：

```text
formalProviderIngestionService
marketDataFreshnessService
portfolioBenchmarkService
portfolioBacktestReviewService
PortfolioBacktestEngine.buildDataGovernanceAudit
PortfolioBacktestEngine.buildBenchmarkQualificationAudit
PortfolioBacktestEngine.buildFormalValidationAudit
PortfolioBacktestEngine.buildManualSignoffAudit
PortfolioBacktestEngine.buildExecutionIsolationAudit
PortfolioBacktestEngine.buildReleaseGateAudit
```

若 drawio 或 Markdown 把目标 Service 标成绿色“已开发”，架构审计 hard fail。

## 5. PRD 与用户体验审计

下一阶段至少覆盖四条完整路径：

| 用户 | 操作 | 结果 | 证据 | Hard Gate |
| --- | --- | --- | --- | --- |
| 普通用户 | 导入资产并运行组合比较 | 数据健康、关键数字、下一步和 blocker | 资产 artifact、回测 artifact、截图 | 缺数据时明确 blocked；无订单 |
| 研究用户 | 选择 release candidate 并运行验证 | benchmark、OOS、walk-forward、参数和分组 | 16/17 audit | 失败 candidate 不得消失 |
| 签核用户 | 在 Operations 逐角色复核 | 签核、打回、责任人和 hash | 18 audit | 自动化不得自签核 |
| 审计用户 | 打开 release HTML 报告 | 当前/目标架构、各 gate、失败归属 | 13-18 audit + report | blocked 项不能隐藏 |

ChatBox、普通用户工作台、资产 Excel 和专家多 Tab 均属于已验收基线，下一阶段不得删除或弱化。

## 6. Anti-false-green 审计

以下情况不得判绿：

- 验证脚本退出 0，但 artifact 业务状态为 blocked/insufficient/missing。
- 只展示通过策略，不展示 release candidate 的失败策略。
- 无效窗口不计入 `insufficientWindowCount`。
- 免费源、price index 或 research proxy 被描述为官方 total return。
- 人工签核由脚本、LLM 或默认用户写入。
- 报告有截图但缺原始 JSON、commit、输入和 evidenceRefs。
- FTR-6 报告把 `formalTradingReleaseReviewReady` 写成交易已可用。

## 7. Drawio 审计合同

```text
drawioPageCount=8
allPagesHaveName=true
currentTargetEntityLinksPresent=true
entityStateLegendPresent=true
userScenarioOperationsPresent=true
milestoneExitCriteriaPresent=true
tradeBoundaryPresent=true
```

第 2 页必须至少有前端、API、应用/计算、数据、gate/audit 五层，并表达“现有实体 -> 当前风险/内嵌实现 -> 目标实体 -> 审计证据 -> 用户结果”。

## 8. 交易边界审计

当前和文档阶段目标均保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
productionAdapterEnabled=false
```

允许动作：

```text
RESEARCH / OBSERVE / COMPARE / ALERT / PLAN_DRAFT / MANUAL_TRADE_DRAFT
```

禁止动作：

```text
ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

## 9. 待人工确认

文档开发完成后，需要人类确认：

1. 模块化单体内增量拆分路线是否符合预期。
2. FTR-0 至 FTR-6 是否覆盖全部剩余 blocker。
3. 自动化止于 release review ready、生产适配器继续 disabled 是否符合风险边界。
4. drawio 是否足以判断架构风险、PRD 偏移风险和出门验收风险。

人工确认前不得进入代码开发。
