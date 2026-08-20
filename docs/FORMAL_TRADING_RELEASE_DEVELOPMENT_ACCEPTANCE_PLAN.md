# FAMS Formal Release Readiness 开发及验收规格

更新时间：2026-07-16

## 1. 产品定位

本规格定义从当前 `research / formal-review-ready` 能力进入“正式 release 人工评审材料完整”的下一阶段。它不授权实盘交易，也不承诺自动化系统可以自行完成最终 release。

当前状态：

```text
controlledAutomationDevelopmentImplemented=true
portfolioBacktestFormalReviewReady=true
manualTradeDraftReady=true
executionIsolationPassed=true
formalDataGovernancePassed=false
benchmarkQualificationPassed=false
formalValidationPassed=false
manualSignoffPassed=false
formalTradingReleaseReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

阶段目标：

```text
formalTradingReleaseReviewReady=true
releaseApprovalStatus=pending_human_approval
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 2. 目标体验

1. 普通用户从 ChatBox 或工作台选择资产和策略，获得清晰的研究结论、数据可信状态、关键数字、下一步和正式交易阻断原因。
2. 研究用户在 Backtest 选择明确的 release candidate 和版本，查看官方/可信 total-return benchmark、收益、回撤、成本、分红、OOS、walk-forward、参数敏感性和分组稳定性。
3. 数据审核人能逐字段查看 provider、授权、日期、覆盖率、跨源验证和 evidenceRefs。
4. 数据、模型、风控、合规和最终 release 审核人能基于不可变 artifact 分别签核或打回。
5. 审计者能从 Operations 和 HTML 报告追溯每个 gate、测试、artifact、责任人和失败归属。
6. 所有 gate 未完成人工 release 决策前，系统继续显示“正式交易未解锁”，没有下单和自动交易入口。

## 3. 非目标

```text
自动解锁 ADD / REDUCE
ORDER_CREATE
AUTO_TRADE
生产订单适配器自动启用
自动化 Agent 自签核
把免费源包装成官方源
把 price index 包装成 total-return benchmark
为获得全绿而隐藏失败策略或无效窗口
微服务、PostgreSQL、TimescaleDB、Redis 或消息队列迁移
```

## 4. 状态词典

| 字段 | 含义 | 自动化阶段目标 |
| --- | --- | --- |
| `formalDataGovernancePassed` | release candidate 的正式字段证据全部通过 | FTR-1 完成后可为 true |
| `benchmarkQualificationPassed` | official/trusted total-return 资格和授权通过 | FTR-2 完成后可为 true |
| `formalValidationPassed` | release candidate 集合的统计验证通过 | FTR-3 完成后可为 true |
| `manualSignoffPassed` | 五角色签核全部完成 | 只能由授权人工流程置 true |
| `executionIsolationPassed` | paper/sandbox 与生产路径隔离通过 | true，持续回归 |
| `formalTradingReleaseReviewReady` | 人工 release 决策包完整 | FTR-6 完成后可为 true |
| `releaseApprovalStatus` | 最终人工决策 | 自动化阶段固定 pending_human_approval |
| `formalTradingUnlocked` | 正式动作是否解锁 | 自动化阶段固定 false |
| `autoTradeUnlocked` | 自动交易是否解锁 | 本阶段固定 false |
| `canCreateOrder` / `orderCreateAllowed` | 是否可创建订单 | 自动化阶段固定 false |

强规则：

```text
formalValidationPassed != formalTradingUnlocked
manualSignoffPassed != productionAdapterEnabled
formalTradingReleaseReviewReady != formalTradingReleaseReady
formalTradingReleaseReviewReady != canCreateOrder
tradeActionReadiness passed != orderCreateAllowed
```

## 5. 目标架构

采用现有模块化单体增量演进：

```text
Frontend
  FamsChatBox / Dashboard / Backtest / DividendLowVol / Operations
API
  chat.ts / portfolioBacktest.ts / strategy.ts / operation.ts
Application
  PortfolioBacktestInputBuilder / portfolioBacktestReviewService / operationService
Calculation
  PortfolioBacktestEngine
FTR Gate Services
  FormalDataProviderService
  BenchmarkQualificationService
  FormalValidationService
  ManualSignoffService
  ExecutionIsolationService
  ReleaseGateService
Evidence
  13-18 JSON / release candidate set / HTML report / SUMMARY_FOR_GPT
```

目标 Service 是待开发实体。当前同名能力主要以 `PortfolioBacktestEngine` 私有 builder 和验证脚本存在，不能在架构图中标成已开发独立服务。

