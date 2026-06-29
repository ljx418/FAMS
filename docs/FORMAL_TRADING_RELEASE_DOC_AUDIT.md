# 正式交易 Release 文档审计

更新时间：2026-06-29

## 1. 审计结论

```text
status = pass_formal_trading_release_docs_for_planning
formalTradingReleaseReady = false
formalTradingEligible = false
formalTradingUnlocked = false
autoTradeUnlocked = false
canCreateOrder = false
orderCreateAllowed = false
```

本轮文档审计结论：当前文档已经可以支撑“正式交易 release 的后续开发规划和验收设计”，但不能声明系统已经进入正式交易 release。文档新增了 release 阶段的目标体验、目标架构、开发计划、里程碑、验收门槛和出门条件，同时保留当前交易锁定边界。

2026-06-29 实施复核结论：已按当前阶段目标完成一轮文档收口。PRD、组合回测计划、目标架构、drawio 摘要、drawio 本体、read-drawio 输出和数据可信文档审计已同步到“formal-review-ready / release-blocked”口径。当前可以指导 FTR-1 到 FTR-6 的后续自动化开发，但仍不能声明正式交易 release。

```text
documentationStageImplemented=true
drawioPageCount=7
drawioPageLimit=8
documentationSupportsFTR1ToFTR6=true
formalTradingReleaseReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

2026-06-25 追加审计结论：已按外部审计意见完成一轮文档核查和 drawio 重排。当前 `target-architecture-gap.drawio` 为 7 页，页数不超过 8 页；每页均使用中文，并以真实页面、API、服务、数据实体和审计产物为节点。图中以灰色、黄色、橘黄、红色区分已实现、需修改、需新增和硬边界，避免把 formal-review-ready 误写为 formal-trading-ready。

2026-06-25 第 2 页可读性修订：已将“当前架构与目标架构差异”从粗粒度色块改为 5 行 × 5 列泳道矩阵。矩阵按前端、API、服务、数据、审计/Gate 分层，每层固定表达“当前实现 -> 需修改/补齐 -> 目标新增能力 -> 不可绕过边界 -> 用户出门体验”，并绑定真实实现实体和审计产物。该页现在可以直接说明目标架构如何从当前架构演进，而不是只展示概念列表。

2026-06-25 支撑度复核结论：当前文档水平可以完整支撑本阶段 FTR-1 到 FTR-6 的自动化开发、阶段验收和出门审计；本阶段开发完成后可以达成“正式交易 release 前置材料完整、可进入人工评审”的目标体验。当前文档不支持、也不承诺在缺少正式数据源、官方或可信 benchmark、formal validation passed、人工签核 passed 的情况下进入正式交易 release。

2026-06-26 文档执行更新：已将最新交互式策略回测审计包 `backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md` 作为当前状态源，同步到 PRD、目标架构、drawio 摘要和审计入口。旧审计包只保留为历史验收记录，不再作为当前状态源。

2026-06-26 长周期真实数据回测文档校准：当前可以声明 `portfolioBacktestFormalReviewReady=true`、`multiPeriodReplayMaterialized=true` 和 `longHorizonRealDataBacktestReady=true`。本轮已用免费真实数据源补齐核心组合样本，1 年 `96.43%`、3 年 `95.90%`、5 年 `95.71%`、自定义区间 `94.49%`，7 个策略均可比较。该校准不改变 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。

2026-06-26 文档开发校准：本轮将“长周期真实数据回测”从待办主线移动为已完成的 formal-review-ready 基线，并将后续开发计划重排为 FTR-1 到 FTR-6：正式数据治理、可信 total-return benchmark、formal validation、人工签核、执行隔离、release gate。该调整避免文档继续承诺已经完成的 long-horizon replay，同时保留正式交易 release 的真实阻断项。

2026-06-26 FTR-1 字段级数据治理文档收口：最新审计包 `backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/15_release_data_governance_audit.json` 已证明 release data governance 的关键字段包含 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / coverageStatus / crossCheckStatus / evidenceRefs`。其中价格、benchmark、分红和交易约束字段均有 `asOfDate=2026-06-05`；前端 runtime 验收路径为 `backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-12-17-124Z/03_frontend_runtime_and_operation_audit.json`。该结论只说明字段级审计更完整，仍不代表 official provider、官方 benchmark、formal validation 或人工签核已通过。

2026-06-25 风险路线补充：已在 release 开发验收计划、目标架构和 drawio 摘要中集中记录免费源覆盖不足、total-return benchmark 缺失、交易约束不完整、formal validation 不足和人工签核缺失五类高风险点。当前推荐路线为“免费源 + 本地缓存 + 严格 evidence/freshness + proxy 明示 + 后续正式 provider 升级”。该路线可以支撑 research / formal-review-ready 和用户路径打通；不能直接支撑正式交易 release。

## 2. 本轮新增和修订

