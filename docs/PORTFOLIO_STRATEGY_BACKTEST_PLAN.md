# 交互式策略回测与正式交易级前置 PRD / 开发与验收计划

更新时间：2026-06-25

## 1. 阶段目标

本阶段目标是把 FAMS 从“研究页和单策略回测可用”推进到“交互式策略回测与正式交易级前置系统”。完成后，用户可以在前端选择多种组合或策略模板，设置不同起止时间和参数，查看收益率曲线、回撤曲线、关键指标、benchmark 对比、数据缺口、证据引用和交易 gate 状态，并基于结果生成人工计划草案。

本阶段不是正式交易放行阶段。开发完成后的目标状态是：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualTradeDraftReady=true
portfolioBacktestFormalReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段完成后的目标体验：

1. 用户进入“策略回测”页面。
2. 用户选择红利低波组合、当前持仓、永久组合、全天候组合、本地真实样本组合或自定义权重组合。
3. 用户设置起止时间、初始资金、再平衡频率、分红处理、手续费、滑点和 benchmark。
4. 用户点击运行后，页面展示多策略收益曲线、回撤曲线、指标表、benchmarkReturn、excessReturn、dividendContribution、dataCoverage 和 blockedReasons。
5. 用户能打开每个策略的输入定义、行情覆盖、分红覆盖、benchmark 状态、交易约束和 evidenceRefs。
6. 用户能基于红利低波或组合回测结果生成人工计划草案，但系统仍显示 `formalTargetWeight=0`、`canCreateOrder=false`。
7. 所有页面和接口明确显示“研究回测，不构成交易指令”，并禁止正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

2026-06-23 历史基线状态：

```text
portfolioStrategyBacktestReady=research_grade_partial
multiLocalRealDataCurveCompareReady=true
standardPresetPortfolioReady=research_grade_proxy_data_ready
formalTotalReturnBenchmarkReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

2026-06-24 实现验收同步：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualDraftReady=true
portfolioBacktestFormalReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
runtimeHealth=healthy
proxyEtfCoverage=ready
frontendRuntimeEvidence=passed
completedStrategies=7/7
tradeConstraintCoveragePercent=99.69
freeSourceTotalReturnBenchmarkReady=true
dividendLowVolBasketStatus=completed
dividendLowVolBasketComponentCount=3
dividendLowVolBasketSymbols=000513,601398,000333
```

2026-06-25 阶段目标校准：

```text
formalTradingPrerequisitesDocumented=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段完成后，用户应能在前端完成“选择策略 -> 设置区间 -> 查看多策略收益曲线 -> 查看数据等级和模型有效性 -> 生成人工计划草案 -> 查看正式交易阻断原因”的完整路径。该路径只支撑研究比较和人工评审，不支撑正式下单、自动再平衡或自动交易。

最新审计包：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
```

已完成能力：

- 后端已新增组合回测实现实体：`PortfolioBacktestInputBuilder / PortfolioBacktestEngine / PortfolioBenchmarkService / portfolioBacktestRoutes`，并补充 `portfolioBacktestReviewService` 用于人工复核审计。
- 前端已在 `/backtest` 页面新增“组合策略对比回测”模块。
- 默认路径可展示 3 条基于本地真实 `market_bar_canonical` 的 completed 策略曲线：
  - `local_real_data_sample_60_40`
  - `local_real_data_equal_weight_5`
  - `local_real_data_concentrated_3`
- 已接入 `local_equal_weight_20` 研究 benchmark，并显示 `benchmarkReturnPercent / excessReturnPercent`。
- 已补齐标准组合代理行情研究路径，`permanent_portfolio` 和 `all_weather` 可在本地代理行情覆盖满足时返回 completed 曲线。
- `/api/v1/portfolio-backtest/run` 已支持 `executionMode=operation`，可生成 Operation 与 artifactRefs，并可在任务中心追溯。
- API 和页面继续显示 `notTradingAdvice=true` 与禁止动作。
- Runtime Health 已统一接入 `/health`、SQLite 检查、组合回测 API 和交互式策略回测审计包；当前状态为 `healthy`。
- `/backtest` 前端已显示 runtime gate、SQLite 状态、Operation 持久化状态、价格收益、分红贡献、资本利得、成本拖累、benchmark 和超额收益。
- 无头浏览器专项验收已通过，截图证据落盘在交互式策略回测审计包中。