## 6. 阶段开发与验收

完整命令、artifact、自动门禁、人工门禁和打回条件维护在：

`docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`

### FTR-0 文档冻结

- 同步机器状态、PRD、目标架构、drawio 和 manifest。
- drawio 必须为 8 页并通过实体状态、用户路径和交易边界审查。
- 人工认可开发方向前，implementationStatus 保持 not_started。

### FTR-1 正式数据治理

- 按 `FORMAL_DATA_GOVERNANCE_CONTRACT.md` 验收。
- release candidate 的 price、benchmark、dividend、tradeability、fundamental、industry、cost model 均需字段级 evidence。
- `providerClass=unknown`、关键 freshness unknown/stale、coverage blocked 或 evidenceRefs 为空时不得 passed。

### FTR-2 Benchmark 资格

- 枚举以 `BENCHMARK_ENUM_CONTRACT.md` 为准。
- 只有 `official_total_return` 或经人工授权复核的 `trusted_total_return` 可通过正式 gate。
- `free_source_total_return` 继续可用于 formal review，但不能用于正式 release pass。

### FTR-3 Formal validation

- 指标以 `FORMAL_VALIDATION_METRIC_DEFINITIONS.md` 为准。
- 必须固化 `releaseCandidateStrategyIds`、版本和 `excludedStrategyIds`。
- release candidates 全部通过才可设置 `formalValidationPassed=true`。

### FTR-4 人工签核

- 数据、模型、风控、合规、最终 release 五角色分别签核。
- 每条 passed 记录必须包含 reviewer、reviewedAt、artifact hash 和结论。
- 自动化流程只能校验签核，不得生成通过签核。

### FTR-5 执行隔离

- paper/sandbox 可以用于人工验证。
- 生产适配器、真实持仓修改和订单创建继续 disabled。
- ChatBox、专家页、API 的禁止动作合同必须同时通过。

### FTR-6 Release review

- 汇总 FTR-1 至 FTR-5，不重新计算或覆盖各 gate 结论。
- HTML 报告必须给出当前/目标架构、用户路径、原始证据、未完成项和责任人。
- 自动化出门为 `formalTradingReleaseReviewReady=true`，等待独立人工 release decision。

## 7. 里程碑

| 里程碑 | 产物 | 出门条件 |
| --- | --- | --- |
| M0 Documentation Frozen | 状态源、manifest、drawio、文档审计 | 人工认可方向；交易字段全 false |
| M1 Formal Data Passed | `15_data_governance_audit.json` | 候选级关键字段无 blocker |
| M2 Benchmark Qualified | `16_benchmark_qualification_audit.json` | official/trusted + 授权证据 |
| M3 Validation Passed | `17_formal_validation_audit.json` | candidate 集合达到全部统计门槛 |
| M4 Signoff Passed | `18_manual_signoff_audit.json` | 五角色真实签核 |
| M5 Isolation Revalidated | `13_execution_isolation_audit.json` | paper only，production disabled |
| M6 Release Review Ready | `14_release_gate_audit.json` + HTML | 人工可完整复核，等待高风险决策 |

## 8. 出门验收

### 用户场景门槛

- 真实资产导入后可进入组合比较，并能解释数据缺口。
- release candidate 的 benchmark 和 validation 在 Backtest 可见。
- Operations 能追溯 provider、validation、signoff 和 release artifacts。
- ChatBox 能解释 blocker 并跳转到对应工作台，但不能签核或执行交易。
- 正式动作在 ChatBox、专家页和 API 全部被阻断。

### 审计门槛

```text
allRequiredArtifactsPresent=true
allArtifactHashesVerified=true
allReleaseCandidatesVisible=true
blockedAndInsufficientResultsPreserved=true
humanReviewRequired=true
releaseApprovalStatus=pending_human_approval
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### 打回条件

- 用户路径、操作步骤、证据或量化门槛任一缺失。
- 合同测试退出 0，但真实业务状态仍 blocked 却被写成 passed。
- 签核或 provider 授权缺失却生成全绿报告。
- drawio 把目标 Service 标成当前已开发。
- 任何交易权限正向置 true。

## 9. 高风险流程

以下事项必须停下并由人类处理：

```text
正式 provider 采购、授权和凭据配置
trusted benchmark 的资格认可
模型、风控、合规和 final release 签核
生产订单适配器启用
任何真实资金或持仓变更
最终正式交易权限变更
```

无法获得正式数据、benchmark 或签核时，正确结论是保持 release blocked，而不是降低门槛。
