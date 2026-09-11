# FAMS 当前架构与下一阶段目标架构

更新时间：2026-09-11

## 1. 架构结论

FAMS 当前是 React/Vite + Fastify + Prisma/SQLite 的模块化单体。已完成 ChatBox、普通用户工作台、专家多 Tab、资产 Excel、每日持仓复盘、支付宝受控研究工作流、RRG、组合比较、真实数据研究回测、Operation 审计、Formal Release Readiness 工程服务和交易阻断。下一步不是重写系统，而是先保持 PRD/状态/架构可审计，再闭环正式数据、Benchmark、Formal Validation 和人工签核业务门禁。

```text
当前能力：research / formal-review-ready / manual draft / paper-sandbox audit / FTR engineering complete
下一阶段目标：PRD baseline consistent -> formal business gates evidenced
不在本阶段：production order enablement / AUTO_TRADE / unattended release
```

权威状态：`docs/current-stage-state.json`。

架构决策：`docs/adr/ADR-2026-07-16-formal-release-readiness-modular-monolith.md`。

## 2. 当前运行架构

### 2.1 体验层

| 实体 | 当前状态 | 职责 |
| --- | --- | --- |
| `frontend/src/components/chat/FamsChatBox.tsx` | 已开发并验收 | 普通用户第一入口、受控 intent、结构化结果、数据健康和交易阻断解释 |
| `frontend/src/pages/Dashboard.tsx` | 已开发并验收 | 普通用户工作台、资产/任务/风险摘要 |
| `frontend/src/pages/Assets.tsx` | 已开发并验收 | 本地资产账本、Excel 模板/预览/导入/导出 |
| `frontend/src/pages/Backtest.tsx` | 已开发并验收，release 视图待增强 | 组合比较、收益/回撤、数据等级、validation 和 release blockers |
| `frontend/src/pages/DividendLowVol.tsx` | 已开发并验收，正式证据待增强 | 候选、观察区间、回测和人工计划草案 |
| `frontend/src/pages/Operations.tsx` | 已开发并验收，签核视图待增强 | Operation、artifactRefs、失败原因和审计报告 |
| `frontend/src/pages/Analysis.tsx` | 已开发并验收 | 专家分析和 gate 解释 |
| `frontend/src/pages/DailyReviews.tsx` | 已开发并自动验收，人工体验待执行 | 每日持仓复盘、支付宝一键复核、审计 DAG 和人工计划决定 |
| `frontend/src/pages/PortfolioComparison.tsx` | 已开发并自动验收，人工体验待执行 | 持久化十组组合比较和连续/重启双窗口径 |
| `frontend/src/pages/RelativeRotation.tsx` | 已开发并自动验收 | 观察池、组合 RRG、研究工作台和行业拥挤度 |
| `frontend/src/pages/Positions.tsx` | 已开发并自动验收 | 账户分组、配置偏离和资产明细；不创建订单 |

ChatBox 是第一入口但不是唯一入口；上述专家页必须继续保留。

### 2.2 API 与应用层

| 实体 | 当前状态 | 职责 |
| --- | --- | --- |
| `backend/src/routes/chat.ts` | 已开发并验收 | ChatBox 消息、SSE、确认和会话 |
| `backend/src/routes/portfolioBacktest.ts` | 已开发并验收 | 回测、review、Operation artifact 和 13-18 audit 输出 |
| `backend/src/routes/strategy.ts` | 已开发并验收 | 红利低波候选、观察区间、rolling validation |
| `backend/src/routes/operation.ts` | 已开发并验收 | 任务与 artifact 追溯 |
| `backend/src/routes/dailyReview.ts` | 已开发并自动验收 | 每日复盘、一键研究、工作流授权、调度和人工计划决定 |
| `backend/src/routes/relativeRotation.ts` | 已开发并自动验收 | 观察池、组合 RRG、研究运行和行业拥挤度 |
| `backend/src/routes/formalRelease.ts` | 已开发，业务 gate blocked | 正式 provider 授权、Benchmark 导入、签核和 review package 受控 API |
| `PortfolioBacktestInputBuilder` | 已开发并验收 | 构建持仓、永久组合、全天候、红利低波和自定义输入 |
| `portfolioBacktestReviewService` | 已开发，签核能力不足 | 保存复核材料；不能创建订单 |
| `operationService` | 已开发并验收 | 持久化任务状态和 artifact refs |