仍然阻断的目标能力：

- 标准永久组合和全天候组合当前为研究级代理行情 completed，可进入组合回测正式评审；仍不等同于正式交易解锁。
- 红利低波篮子已接入真实 `DividendLowVolDaily` 候选快照读取、等权 v1、tradeDate、selectionRules 和 evidenceRefs；通过免费源扩容后真实入篮数量达到 3/3，当前可在研究级组合回测中返回 completed 曲线，但不得用该结果解锁正式交易。
- 已新增审计用户 `audit_portfolio_backtest_user` 的真实持仓样本，`current_holdings_buy_and_hold` 在该用户下可返回 completed 曲线；默认用户无持仓时仍保持 insufficient。
- 已接入免费源 total-return benchmark，组合回测可达到 formal-review-ready；官方授权 total-return benchmark 和人工交易复核仍是正式交易解锁前置。
- Runtime Health 已完成本阶段统一收口；后续若出现 critical 或 unconfirmed，必须阻断 full-A 持久化 scan、persistence-heavy backtest 和 formal validation promotion。
- 正式交易级需要额外通过 formal provider、formal benchmark、交易约束、OOS、walk-forward、参数敏感性、分组稳定性和人工复核。

目标状态：

```text
portfolioStrategyBacktestReady=formal_review_ready
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段只输出研究结论、策略比较、观察提醒和人工计划草案，不输出正式买卖指令。

允许动作：

```text
RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT
```

禁止动作：

```text
ADD / REDUCE / AUTO_TRADE / ORDER_CREATE
```

## 2. 目标体验

用户进入“组合策略回测”页面后，应能完成以下路径：

1. 选择组合模板：永久组合、全天候组合、当前真实持仓、红利低波组合、自定义权重组合。
2. 设置回测区间：开始日期、结束日期、初始资金、再平衡频率、手续费、滑点、分红处理方式。
3. 选择 benchmark：沪深300、中证红利、中证全指、现金基准，缺正式数据时显示 proxy。
4. 点击运行回测，系统返回研究级回测结果；`executionMode=operation` 时生成 Operation + artifactRefs。
5. 页面展示多组合收益率曲线、回撤曲线和指标表。
6. 用户能对比不同起止时间段下的收益、回撤、波动率、Sharpe、Calmar、月度胜率、benchmarkReturn 和超额收益。
7. 页面明确显示数据来源、新鲜度、缺失项和“研究回测，不构成交易指令”。
8. 用户能保存或追溯回测 Operation artifact，包括输入参数、策略定义、曲线、指标、benchmark、缺口和交易 gate。
9. 用户能从红利低波页面跳转到组合回测视角，比较红利低波篮子与永久组合、全天候、当前持仓和自定义组合；红利低波篮子已接入真实候选快照读取，当前 3 只真实入篮标的可返回 completed 曲线。若后续真实入篮数量低于最小 3 只或证据不足，必须回退为 insufficient，不得用样本组合替代。

## 3. 当前项目基线

已具备：

- `/api/v1/backtest/run` 和建议回测入口。
- Backtest 页面和任务中心回测产物展示。
- 策略锦标赛 `equityCurve / drawdownCurve` 产物。
- 红利低波 3 年滚动回测和含分红研究回测。
- Operation、artifactRefs、任务状态和审计链路。

当前已补齐：

- 已有组合级研究回测引擎。
- 已有多组合同区间收益率曲线对比。
- 已有统一的组合策略版本定义、输入构建、费用、滑点、再平衡和 cash/local proxy benchmark。
- 已有 `/api/v1/portfolio-backtest/templates` 与 `/api/v1/portfolio-backtest/run`。
- 已有 API contract 验收和前端 build 验收。
- 已有前端 runtime 专项验收，覆盖 `/backtest` 页面加载、runtime gate 展示、组合回测运行、曲线指标展示和非交易提示。

剩余缺口：

- 组合回测已达到 `portfolioBacktestFormalReviewReady=true`，但该状态只表示“可进入人工评审”，不表示正式交易解锁。
- 免费源 total-return benchmark 已接入并可支撑 formal review；官方授权 total-return benchmark 仍是正式交易级升级项。
- 分红贡献、资本利得和成本拖累已可输出；后续仍需把分红事件、除权调整和再投资路径升级为官方源或可交叉验证源。
- 审计用户 `audit_portfolio_backtest_user` 已有真实持仓样本，当前持仓组合在该用户下可 completed；默认用户无持仓时仍应保持 insufficient。
- Operation + artifactRefs 已接入组合回测路径；后续重点是扩大正式数据源、模型有效性验证、人工复核记录和正式交易执行约束。

2026-06-25 文档收口后的下一阶段缺口：

- 数据等级需要在文档、审计包和前端统一展示，防止 `official_authorized / free_source_cross_checked / price_index_only / research_proxy / insufficient` 混用。
- 模型有效性需要从“能回测”升级到“样本外、walk-forward、参数敏感性和分组稳定性可审计”。
- 人工交易计划草案需要补齐复核 checklist、失效条件、当前/目标权重、组合约束和阻断原因。
- 前端需要提供正式评审工作台，让用户看懂哪些策略可比较、哪些只能观察、哪些因数据或验证不足被阻断。
- 审计包需要集中输出 data grade、model effectiveness、manual plan draft 和 formal trading blockers。
- 正式交易解锁清单只能定义和展示，不得自动释放 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

## 4. 目标架构

当前实现实体：

```text
frontend/src/pages/Backtest.tsx
frontend/src/pages/DividendLowVol.tsx
frontend/src/pages/Operations.tsx
backend/src/routes/portfolioBacktest.ts
backend/src/routes/strategy.ts
backend/src/services/portfolio-backtest/portfolioBacktestInputBuilder.ts
backend/src/services/portfolio-backtest/portfolioBacktestEngine.ts
backend/src/services/portfolio-backtest/portfolioBacktestReviewService.ts
backend/src/services/dividend-low-vol/dividendLowVolStrategyService.ts
backend/src/services/dividend-low-vol/dividendLowVolTradingZoneService.ts
backend/src/services/operation/operationService.ts
```

组合回测主链路：

```text
Backtest.tsx
  -> /api/v1/portfolio-backtest/templates
  -> /api/v1/portfolio-backtest/run
  -> PortfolioBacktestInputBuilder
  -> PortfolioBacktestEngine
  -> benchmark / dataGrade / modelEffectiveness
  -> readinessSummary / manualPlanDraft / formalTradingBlockers
  -> Operation artifact / audit package
  -> Backtest.tsx 正式评审摘要