- 新增 `docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md`。
- 更新 `docs/DIVIDEND_LOW_VOL_PRD.md`，补充红利低波进入正式交易 release 的前置条件。
- 更新 `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`，把 formal-review-ready 与 formal trading release 拆开。
- 更新 `docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`，补充 release 计划入口。
- 更新 `docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md`，补充 M8/M9 里程碑。
- 更新 `docs/ARCHITECTURE_CURRENT_TARGET.md` 与 `docs/TARGET_ARCHITECTURE_GAP.md`，补充 release 目标架构和硬边界。
- 更新 `docs/target-architecture-gap.drawio` 与 `docs/drawio-summary.txt`，在 7 页内补充 FTR-1 到 FTR-6 release 路线。
- 更新 `docs/read-drawio-output.txt`，保存 drawio 本体解析结果。
- 更新 `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md` 与 `docs/TARGET_ARCHITECTURE_GAP.md`，同步 2026-06-25 最新审计状态和 release blockers。
- 更新 `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、`docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md`、`docs/ARCHITECTURE_CURRENT_TARGET.md` 和 drawio，记录多区间 replay 与长周期覆盖已达到 formal-review-ready，后续开发聚焦正式数据治理、可信 benchmark、formal validation、人工签核和 release gate。
- 更新当前状态源为 `2026-06-26T13-10-58-875Z` 审计包，并记录 `2026-06-26T13-12-17-124Z` 前端 runtime 证据。
- 本轮重排 `docs/target-architecture-gap.drawio`，将页面固定为：
  1. 目标体验与用户路径
  2. 当前架构与目标架构差异
  3. 长周期组合回测目标架构
  4. 数据治理与真实数据链路
  5. 模型验证与 Release Gate
  6. 开发及验收计划
  7. 里程碑与出门条件
- 本轮继续细化第 2 页，新增分层泳道和横向演进关系：
  - 前端：`DividendLowVol.tsx / Backtest.tsx / Operations.tsx / Analysis.tsx`
  - API：`strategy.ts / portfolioBacktest.ts / operation.ts / analysis/fivd-r routes`
  - 服务：`dividendLowVolStrategyService / dividendLowVolTradingZoneService / PortfolioBacktestEngine / portfolioBacktestReviewService`
  - 数据：`SQLite/Prisma / DividendLowVolDaily / market_bar_canonical / market_tradeability_daily / free-source benchmark`
  - 审计/Gate：`09-12` 当前审计产物到 `13-18` release 审计产物

## 2.1 本轮代码实现进展

本轮已把 release 文档中的 FTR-5 / FTR-6 关键前置能力落到代码路径：

```text
FTR-5 Paper/sandbox 执行隔离：已实现 paperOrderIntents 与 executionIsolationAudit。
FTR-6 Release gate audit：已实现 releaseGateAudit，并进入 API 返回、Operation artifact 和 GPT 审计包。
```

实现边界：

```text
productionAdapterEnabled=false
realPositionMutationAllowed=false
orderCreateAllowed=false
canCreateOrder=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

当前不是正式交易 release，只是把正式交易前的纸面/沙盒复核材料和 release gate 阻断清单标准化。FTR-1 正式数据源、FTR-2 官方/可信 total-return benchmark、FTR-3 formal validation、FTR-4 多角色人工签核仍是后续正式 release 的核心阻断项。

2026-06-25 追加实现：

```text
FTR-1 Release Data Governance：已实现 dataGovernanceAudit，按字段展示来源、覆盖率、新鲜度、交叉验证状态和 blocker。
FTR-2 Benchmark Qualification：已实现 benchmarkQualificationAudit，区分 formal_total_return、free_source_total_return、price_index、research_proxy。
FTR-3 Formal Validation：已实现 formalValidationAudit，聚合 OOS、walk-forward、参数敏感性、分组稳定性和 failure taxonomy。
FTR-4 Manual Signoff：已实现 manualSignoffAudit 和 review role 字段，默认缺少 data/model/risk/compliance/final_release 签核并阻断 release。
```

实现边界保持：

```text
free_source_total_return 可支持 formal-review-ready，但不能支持 formal-trading-release。
formal validation 为 warning/insufficient 时不得升级 passed。
manual signoff 缺任一角色时 formalTradingUnlocked=false。
```

本轮新增审计产物：

```text
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/13_execution_isolation_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/14_formal_trading_release_gate_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/15_release_data_governance_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/16_benchmark_qualification_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/17_formal_validation_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/<timestamp>/18_manual_signoff_audit.json
```

## 3. Release 文档覆盖范围

当前 release 文档覆盖以下开发目标：

| 目标 | 文档状态 | 说明 |
| --- | --- | --- |
| 正式数据源与数据治理 | 已定义 | 字段级 provider contract、freshness、coverage、evidenceRefs。 |
| 官方或可信 total-return benchmark | 已定义 | 区分 formal、free-source、price-index、proxy、unavailable。 |
| Formal validation | 已定义 | OOS、walk-forward、参数敏感性、行业/市场/流动性分组稳定性。 |
| 人工签核 | 已定义 | 数据、模型、风控、合规、最终 release 签核。 |
| Paper/sandbox 执行隔离 | 已定义 | 不影响真实持仓，不回退到实盘路径。 |
| Release gate audit | 已定义 | 汇总 runtime、provider、benchmark、validation、signoff、execution isolation。 |

## 3.1 支撑度与剩余风险