### 2.3 回测、数据与 Gate

| 实体 | 当前状态 | 职责/缺口 |
| --- | --- | --- |
| `PortfolioBacktestEngine` | 已开发并验收 | 计算策略曲线、成本、收益与回撤；正式 release 决策由独立服务复核 |
| `portfolioBenchmarkService` | 已开发，formal trading blocked | 提供 price index、research proxy、free-source total return |
| `formalProviderIngestionService` | 已开发基础，覆盖域有限 | 红利低波 provider 导入，不是组合级统一正式数据服务 |
| `marketDataFreshnessService` | 已开发 | 本地缓存 freshness；部分候选仍 unknown/blocked |
| `market_bar_canonical` | 已开发 | 历史行情缓存和 evidence |
| `market_tradeability_daily` | 已开发 | 停牌/涨跌停/可交易性研究证据 |
| `DividendLowVolDaily` | 已开发 | 红利低波候选与研究级分红/质量证据 |
| `buildDataGovernanceAudit` | 已开发内嵌 | 合同可生成，业务 gate blocked |
| `buildBenchmarkQualificationAudit` | 已开发内嵌 | formal review 可用，官方/可信资格未通过 |
| `buildFormalValidationAudit` | 已开发内嵌 | 当前 `insufficient`、`0/7 passed` |
| `buildManualSignoffAudit` | 已开发内嵌 | 五角色全部 missing |
| `buildExecutionIsolationAudit` | 已开发内嵌 | paper/sandbox ready，生产适配器 disabled |
| `buildReleaseGateAudit` | 已开发内嵌 | 正确输出 blocked，不是正式 release 通过 |
| `AlipayOneClickReviewService` / `AlipayResearchWorkflowService` | 已开发并自动验收 | 私有真实账户输入上的一键复核、持久化研究、调度与双窗口径；人工体验待执行 |
| `portfolioRelativeRotationService` / `relativeRotationResearchStudyService` | 已开发并自动验收 | 当前组合 RRG 与研究运行；研究结果不进入正式交易 |
| `sqliteWriterLock` | 已开发并回归 | SQLite 单写者租约、陈旧锁恢复和启动保护 |

## 3. Formal Release Readiness 工程实现状态

以下应用/领域服务已在模块化单体内实现。表中的待办是外部数据或人工业务门禁，不是“服务文件尚未开发”：

| 目标实体 | 来源 | 输入 | 输出 | 状态 |
| --- | --- | --- | --- | --- |
| `FormalDataProviderService` | `formalProviderIngestionService` + provider adapters | candidate、字段、日期范围、授权上下文 | `FormalDataSnapshot` | 工程已实现；正式授权/覆盖 gate blocked |
| `FormalDataFreshnessPolicy` | `marketDataFreshnessService` | 市场日历、provider SLA、asOfDate | freshness decision | 工程已实现；需正式数据证明 |
| `FieldEvidenceValidator` | data governance builder | snapshot、coverage、evidenceRefs | FTR-1 gate result | 工程已实现；业务结果 blocked |
| `FormalBenchmarkService` | `portfolioBenchmarkService` + benchmark builder | benchmark snapshot、授权证据 | FTR-2 gate result | 工程已实现；无合格 official/trusted 导入 |
| `FormalValidationService` | validation builder | candidate set、曲线、benchmark、约束 | FTR-3 gate result | 工程已实现；当前 insufficient、0/7 passed |
| `ManualSignoffService` | review service + signoff builder | immutable artifacts、reviewer context | FTR-4 signoff records | 工程已实现；五角色签核 missing |
| `ExecutionIsolationService` | isolation builder + blocker | paper intents、runtime route | FTR-5 gate result | 工程已实现并通过；production disabled |
| `ReleaseGateService` / `FormalReleasePackageService` | release gate builder | FTR-1 至 FTR-5 结果 | review package | 工程已实现；业务 gate blocked |

