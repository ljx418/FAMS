# FAMS 当前架构与下一阶段目标架构

更新时间：2026-07-16

## 1. 架构结论

FAMS 当前是 React/Vite + Fastify + Prisma/SQLite 的模块化单体。S0-S8 已完成 ChatBox、普通用户工作台、专家多 Tab、资产 Excel、真实数据研究回测、Operation 审计、release gate 合同和交易阻断。下一阶段不重写系统，只从现有回测引擎中拆分 Formal Release Readiness 的决策职责。

```text
当前能力：research / formal-review-ready / manual draft / paper-sandbox audit
下一阶段目标：formal release review package ready
不在本阶段：production order enablement / AUTO_TRADE / unattended release
```

权威状态：`docs/current-stage-state.json`。

架构决策：`docs/adr/ADR-2026-07-16-formal-release-readiness-modular-monolith.md`。

## 2. 当前运行架构

### 2.1 体验层

| 实体 | 当前状态 | 职责 |
| --- | --- | --- |
| `frontend/src/components/FamsChatBox.tsx` | 已开发并验收 | 普通用户第一入口、受控 intent、结构化结果、数据健康和交易阻断解释 |
| `frontend/src/pages/Dashboard.tsx` | 已开发并验收 | 普通用户工作台、资产/任务/风险摘要 |
| `frontend/src/pages/Assets.tsx` | 已开发并验收 | 本地资产账本、Excel 模板/预览/导入/导出 |
| `frontend/src/pages/Backtest.tsx` | 已开发并验收，release 视图待增强 | 组合比较、收益/回撤、数据等级、validation 和 release blockers |
| `frontend/src/pages/DividendLowVol.tsx` | 已开发并验收，正式证据待增强 | 候选、观察区间、回测和人工计划草案 |
| `frontend/src/pages/Operations.tsx` | 已开发并验收，签核视图待增强 | Operation、artifactRefs、失败原因和审计报告 |
| `frontend/src/pages/Analysis.tsx` | 已开发并验收 | 专家分析和 gate 解释 |

ChatBox 是第一入口但不是唯一入口；上述专家页必须继续保留。

### 2.2 API 与应用层

| 实体 | 当前状态 | 职责 |
| --- | --- | --- |
| `backend/src/routes/chat.ts` | 已开发并验收 | ChatBox 消息、SSE、确认和会话 |
| `backend/src/routes/portfolioBacktest.ts` | 已开发并验收 | 回测、review、Operation artifact 和 13-18 audit 输出 |
| `backend/src/routes/strategy.ts` | 已开发并验收 | 红利低波候选、观察区间、rolling validation |
| `backend/src/routes/operation.ts` | 已开发并验收 | 任务与 artifact 追溯 |
| `PortfolioBacktestInputBuilder` | 已开发并验收 | 构建持仓、永久组合、全天候、红利低波和自定义输入 |
| `portfolioBacktestReviewService` | 已开发，签核能力不足 | 保存复核材料；不能创建订单 |
| `operationService` | 已开发并验收 | 持久化任务状态和 artifact refs |

### 2.3 回测、数据与 Gate

| 实体 | 当前状态 | 职责/缺口 |
| --- | --- | --- |
| `PortfolioBacktestEngine` | 已开发并验收，职责过重 | 计算策略曲线，同时内嵌六类 release audit 构建逻辑 |
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

## 3. 目标架构

下一阶段保持同进程、同数据库和现有 API，拆出以下应用/领域服务：

| 目标实体 | 来源 | 输入 | 输出 | 状态 |
| --- | --- | --- | --- | --- |
| `FormalDataProviderService` | `formalProviderIngestionService` + provider adapters | candidate、字段、日期范围、授权上下文 | `FormalDataSnapshot` | 待新增 |
| `FormalDataFreshnessPolicy` | `marketDataFreshnessService` | 市场日历、provider SLA、asOfDate | freshness decision | 待新增 |
| `FieldEvidenceValidator` | 引擎 data governance builder | snapshot、coverage、evidenceRefs | FTR-1 gate result | 待新增 |
| `BenchmarkQualificationService` | `portfolioBenchmarkService` + benchmark builder | benchmark snapshot、授权证据 | FTR-2 gate result | 待新增 |
| `FormalValidationService` | 引擎 validation builder | candidate set、曲线、benchmark、约束 | FTR-3 gate result | 待新增 |
| `ManualSignoffService` | review service + signoff builder | immutable artifacts、reviewer context | FTR-4 signoff records | 待新增 |
| `ExecutionIsolationService` | isolation builder + blocker | paper intents、runtime route | FTR-5 gate result | 待拆分 |
| `ReleaseGateService` | release gate builder | FTR-1 至 FTR-5 结果 | review package | 待新增 |

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
  -> FTR-0 documentation frozen
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