```

红利低波篮子接入链路：

```text
DividendLowVol.tsx
  -> /api/v1/strategy/dividend-low-vol/candidates
  -> dividendLowVolStrategyService
  -> DividendLowVolDaily 候选快照
  -> dividendLowVolPortfolioBasketService / PortfolioBacktestInputBuilder
  -> PortfolioBacktestEngine
  -> research-grade completed 或 insufficient + blockedReasons
```

人工计划复核链路：

```text
Backtest.tsx
  -> /api/v1/portfolio-backtest/reviews/:runId
  -> portfolioBacktestReviewService
  -> JSON 审计记录
  -> canCreateOrder=false
  -> formalTradingUnlocked=false
  -> autoTradeUnlocked=false
```

核心数据流：

```text
组合模板 / 当前持仓 / 自定义权重
  -> 组合策略定义
  -> 历史行情与分红输入
  -> 组合净值 replay
  -> 再平衡 / 费用 / 滑点 / benchmark
  -> equityCurve / drawdownCurve / metrics / audit
  -> 前端多组合曲线与指标表
```

该目标架构要求所有新增策略和回测输出都接入同一套公共字段：

```text
readinessSummary
dataGrade
modelEffectivenessStatus
manualPlanDraft
formalTradingBlockers
```

不能新增绕过交易 gate 的独立字段或页面文案。

## 5. 组合策略范围

第一阶段支持：

- `permanent_portfolio`：股票 25%、债券 25%、黄金 25%、现金 25%。
- `all_weather`：股票、长期债券、中期债券、黄金、大宗商品代理。
- `current_holdings_buy_and_hold`：用户当前真实持仓买入并持有。
- `dividend_low_vol_basket`：红利低波候选篮子，研究级。
- `custom_weight_portfolio`：用户输入资产和权重。
- `local_real_data_sample_60_40`：本地真实行情样本 60/40，仅用于研究路径验收，不是推荐组合。
- `local_real_data_equal_weight_5`：本地真实行情样本等权 5，仅用于研究路径验收。
- `local_real_data_concentrated_3`：本地真实行情样本集中 3，仅用于研究路径验收。

所有组合策略必须有：

```text
strategyId
strategyVersion
assetUniverse
weightPolicy
rebalancePolicy
cashPolicy
dividendPolicy
costModel
benchmarkPolicy
evidenceRefs
```

策略定义示例：

```ts
type PortfolioStrategyDefinition = {
  strategyId: string
  strategyVersion: string
  displayName: string
  source: "preset" | "current_holdings" | "dividend_low_vol" | "custom"
  components: Array<{
    assetClass: "stock" | "bond" | "gold" | "commodity" | "cash" | "fund" | "etf"
    symbol?: string
    name?: string
    targetWeightPercent: number
    proxySymbol?: string
    proxyReason?: string
  }>
  rebalancePolicy: {
    frequency: "none" | "monthly" | "quarterly" | "annually"
    thresholdPercent?: number
  }
  dividendPolicy: "cash" | "reinvest"
  costModel: {
    feeRate: number
    slippageRate: number
    taxRate?: number
  }
  benchmarkPolicy: {
    benchmarkIds: string[]
    proxyAllowed: boolean
  }
  evidenceRefs: string[]
}
```

## 6. 回测输入与输出

输入参数：

```text
portfolioStrategyIds
startDate
endDate
initialCapital
rebalanceFrequency
dividendMode
feeRate
slippageRate
benchmarkIds
```

输出：

```text
equityCurve
drawdownCurve
dailyReturns
totalReturnPercent
priceOnlyReturnPercent
annualizedReturnPercent
maxDrawdownPercent
volatilityPercent
sharpe
calmar
monthlyWinRate
turnoverRate
dividendContributionPercent
capitalGainContributionPercent
costDragPercent
benchmarkReturnPercent
excessReturnPercent
dataCoverage
blockedReasons
evidenceRefs
```

曲线点契约：

```ts
type PortfolioBacktestCurvePoint = {
  date: string
  netValue: number
  cumulativeReturnPercent: number
  dailyReturnPercent?: number
  drawdownPercent: number
  benchmark?: Record<string, {
    netValue: number
    cumulativeReturnPercent: number
  }>
}
```

结果契约：

```ts
type PortfolioBacktestResult = {
  schemaVersion: "portfolio.strategy_backtest.result.v1"
  generatedAt: string
  userId: string
  request: PortfolioBacktestRequest
  strategies: Array<{
    definition: PortfolioStrategyDefinition
    status: "completed" | "partial" | "insufficient" | "failed"
    equityCurve: PortfolioBacktestCurvePoint[]
    drawdownCurve: Array<{ date: string; drawdownPercent: number }>
    metrics: Record<string, number | string | null>
    dataCoverage: {
      priceCoveragePercent: number
      dividendCoveragePercent?: number
      benchmarkCoveragePercent?: number
      missingSymbols: string[]
    }
    blockedReasons: string[]
    warnings: string[]
    evidenceRefs: string[]
  }>
  allowedActions: Array<"RESEARCH" | "OBSERVE" | "COMPARE" | "PLAN_DRAFT">
  prohibitedActions: Array<"ADD" | "REDUCE" | "ORDER_CREATE" | "AUTO_TRADE">
  notTradingAdvice: true
}
```

API 契约：

```http
GET  /api/v1/portfolio-backtest/templates
POST /api/v1/portfolio-backtest/run
GET  /api/v1/portfolio-backtest/reviews/:runId
POST /api/v1/portfolio-backtest/reviews/:runId
```

当前 `POST /run` 支持两种模式：

- 默认同步返回研究级组合回测结果，用于前端即时体验和真实数据验收。
- `executionMode=operation` 时创建 Operation，返回 `operationId`、`artifactRefs` 和 result；artifact 通过任务中心既有 Operation artifact API 追溯。
- `GET /reviews/:runId` 读取人工计划草案复核记录；未复核时返回 `status=not_reviewed`。
- `POST /reviews/:runId` 只保存复核审计，返回 `canCreateOrder=false`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`，不得创建订单。