`PortfolioBacktestEngine` 目标只负责输入重放、交易约束、成本、收益、回撤和策略结果，不再自行决定 provider 授权、人工签核或 release 状态。

## 4. 交互与依赖方向

```text
FamsChatBox / Backtest / DividendLowVol
  -> chat.ts / portfolioBacktest.ts / strategy.ts
  -> PortfolioBacktestInputBuilder
  -> PortfolioBacktestEngine
  -> FormalDataProviderService
  -> BenchmarkQualificationService
  -> FormalValidationService
  -> ManualSignoffService
  -> ExecutionIsolationService
  -> ReleaseGateService
  -> operationService / 13-18 audit / HTML report
  -> Operations / Backtest / ChatBox explanation
```

依赖规则：

- `ReleaseGateService` 只消费 gate result，不调用外部 provider，不重新计算回测。
- `ManualSignoffService` 只允许授权用户写入，不接受 LLM/Agent 自签核。
- provider secret 只存在于服务配置，不进入 DTO、日志和 artifact。
- 前端只显示 gate 结果和可执行的恢复动作，不根据 UI 状态自行推导交易权限。
- 任一入口都必须读取同一交易边界合同。

## 5. 状态演进关系

```text
S0-S8 accepted
  -> FTR-0..FTR-6 engineering implemented
  -> PRD/state/architecture baseline reconciled
  -> FTR-1 formal data passed
  -> FTR-2 benchmark qualified
  -> FTR-3 release candidates validated
  -> FTR-4 human signoff passed
  -> FTR-5 execution isolation passed, production disabled
  -> FTR-6 release review package ready
  -> human release decision outside automated development
```

自动化目标状态：

```text
formalTradingReleaseReviewReady=true
releaseApprovalStatus=pending_human_approval
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 6. 风险与技术路线

| 风险 | 影响 | 采用路线 | 未采用路线及原因 |
| --- | --- | --- | --- |
| 正式 provider 或授权不可获得 | FTR-1 不能通过 | 免费源继续研究，正式 gate 保持 blocked | 伪装为 official 会造成虚假验收 |
| 官方 total-return benchmark 不可获得 | FTR-2 不能通过 | 允许经授权复核的 trusted benchmark | research proxy 不能用于 formal pass |
| 统计结果长期不足 | FTR-3 不能通过 | 扩大真实样本和窗口，保留失败结果 | 降低阈值只为判绿不可接受 |
| 多角色签核无法及时完成 | FTR-4 blocked | 明确责任人和 artifact hash，等待人工 | 自动签核不允许 |
| 生产订单风险 | 真实资金风险 | 生产适配器保持 disabled | 在同阶段启用会把评审与执行混在一起 |
| 引擎职责过重 | 维护和测试耦合 | 模块化单体内拆服务 | 立即微服务化扩大风险且不关闭 blocker |

## 7. 架构出门条件

人类必须能从文档和 drawio 回答：

1. 哪些实体已经存在，哪些只是引擎内嵌实现，哪些尚未开发。
2. 每个目标 Service 从哪个当前实体演进而来。
3. 用户从哪个页面触发、看见什么结果、在哪里追溯证据。
4. 每个 FTR gate 的机器门槛、人工门槛和失败归属。
5. 为什么 release review ready 仍不等于正式交易 unlocked。

无法回答任一问题，架构文档不得出门。
