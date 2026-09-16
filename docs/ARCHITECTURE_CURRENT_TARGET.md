# FAMS 当前架构与下一阶段目标架构

更新时间：2026-09-16

## 1. 架构结论

FAMS 当前是 React/Vite + Fastify + Prisma/SQLite 的模块化单体。已完成 ChatBox、普通用户工作台、专家多 Tab、资产 Excel、三类资产策略路由、行业轮动网格、红利低波建议、组合策略、统一场景比较、每日持仓复盘、RRG、真实数据研究回测、Operation 审计、Formal Release Readiness 工程服务和交易阻断。FTR 与投资工作流的文档支撑自动化范围均已实现；当前仍需集中人工验收，并另行实现建议级冻结策略逐日重算，不能声明 PRD 全部完成。

```text
当前能力：research / formal-review-ready / manual draft / paper-sandbox audit / FTR engineering complete
当前自动化结果：FTR provisional chain passed + investment workflow WF-0..7 passed + PRD 18/20
剩余目标：batch human acceptance -> dynamic point-in-time advice replay -> final review package
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
| `frontend/src/components/investment-workflow/*` | 已开发并自动验收，人工语义确认待执行 | 三类资产归属、策略入口、场景比较、数据健康和受控阻断 |

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
| `backend/src/routes/investmentWorkflow.ts` | 已开发并自动验收 | readiness、策略归属、策略运行和场景比较；不创建订单 |
| `PortfolioBacktestInputBuilder` | 已开发并验收 | 构建持仓、永久组合、全天候、红利低波和自定义输入 |
| `portfolioBacktestReviewService` | 已开发，签核能力不足 | 保存复核材料；不能创建订单 |
| `operationService` | 已开发并验收 | 持久化任务状态和 artifact refs |

### 2.3 回测、数据与 Gate

| 实体 | 当前状态 | 职责/缺口 |
| --- | --- | --- |
| `PortfolioBacktestEngine` | 已开发并验收 | 计算策略曲线、成本、收益与回撤；正式 release 决策由独立服务复核 |
| `portfolioBenchmarkService` | 已开发，formal trading blocked | 提供 price index、research proxy、free-source total return |
| `formalProviderIngestionService` | 已开发基础，已被正式链编排 | 红利低波 provider 导入；组合级正式证据由 `FormalDataProviderService` 和 point-in-time 服务治理 |
| `marketDataFreshnessService` | 已开发并进入 FTR-1 | 本地缓存 freshness 与正式时点门禁；当前冻结候选已通过，不能外推到任意新输入 |
| `market_bar_canonical` | 已开发 | 历史行情缓存和 evidence |
| `market_tradeability_daily` | 已开发 | 停牌/涨跌停/可交易性研究证据 |
| `DividendLowVolDaily` | 已开发 | 红利低波候选与研究级分红/质量证据 |
| `buildDataGovernanceAudit` | 历史内嵌实现，已由 FTR-1 服务链取代 | 当前正式链为 5216/5216、六时点 6/6 ready；新输入必须重新验证 |
| `buildBenchmarkQualificationAudit` | 历史内嵌实现，已由 FTR-2 服务链取代 | H00300 `trusted_total_return` 已通过冻结重放，不宣称商业授权 |
| `buildFormalValidationAudit` | 历史内嵌实现，已由 FTR-3 服务链取代 | 当前产品候选 5/6 窗口、53 路径，`wf-04` 失败保留 |
| `buildManualSignoffAudit` | 历史内嵌实现；正式签核仍 pending | A6 反馈草稿不可代替 `ManualSignoffRecord` |
| `buildExecutionIsolationAudit` | 历史内嵌实现，已由 FTR-5 服务链取代 | 隔离回归通过；paper/sandbox only，生产适配器 disabled |
| `buildReleaseGateAudit` | 历史内嵌实现，已由 FTR-6 provisional package 取代 | 28 个来源 artifact 已冻结；业务 release 仍因人工门禁 blocked |
| `AlipayOneClickReviewService` / `AlipayResearchWorkflowService` | 已开发并自动验收 | 私有真实账户输入上的一键复核、持久化研究、调度与双窗口径；人工体验待执行 |
| `portfolioRelativeRotationService` / `relativeRotationResearchStudyService` | 已开发并自动验收 | 当前组合 RRG 与研究运行；研究结果不进入正式交易 |
| `sqliteWriterLock` | 已开发并回归 | SQLite 单写者租约、陈旧锁恢复和启动保护 |
| `PositionStrategyAssignmentService` | 已开发并自动验收，人工确认待执行 | 将同花顺轮动/红利资产与支付宝组合资产映射到默认策略；16 个真实持仓当前待确认 |
| `RotationVolatilityStrategyService` | 已开发并自动验收 | RRG + MACD + 均线 + 成交量，输出研究级波动交易网格 |
| `AlipayAllocationStrategy` | 已开发并自动验收 | 年前高防御、年后永久组合的受控配置策略 |
| `ScenarioComparisonService` | 已开发并自动验收，动态模拟待补 | 统一比较 actual/hold/follow_advice；当前不具备冻结策略逐日动态重算能力 |

## 3. Formal Release Readiness 工程实现状态

以下应用/领域服务已在模块化单体内实现。表中的待办是外部数据或人工业务门禁，不是“服务文件尚未开发”：

| 目标实体 | 来源 | 输入 | 输出 | 状态 |
| --- | --- | --- | --- | --- |
| `FormalDataProviderService` | `formalProviderIngestionService` + free-source adapters | candidate、字段、日期范围、冻结用途上下文 | `FormalDataSnapshot` | 当前候选 FTR-1 point-in-time v2 已通过；只对冻结输入成立 |
| `PointInTimeDataProviderService` / `FreePointInTimeSnapshotService` | provider contract + 开源数据湖 | 六个冻结决策日、5,216 标的、直接历史状态和公告日截断 | 单日历史 universe、行情、状态、公告日前财务/分红、行业和 raw hash | 免费来源正式回填 6/6 ready；Tushare 路线保留但不再是当前前置依赖 |
| `FormalDataFreshnessPolicy` | `marketDataFreshnessService` | 市场日历、provider SLA、asOfDate | freshness decision | 工程已实现；当前冻结证据通过 |
| `FieldEvidenceValidator` | data governance builder | snapshot、coverage、evidenceRefs | FTR-1 gate result | 工程已实现；当前冻结证据通过 |
| `FormalBenchmarkService` | `portfolioBenchmarkService` + benchmark builder | benchmark snapshot、授权证据 | FTR-2 gate result | 工程已实现；H00300 trusted total-return provisional 通过，不宣称商业授权 |
| `FormalValidationService` | validation builder | A0-v2 candidate/profile、FTR-1-v2、FTR-2-v2、R1 六时点结果 | FTR-3 point-in-time v2 gate result | 正式链已通过：5/6 窗口、53 条动态路径、6/3/3 分组；人工模型复核 pending |
| `FTR-3R0 Point-in-time Data Gate` | `freePointInTimeSnapshotService.ts` + FREE-P1/R0/R1 scripts | 六个冻结决策点、5,216 标的开源湖、直接历史状态和公告日截断 | 历史覆盖/前视偏差/准入 artifact | 免费来源回填与独立验收 6/6 ready；不再依赖 Tushare token |
| `DeferredHumanReviewQueueService` | A0、FTR-1..5 artifact | 8 类证据引用、SHA-256、失败归属 | FTR-4 queue | 工程已实现；8 pending、0 approved |
| `HumanAcceptanceDraftService` + `/human-review-drafts/current` | FTR-6 provisional manifest + FTR-4 queue | 人类反馈、证据相对路径、乐观锁 revision | `.verification/private` A6 草稿 | 工程与 32/32 步配图工作台已验收；28 张证据图、4 张非证据操作示意；只生成草稿，不创建官方签核 |
| `ManualSignoffService` | review service + signoff builder | immutable artifacts、授权 reviewer context | FTR-4 signoff records | 工程已实现；正式签核仍 pending |
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
  -> FormalBenchmarkService.qualificationAudit
  -> FormalValidationService
  -> DeferredHumanReviewQueueService（已实现，冻结 8 类证据引用、哈希和 rollbackStage）
  -> HumanAcceptanceDraftService（已实现，仅保存私有 A6 反馈草稿）
  -> ManualSignoffService
  -> ExecutionIsolationService
  -> ReleaseGateService
  -> operationService / 13-18 audit / HTML report
  -> Operations / Backtest / ChatBox explanation

Assets / Positions / RelativeRotation / DividendLowVol / Backtest / DailyReviews
  -> position.ts / investmentWorkflow.ts / backtest.ts / dailyReview.ts
  -> PositionStrategyAssignmentService
  -> RotationVolatilityStrategyService / DividendLowVolStrategyService / AlipayAllocationStrategy
  -> ScenarioComparisonService
  -> Operation / WF audit artifacts
  -> ChatBox / expert pages / DailyReviews explanation
```

依赖规则：

- `ReleaseGateService` 只消费 gate result，不调用外部 provider，不重新计算回测。
- `ManualSignoffService` 只允许授权用户写入，不接受 LLM/Agent 自签核。
- provider secret 只存在于服务配置，不进入 DTO、日志和 artifact。
- 前端只显示 gate 结果和可执行的恢复动作，不根据 UI 状态自行推导交易权限。
- 任一入口都必须读取同一交易边界合同。
- 场景比较只消费已声明的数据与 advice artifact；在 `point_in_time_simulation` 完成前，不得把静态建议外推冒充逐日历史建议。

## 5. 状态演进关系

```text
S0-S8 accepted + FTR services implemented
  -> A0 provider/benchmark authorization and candidate set frozen
  -> A1 FTR-1 formal data automated checks
  -> A2 FTR-2 benchmark automated checks
  -> A3 FTR-3 point-in-time v2 validation (5/6, automated pass, human review pending)
  -> A3R0A open-source source feasibility (live probes complete)
  -> A3R0B open-source batch adapter and full backfill (complete)
  -> A3R0C six-date point-in-time backfill (complete, 6/6 ready)
  -> A3R1 redesigned candidate and validation rerun (complete)
  -> A4 FTR-5 execution isolation regression, production disabled
  -> A5 provisional review package + DeferredHumanReviewQueue
  -> A6 one consolidated human acceptance batch
  -> A7 final formal-release review package
  -> separate future production-unlock stage

WF-0..WF-7 documented automated scope (complete, PRD 18/20)
  -> concentrated human correction/assignment/UX review (pending)
  -> advice-level point-in-time dynamic replay stage (not implemented)
  -> PRD traceability rerun (must reach 20/20 before full-completion claim)
```

自动化目标状态：

```text
batchHumanReviewReady=true before A6
finalFormalReleaseReviewPackageReady=true only after A6 passes
releaseApprovalStatus=pending_human_approval for separate production unlock
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
| 统计结果长期不足 | FTR-3 不能通过 | v2 已通过 5/6，但 `wf-04` 失败继续保留并进入人工模型复核 | 降低阈值、挑选窗口或替换 benchmark 只为判绿不可接受 |
| 历史 point-in-time 数据不足 | 候选重构会产生前视/幸存者偏差 | 六个冻结决策点分别补历史 universe、公告日前事实、状态、行情和快照，全部 >=80% 后才编码策略 | 用 2026-09 当前 8 只回填过去不可接受 |
| 多角色签核打断自动化开发 | 无法连续完成 A1-A5 | 先冻结 provisional artifact，A6 集中签核；失败按依赖图打回 | 自动签核或删除人工 gate 不允许 |
| 生产订单风险 | 真实资金风险 | 生产适配器保持 disabled | 在同阶段启用会把评审与执行混在一起 |
| 引擎职责过重 | 维护和测试耦合 | 模块化单体内拆服务 | 立即微服务化扩大风险且不关闭 blocker |
| 静态 advice 冒充历史动态 advice | 产生前视偏差和虚假回测 | 独立实现冻结策略、逐日输入、逐日 advice、幂等重放和 artifact hash | 用当前建议回填整个历史区间不可接受 |
| 持仓策略归属误判 | 错误策略作用于真实资产 | 自动建议 + 人工逐持仓确认；确认前保持 pending | 根据账户来源直接永久写死归属不可接受 |

## 7. 架构出门条件

人类必须能从文档和 drawio 回答：

1. 哪些实体已经存在，哪些只是引擎内嵌实现，哪些尚未开发。
2. 每个目标 Service 从哪个当前实体演进而来。
3. 用户从哪个页面触发、看见什么结果、在哪里追溯证据。
4. 每个 FTR gate 的机器门槛、集中人工门槛、证据失效规则和失败归属。
5. 为什么 release review ready 仍不等于正式交易 unlocked。
6. 为什么 WF-0..WF-7 自动通过仍不等于投资工作流 PRD 20/20，以及动态时点模拟需要哪些新证据。

无法回答任一问题，架构文档不得出门。