```json
{
  "operationId": "string",
  "status": "completed",
  "artifactRefs": [],
  "notTradingAdvice": true
}
```

## 7. 开发计划与当前状态

本节记录从 research-grade 到 formal-review-ready 的开发计划。2026-06-24 最新验收显示 PBT-0 到 PBT-11 已完成本阶段要求；后续正式交易级升级计划维护在 `docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`。

### PBT-0 Runtime Health 与验收口径收口

开发项：

- 统一 `/health`、`check:sqlite-health`、红利低波 audit package 和全系统 E2E 的 runtime health 口径。
- 当 runtime health 为 critical 或 unconfirmed 时，阻断 full-A 持久化 scan、persistence-heavy backtest 和 formal validation promotion。
- 在前端任务中心和审计包中展示 runtime health 状态和阻断原因。

验收标准：

- 不能再出现“命令 passed 但 runtime audit critical 却被视为正式通过”的验收口径。
- runtime critical 时，系统只能运行 dry-run、fixture 或小样本研究验证。
- runtime healthy 时，才允许进入大样本持久化扫描和组合 Operation 回测。
- 审计包必须记录 `runtimeHealth.status / sqliteHealthy / blockedActions / allowedActions`。

### PBT-1 文档与架构闭环

开发项：

- 新增本计划文档。
- 更新 `TARGET_ARCHITECTURE_GAP.md`。
- 更新 `target-architecture-gap.drawio`，页数仍不超过 8 页。

