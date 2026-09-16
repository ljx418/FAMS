# FAMS Formal Release Readiness 开发及验收规格

更新时间：2026-09-15

## 0. 当前有效执行修订

本节覆盖后文与集中人工验收冲突的旧口径。`formal-release/*Service` 已在模块化单体内实现；当前不新增同名 Service，主要补齐正式 provider、可信 benchmark、真实统计结果、集中人工签核和最终评审包。

```text
humanReviewExecutionMode=batch_after_automated_scope
automationSelfApprovalAllowed=false
humanAcceptanceStatus=pending_batch_review
downstreamEvidenceStatus=provisional_until_human_pass
```

正式 provider 凭据/授权、benchmark 来源/授权和冻结 candidate set 是自动化前置输入。产品体验、数据、benchmark、模型、风险、合规和 final release 验收在自动化 A1-A5 完成后，于 A6 集中执行；A7 只使用通过核查的原 artifact 哈希重建最终评审包。

2026-09-15，A0/FTR-1/FTR-2/FTR-3 point-in-time v2 正式 artifact 链已顺序重建并通过。FTR-3 保留原六窗口与 H00300 trusted total-return benchmark，结果为 `5/6`、53 条动态成分路径，参数与行业/市场/流动性门槛通过；`wf-04` 失败仍保留。FTR-4 已生成 8 项 pending、0 项 approved 的不可自签队列，FTR-5 隔离回归通过，FTR-6 已生成并校验包含 28 个来源 artifact 的 provisional review package。自动化开发范围已完成，当前仅允许进入 A6 集中人工核查；正式交易和订单能力仍保持锁定。

A0 必须先取得数据所有者或来源负责人授予的有效使用权并冻结授权 artifact。A6 对该 artifact 做独立 release 复核，但无权补签或追认缺失授权；若适用范围、有效期或哈希不成立，必须打回 A0 并失效所有依赖证据。

本阶段结束时仍不得启用生产订单适配器。正式交易解锁属于独立未来高风险阶段。

## 1. 产品定位

本规格定义从当前 `research / formal-review-ready` 能力进入“正式 release 人工评审材料完整”的下一阶段。它不授权实盘交易，也不承诺自动化系统可以自行完成最终 release。

当前状态：

```text
controlledAutomationDevelopmentImplemented=true
formalReleaseReviewPackageGenerationImplemented=true
portfolioBacktestFormalReviewReady=true
manualTradeDraftReady=true
executionIsolationPassed=true
formalDataGovernancePassed=true
benchmarkQualificationPassed=true
formalValidationPassed=true
manualSignoffPassed=false
batchHumanReviewReady=true
formalTradingReleaseReviewReady=true
finalFormalReleaseReviewPackageReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

阶段目标：

```text
finalFormalReleaseReviewPackageReady=true
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
| `finalFormalReleaseReviewPackageReady` | 集中人工核查通过后，基于已签核哈希重建的最终 release 决策包完整 | A7 完成后可为 true |
| `releaseApprovalStatus` | 最终人工决策 | 自动化阶段固定 pending_human_approval |
| `formalTradingUnlocked` | 正式动作是否解锁 | 自动化阶段固定 false |
| `autoTradeUnlocked` | 自动交易是否解锁 | 本阶段固定 false |
| `canCreateOrder` / `orderCreateAllowed` | 是否可创建订单 | 自动化阶段固定 false |

强规则：

```text
formalValidationPassed != formalTradingUnlocked
manualSignoffPassed != productionAdapterEnabled
finalFormalReleaseReviewPackageReady != formalTradingReleaseReady
finalFormalReleaseReviewPackageReady != canCreateOrder
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
  FormalBenchmarkService.qualificationAudit
  FormalValidationService
  ManualSignoffService
  ExecutionIsolationService
  ReleaseGateService
Evidence
  13-18 JSON / release candidate set / HTML report / SUMMARY_FOR_GPT
```