```text
documentationSupportsCurrentStageDevelopment=true
documentationSupportsExitAcceptance=true
documentationSupportsFormalTradingReleaseWithoutExternalEvidence=false
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_release_gate
```

当前无需继续修订文档才能进入下一轮自动化开发。仍需在开发阶段按 gate 真实关闭以下 blocker：

| 风险 | 当前处理 | 若无法关闭的结果 |
| --- | --- | --- |
| 正式 provider 不可用 | 保留 free source 为 research/fallback，并要求 `dataGovernanceAudit.status=blocked` | 可进入 formal review，但不能 release 正式交易 |
| 官方或可信 total-return benchmark 不可用 | `benchmarkQualificationAudit.status=review_ready`，proxy 不升级 formal | 回测可展示，formal validation 不能 passed |
| Formal validation 不通过 | `formalValidationAudit.status=warning/failed` 阻断 release | 策略只能研究和人工计划草案 |
| 人工签核缺失 | `manualSignoffAudit.status=missing` 阻断 release | 不能解锁订单创建 |
| 执行隔离未通过 | `executionIsolationAudit` 不得变为 passed | paper/sandbox 不能进入 release 评审 |

备选技术路线：

| 路线 | 优点 | 代价 | 适用条件 |
| --- | --- | --- | --- |
| A. 正式 provider 优先 | 最接近正式交易 release，审计可信度最高 | 需要采购、凭证、限速、字段对账 | 目标是尽快推动正式 release |
| B. 免费源 research/fallback 继续推进 | 开发速度快，适合完善体验和审计链路 | 只能 formal-review-ready，不能 release | 目标是先打通用户体验和审计闭环 |
| C. 混合路线 | 用免费源保持研发速度，同时并行接正式 provider | 管理复杂度较高，需要清晰 dataGrade | 推荐路线，能兼顾速度和真实 release 前置 |

## 4. 交易边界检查

Hard-fail 状态当前未被声明：

```text
formalTradingUnlocked 被写成 true
autoTradeUnlocked 被写成 true
canCreateOrder 被写成 true
orderCreateAllowed 被写成 true
ORDER_CREATE 不得放行
AUTO_TRADE 不得放行
正式交易被描述为已解锁
交易被描述为已解锁
```

当前文档允许出现 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`，但必须处在禁止、非目标、阻断或边界说明语境下。

本轮 hard-fail 检查口径：

```bash
P_TRUE="true"
rg -n "formalTradingUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|autoTradeUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|orderCreateAllowed[[:space:]]*=[[:space:]]*$P_TRUE|canCreateOrder[[:space:]]*=[[:space:]]*$P_TRUE" docs backend/src frontend/src backend/scripts
```

允许命中只限于说明“不是交易可用”“不得为 true”“不能声明”的禁止语境；任何产品正向承诺均视为严重规格偏差。

## 5. Drawio 本体验收

Drawio 文件：

```text
docs/target-architecture-gap.drawio
```

要求：

```text
pageCount <= 8
currentPageCount = 7
language = 中文
containsReleaseRoute = true
containsConcreteImplementationEntities = true
containsTradeBoundary = true
```

第 7 页已经补充：

```text
FTR-1 正式 provider 与数据治理
FTR-2 官方/可信 total-return benchmark
FTR-3 Formal validation
FTR-4 人工签核
FTR-5 Paper/sandbox 隔离
FTR-6 Release gate audit
```

本轮 drawio 本体读取输出：

```text
docs/read-drawio-output.txt
```

读取结论：

```text
drawioPageCount=7
containsConcreteImplementationEntities=true
containsReleaseGateRoute=true
containsTradeBoundary=true
lineCrossingRisk=low_by_layout
textOverflowRisk=low_by_box_width
```

## 6. 下一轮审计入口

下一轮人工或 ChatGPT 审计应读取：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/read-drawio-output.txt
```

## 6.1 是否需要外部 ChatGPT 审计

当前结论：不强制需要外部 ChatGPT 审计才能进入下一轮文档或代码开发；本轮自审未发现致命或重大规格偏差。

建议仅在以下情况触发外部审计：

1. 人工查看 drawio 后认为架构路径仍不可读或存在过度承诺。
2. 后续代码开发准备把 release gate 从 `blocked` 改为 `passed`。
3. 正式 provider、官方 benchmark、formal validation 或人工签核任一项要被认定为 release 级通过。
4. 文档中出现“已可正式交易”“下单能力可用”“自动交易能力可用”等产品承诺。

若触发外部审计，建议审计文档控制在以下 10 个以内：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/read-drawio-output.txt
backend/data/gpt-audit/interactive-strategy-backtest/<latest>/SUMMARY_FOR_GPT.md
```

## 7. 最终边界

本轮文档通过只表示正式交易 release 的后续开发目标和验收路径已被定义。它不表示：

```text
formalTradingUnlocked 被写成 true
autoTradeUnlocked 被写成 true
orderCreateAllowed 被写成 true
canCreateOrder 被写成 true
```

正式交易 release 仍需后续完成正式数据、正式 benchmark、formal validation、人工签核、paper/sandbox 隔离和 release gate 审计。