验收标准：

- drawio 可解析。
- 文档明确 research-grade 边界。
- 文档不承诺正式交易动作。

### PBT-2 组合策略定义与输入构建

开发项：

- 新增组合策略 registry。
- 支持预设组合、当前持仓和自定义权重。
- 统一起止日期、权重、再平衡和 benchmark 参数。

验收标准：

- 每个组合策略都能生成版本化定义。
- 当前持仓组合能从系统持仓读取权重。
- 权重合计、现金项和缺失资产能被校验。
- 永久组合和全天候组合的 proxy 资产必须显示 proxyReason。
- 自定义权重不等于 100% 时必须返回输入错误，不自动修正。

### PBT-3 组合级回测引擎

开发项：

- 实现按日组合净值 replay。
- 支持再平衡、费用、滑点、现金、分红现金持有和再投资。
- 生成收益率曲线和回撤曲线。

验收标准：

- 同一输入重复运行结果一致。
- 曲线点包含日期、净值、收益率和回撤。
- 缺少行情或分红数据时输出 blockedReasons，不静默跳过。
- `current_holdings_buy_and_hold` 必须使用系统当前持仓权重作为起点，并在 artifact 中记录持仓快照时间。
- `rebalanceFrequency=none` 与 `quarterly` 的结果应能在测试中产生不同换手率。

### PBT-4 Benchmark 与对比

开发项：

- 接入沪深300、中证红利、中证全指和现金基准。
- 缺正式数据时标记 `proxyBenchmark=true`。
- 输出超额收益和 benchmark 曲线。

验收标准：

- proxy benchmark 不得用于 formal validation。
- 页面明确显示 benchmark 来源和状态。
- benchmark 曲线缺失时，组合曲线仍可展示，但对比指标必须标记 `insufficient`。
- 当前已完成 `cash_cny` 与 `local_equal_weight_20` 研究 benchmark；`local_equal_weight_20` 必须始终标记为 research proxy。