上述 Service、`DeferredHumanReviewQueueService`、`HumanAcceptanceDraftService` 和 `FormalReleasePackageService.buildProvisional` 已实现并有合同测试；A6 图文工作台位于 `frontend/public/formal-release-human-checklist.html`，32/32 个步骤均有操作图，反馈只写入私有草稿。`PortfolioBacktestEngine` 私有 builder 仍作为计算与兼容基础。下一阶段不新增自动化业务实体，只执行 A6 授权人工集中核查；通过后才允许用相同 artifact 哈希重建 A7 final package。不得把人工 gate blocked 误写成服务未开发，也不得把 provisional 包或草稿写成最终 release 通过。

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
- 必须固化七对象 inventory、版本、角色、`validationProfileId`、`formalGateApplicable`、候选级 benchmark、成分和排除原因。
- 路径样本、研究参照和当前持仓不得从报告消失，也不得计入 `allReleaseCandidatesPassed`。
- 只有所有 `formalGateApplicable=true` 的产品 release candidate 全部通过，才可设置 `formalValidationPassed=true`。
- `not_applicable` 只能表达门槛不适用，不能当作正式 passed。
- 历史 v1 产品候选 `2/6` 结果必须作为失败基线保留；当前有效 v2 point-in-time 候选为 `5/6`、53 条动态路径，且 `wf-04` 失败不得隐藏。不得通过降低 `0.6` 门槛、删除窗口或更换 benchmark 获得全绿。
- 候选重构必须先执行 FTR-3R0：六个冻结 `validationStartDate` 均需具备 >=80% 的历史行情、tradeability、证券状态和 as-of 候选快照，并证明公告日截断和历史 universe，禁止当前快照回填历史。
- 当前 FREE-P1/FTR-3R0 已达到六个冻结时点 `6/6 ready` 并冻结 v2 候选；该前置条件若在复验中失效，必须打回 FTR-3R0，不得继续使用现有 FTR-4/FTR-6 哈希链。

### FTR-4 集中人工核查队列与签核

- A1-A5 自动化证据完成后已生成 `DeferredHumanReviewQueue`；产品体验、V2-PX 体验、数据、benchmark、模型、风控、合规、最终 release 共 8 类事项分别核查。
- 数据和 benchmark 核查只复核 A0 已冻结授权，不创建授权；授权否决的回滚阶段固定为 A0。
- 每条 passed 记录必须包含 reviewer、reviewedAt、artifact hash 和结论。
- 自动化流程只能冻结证据、生成 pending 项和校验签核，不得生成通过签核。

### FTR-5 执行隔离

- paper/sandbox 可以用于人工验证。
- 生产适配器、真实持仓修改和订单创建继续 disabled。
- ChatBox、专家页、API 的禁止动作合同必须同时通过。

### FTR-6 Provisional 与 Final review package

- A5 已汇总 A0、FTR-1 至 FTR-5 和 pending 队列，不重新计算或覆盖各 gate 结论；28 个来源 artifact 已逐字节校验，状态保持 provisional。
- A6 人工批次通过后，A7 按相同 artifact 哈希重建 final review package。
- HTML 报告必须给出当前/目标架构、用户路径、原始证据、未完成项和责任人。
- 自动化段出门为 `batchHumanReviewReady=true`；集中验收出门为 `finalFormalReleaseReviewPackageReady=true`。生产解锁仍等待独立未来决策。

### A6 图文集中人工核查

- 本机入口为 `frontend/public/formal-release-human-checklist.html`，后端只读/草稿 API 为 `/api/v1/formal-release/human-review-drafts/current`。
- 8 类事项共 32 步，配图覆盖率必须为 100%；28 步引用真实运行或冻结证据截图，4 步使用非证据操作示意并要求人工另采真实 Chrome 证据。
- 保存结果只能形成 `.verification/private/formal-release/A6/<packageId>/human-feedback-draft.json`；即使 8/8 通过也不能自动生成官方签核。
- 自动合同执行 `npm run test:ftr-a6-human-acceptance-draft` 与 `npm run test:ftr-human-checklist`；人工结果仍必须由授权审核人完成。

## 7. 里程碑

| 里程碑 | 产物 | 出门条件 |
| --- | --- | --- |
| M0 Documentation Frozen | 状态源、manifest、drawio、文档审计 | 人工认可方向；交易字段全 false |
| M1 Formal Data Passed | `15_data_governance_audit.json` | 候选级关键字段无 blocker |
| M2 Benchmark Qualified | `16_benchmark_qualification_audit.json` | official/trusted + 授权证据 |
| M3 Validation Passed | `17_formal_validation_audit.json` | candidate 集合达到全部统计门槛 |
| M4 Automated Evidence Frozen | queue + `18_manual_signoff_audit.json` | 八类项目 pending、hash 完整、自动化不能自签 |
| M5 Isolation Revalidated | `13_execution_isolation_audit.json` | paper only，production disabled |
| M6 Batch Human Acceptance | queue + signoff records | 八类真实核查全部通过，或准确打回 |
| M7 Final Review Package | `14_release_gate_audit.json` + HTML | 签核哈希一致；生产解锁仍属未来阶段 |

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
- drawio 把已实现 FTR Service、`DeferredHumanReviewQueueService` 或 provisional package 标成待开发，或把 pending 人工核查标成已通过。
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