### PBT-5 前端组合回测页面

开发项：

- 新增或增强“策略回测”页面中的组合回测模式。
- 支持多组合选择、时间区间、参数表单。
- 展示收益率曲线、回撤曲线、指标表和数据缺口。

验收标准：

- 用户能完成：选择组合 -> 设置区间 -> 运行 -> 查看多组合曲线。
- 图表能按组合区分颜色和图例。
- 缺数据时页面显示原因和刷新建议。
- 页面顶部固定展示“研究回测，不构成交易指令”。
- 表格展示每个组合的 `startDate / endDate / strategyVersion / dataCoverage / blockedReasons`。
- 曲线区域支持至少 3 个组合同时对比且图例可见。

### PBT-6 审计与交易边界

开发项：

- 生成组合回测 artifact。
- 接入 Operation 和 audit package。
- 保持交易 gate 阻断。

验收标准：

- artifact 包含输入、版本、曲线、指标、benchmark、数据覆盖和 blockedReasons。
- 页面和接口均不得输出正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。
- `test:trade-action-readiness` 不得因为组合回测 research-ready 而解锁正式交易。

### PBT-7 用户路径与端到端验收

开发项：

- 用默认用户数据执行永久组合、全天候组合、当前持仓和红利低波组合对比。
- 覆盖至少两个不同时间区间：近 1 年、近 3 年。
- 生成用户路径审计 artifact。

验收标准：

- 用户能从左侧菜单进入组合回测或策略回测组合模式。
- 同一页面能切换时间区间并重新运行。
- 页面能解释：哪个组合收益更高、哪个组合回撤更低、哪些结果因数据不足不可比较。
- 所有结论均带 `notTradingAdvice=true` 和 `evidenceRefs`。

### PBT-8 标准组合真实代理行情补齐

当前状态：已完成本阶段验收。

开发项：

- 为 `510300 / 511010 / 511260 / 518880 / 159985` 补齐免费行情或正式 provider 行情。
- 建立行情新鲜度、sourceRefs、coverage 和 provider fallback 审计。
- 让永久组合与全天候组合从 insufficient 变为 completed。

验收标准：

- 上述代理标的各自拥有不少于 250 个交易日真实行情。
- 永久组合和全天候组合能生成 completed 曲线。
- 页面明确标注 ETF 代理来源和更新时间。
- 如果任何代理缺数据，仍保持 insufficient，不允许用本地 A 股样本冒充 ETF。

### PBT-9 Benchmark 与分红总回报

当前状态：已完成本阶段 formal-review-ready 验收；官方授权 benchmark 和更严格分红事件链路是下一阶段升级项。

开发项：

- 接入沪深300、中证全指、中证红利等 benchmark，区分 `formal_total_return / price_index / research_proxy`。
- 接入分红事件、除权调整、分红现金持有和分红再投资。
- 输出 `dividendContributionPercent / capitalGainContributionPercent / costDrag / benchmarkReturnPercent / excessReturnPercent`。

验收标准：

- 至少一个正式或免费宽基 benchmark 可输出曲线。
- `proxy` benchmark 不得被用于正式交易级 validation。
- 分红贡献不再恒为 null。
- 缺 total-return benchmark 时 portfolio formal review 仍为 blocked。

### PBT-10 Operation、Artifact 与前端运行态验收

开发项：

- 将组合回测同步接口升级为 Operation 可选路径。
- 输出 artifactRefs：输入定义、数据覆盖、曲线、benchmark、交易边界和前端用户路径。
- 新增或完善前端运行态验收脚本。

验收标准：

- 用户能在任务中心追踪组合回测任务。
- artifact 可被下载或预览。
- 前端运行态验收覆盖加载、参数输入、运行、曲线、指标、缺口和非交易 banner。

### PBT-11 组合回测正式评审前置

当前状态：已完成本阶段验收，最新审计包显示 `portfolioBacktestFormalReviewReady=true`、`formalTradingUnlocked=false`。

开发项：

- 输出 formal review readiness artifact，聚合 runtime、provider、benchmark、tradeability、validation、manual review 和 frontend visibility。
- 区分 `research_grade_passed`、`manual_draft_ready`、`formal_review_ready`、`formal_trading_unlocked`。
- 增加正式交易级前置清单，但不自动解锁正式交易动作。

验收标准：

- 只有 runtime healthy、正式或可信数据覆盖达标、benchmark 不再依赖 proxy、交易约束完整、validation 全部 gate passed、人工复核通过时，才允许标记 `formalTradingReviewReady=true`。
- 即使 `formalTradingReviewReady=true`，`formalTradingUnlocked` 仍需单独人工确认。
- `AUTO_TRADE` 保持 false，除非未来另立独立项目和人工授权。

## 8. 出门条件

当前已可出门为：

```text
portfolio_strategy_backtest_research_ready
multi_portfolio_curve_compare_ready
portfolio_backtest_audit_ready
formal_trading_locked
auto_trade_locked
```

本阶段目标出门为：

```text
interactive_strategy_backtest_ready
research_grade_strategy_comparison_ready
portfolio_backtest_formal_review_ready
manual_trade_draft_ready
runtime_health_gate_consistent
formal_trading_locked
auto_trade_locked
```

下一阶段可以出门为：

```text
official_benchmark_upgrade_ready
portfolio_model_effectiveness_review_ready
manual_trade_review_workflow_ready
formal_trading_unlock_prerequisites_ready
```

不能出门为：

```text
formal_portfolio_trade_ready
auto_rebalance_ready
auto_trade_ready
formal_add_reduce_unlocked
```

## 9. 验收命令

文档验收：

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
```

后续开发验收建议：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

如果 `test:portfolio-strategy-backtest` 不存在，应在 PBT-3 阶段新增。

端到端用户路径验收：

```bash
cd backend
npm run test:portfolio-strategy-backtest
npm run test:trade-action-readiness

cd frontend
npm run build
```

建议新增前端运行态验收：

```text
test:portfolio-backtest-frontend-runtime
```

如果该测试不存在，应在 PBT-5 阶段新增，覆盖页面加载、表单输入、运行按钮、曲线区域、指标表和交易边界 banner。

## 10. 文档支撑度判断

当前文档目标是支撑 PBT-1 到 PBT-6 的 research-grade 开发。

```text
documentationCoverage=complete_for_research_grade_portfolio_backtest_PBT_1_to_PBT_7
nextStageDocumentationCoverage=complete_for_PBT_8_to_PBT_10_research_grade
formalTradingCoverage=blocked_by_validation_and_manual_review
overPromiseRisk=controlled
```

文档不支撑自动交易、自动再平衡或正式下单。

## 11. 审计产物清单

组合策略回测开发完成后，必须生成或更新以下审计文件：

```text
backend/data/gpt-audit/portfolio-backtest/<timestamp>/README.md
backend/data/gpt-audit/portfolio-backtest/<timestamp>/manifest.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/01_request_and_strategy_definitions.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/02_input_data_coverage.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/03_backtest_results.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/04_benchmark_comparison.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/05_frontend_user_path.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/06_trade_gate_contract.json
backend/data/gpt-audit/portfolio-backtest/<timestamp>/SUMMARY_FOR_GPT.md
```

审计包不得包含 token、cookie、`.env`、数据库原始文件或用户隐私明细。持仓数据只允许以本地默认用户研究样例或脱敏聚合形式进入 GPT 审计包。

## 12. 正式交易前置字段索引

组合策略回测是本阶段正式交易前置评审的核心入口。后端结果、Operation
artifact、前端策略回测页面和 GPT 审计包必须统一输出以下状态：

```text
portfolioBacktestFormalReviewReady=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

必须保留的公共字段：

```text
readinessSummary
dataGrade
modelEffectiveness
modelEffectivenessStatus
manualPlanDraft
formalTradingUnlockChecklist
formalTradingBlockers
allowedActions=RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

`readinessSummary` 必须同时给出：

```text
researchReady
formalReviewReady
manualDraftReady
formalTradingEligible
formalTradingUnlocked=false
autoTradeUnlocked=false
```

这些字段的产品含义是“可被人工复核”，不是“可自动执行交易”。
