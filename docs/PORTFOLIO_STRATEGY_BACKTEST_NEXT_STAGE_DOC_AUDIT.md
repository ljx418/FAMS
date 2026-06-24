# 组合策略回测下一阶段文档审计

更新时间：2026-06-23

## 1. 审计结论

当前文档已能支撑下一阶段自动开发：

```text
documentationCoverage=complete_for_PBT_8_to_PBT_10_research_grade
formalTradingCoverage=blocked
overPromiseRisk=controlled
humanConfirmationRequired=false
```

下一阶段目标限定为研究级组合回测增强，不包含正式交易、自动再平衡或自动下单。

## 2. 本阶段目标

本阶段把以下目标纳入开发和验收：

1. 补齐标准组合代理行情，使永久组合和全天候组合不再因 ETF 行情缺失而 insufficient。
2. 建立正式/免费 benchmark adapter，区分 `formal_total_return / price_index / research_proxy`。
3. 补齐组合分红总回报研究路径，区分 `price-only / dividend cash / dividend reinvest`。
4. 将组合回测升级为 Operation + artifactRefs 可追踪路径。
5. 前端持续展示多组合曲线、指标、benchmark、缺口和非交易边界。

## 3. 规格边界

必须保持：

- 本模块只允许 `RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT`。
- 禁止 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。
- `local_equal_weight_20` 只能是 research proxy benchmark。
- 本地真实样本组合只用于路径验收，不是推荐组合。
- 缺 ETF、缺分红、缺 benchmark、缺持仓时必须显示 insufficient 或 warning。

## 4. 主要文档更新

- `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`：补充当前完成状态、PBT-8 到 PBT-10、验收命令和出门条件。
- `docs/TARGET_ARCHITECTURE_GAP.md`：补充组合策略回测专项当前实现、剩余缺口、自动化开发准入。
- `docs/DIVIDEND_LOW_VOL_PRD.md`：补充红利低波与组合策略回测联动规格。
- `docs/target-architecture-gap.drawio`：在 7 页以内更新目标体验、当前/目标架构关系、开发计划、里程碑、验收门槛和用户路径。

## 5. 下一阶段验收标准

### PBT-8 标准代理行情

- `510300 / 511010 / 511260 / 518880 / 159985` 各自不少于 250 个交易日真实行情。
- 永久组合和全天候组合能生成 completed 曲线。
- 数据源、freshness、sourceRefs、provider fallback 可审计。

### PBT-9 Benchmark 与分红总回报

- 至少一个宽基 benchmark 可输出曲线。
- benchmark 状态区分 formal、price index 和 research proxy。
- `dividendContributionPercent` 不再恒为 null。
- 缺 formal total-return benchmark 时仍保持 formal validation blocked。

### PBT-10 Operation 与前端验收

- 组合回测可以通过 Operation 追踪。
- artifact 包含输入、版本、曲线、benchmark、数据覆盖、blockedReasons 和交易 gate。
- 前端运行态验收覆盖页面加载、表单输入、运行、曲线、指标和非交易 banner。

## 6. 审计意见

未发现新增致命或重大规格偏差。当前主要风险是把 research proxy benchmark 或本地样本组合误解释为正式投资建议；该风险已在 PRD、目标架构、drawio 和验收门槛中明确阻断。

## 7. 独立规格检视

本轮重新阅读并交叉检查：

- `docs/DIVIDEND_LOW_VOL_PRD.md`
- `docs/TARGET_ARCHITECTURE_GAP.md`
- `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`
- `docs/target-architecture-gap.drawio`

检视结论：

```text
prdExperienceCoverage=complete_for_research_grade_workflow
targetArchitectureCoverage=complete_for_PBT_8_to_PBT_10
acceptanceCoverage=complete_for_development_and_e2e_validation
formalTradingCoverage=blocked_by_design
drawioPageCount=7
overPromiseRisk=controlled
humanConfirmationRequiredBeforeDevelopment=false
```

文档可以完整指导本阶段后续开发。本阶段开发完成后，应能支撑 PRD 中的以下目标体验：

1. 用户能进入策略回测页面，选择多个组合并比较不同时间段收益曲线。
2. 用户能看到永久组合、全天候组合、本地真实样本组合、当前持仓和红利低波篮子的可用或缺口状态。
3. 用户能看到 benchmark、分红贡献、超额收益、数据覆盖、blockedReasons 和 evidenceRefs。
4. 用户能通过任务中心或审计包追踪回测 Operation、输入定义、曲线、指标和交易边界。
5. 页面和接口均保持研究态，不输出正式交易、自动再平衡或订单创建。

不能由本阶段自动开发达成的体验：

1. 正式 `ADD / REDUCE` 放行。
2. `AUTO_TRADE` 或自动下单。
3. 官方 total-return benchmark 授权数据完整接入。
4. 免费数据源 100% 每日最新保证。
5. FIVD-R 或红利低波模型被证明可稳定产生交易收益。

## 8. 剩余开发及验收计划

### PBT-8 标准组合代理行情补齐

开发目标：

- 为 `510300 / 511010 / 511260 / 518880 / 159985` 建立免费行情接入或本地缓存补齐路径。
- 写入字段级 `sourceProvider / sourceEndpoint / tradeDate / fetchedAt / freshnessStatus / evidenceRefs / coverageStatus`。
- 将永久组合、全天候组合从 `insufficient` 推进到可生成真实代理行情曲线；若缺任一代理，必须继续显示 `insufficient`。

后端验收：

- 每个代理标的不少于 250 个交易日行情。
- 回测输入构建能识别代理行情覆盖率。
- 缺失代理不得被本地 A 股样本替代。
- API 返回 `dataCoverage.missingSymbols`、`blockedReasons` 和 `warnings`。

前端验收：

- 页面展示永久组合和全天候组合曲线或明确缺口。
- ETF 代理来源、更新时间和缺口提示可见。
- 研究模式 banner 和禁止动作可见。

机器验收：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract

cd frontend
npm run build
```

出门条件：

```text
standard_portfolio_proxy_data_ready=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

### PBT-9 Benchmark 与分红总回报研究路径

开发目标：

- 接入至少一个免费宽基 benchmark 曲线，并区分 `formal_total_return / price_index / research_proxy`。
- 为组合回测输出 `priceOnlyReturn / dividendContribution / capitalGainContribution / costDrag / benchmarkReturn / excessReturn`。
- 支持 `dividendMode=cash / reinvest` 的研究级计算。

后端验收：

- 至少一个 benchmark 可返回曲线。
- `local_equal_weight_20` 始终标记为 `research_proxy`。
- proxy benchmark 不参与 formal validation 解锁。
- `dividendContributionPercent` 不再恒为 `null`；若缺分红事件，必须输出缺口而不是填 0。

前端验收：

- 曲线图和指标表展示 benchmarkReturn、excessReturn、dividendContribution。
- benchmark 状态和 proxy 警告可见。
- 缺 formal total-return benchmark 时显示 formal validation blocked。

机器验收：

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

出门条件：

```text
portfolio_benchmark_research_ready=true
portfolio_total_return_research_ready=true
formalValidationUnlocked=false
```

### PBT-10 Operation、Artifact 与前端运行态验收

开发目标：

- 将组合回测从同步研究接口扩展为可选 Operation 路径。
- 生成 artifactRefs：输入定义、数据覆盖、曲线、benchmark、交易边界、前端用户路径。
- 新增前端运行态验收脚本，覆盖用户完整路径。

后端验收：

- Operation 可追踪 queued/running/completed/failed。
- artifact 可预览，包含 strategy definitions、request、curves、metrics、benchmark、blockedReasons、allowed/prohibited actions。
- GPT audit package 不包含 token、cookie、`.env` 或数据库原始文件。

前端验收：

- 用户能从页面提交回测、查看任务状态、打开 artifact。
- 页面加载、参数输入、运行、曲线、指标、缺口和非交易 banner 均通过运行态检查。

机器验收：

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

建议新增：

```text
npm run test:portfolio-backtest-frontend-runtime
```

出门条件：

```text
portfolio_operation_artifact_ready=true
frontend_user_path_verified=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

## 9. 端到端 PRD 验收矩阵

| PRD 目标体验 | 对应开发项 | 验收方式 | 出门判断 |
| --- | --- | --- | --- |
| 多组合收益曲线对比 | PBT-8/PBT-10 | 前端运行态 + API contract | 至少 3 条 completed 曲线，标准组合可用或明确 insufficient |
| 不同时间段对比 | PBT-10 | 前端切换近 1 年/近 3 年 | 同页面可重新运行并刷新指标 |
| benchmark 与超额收益 | PBT-9 | API contract + 页面指标表 | benchmark 状态可见，proxy 不解锁 formal |
| 分红总回报 | PBT-9 | 后端单测 + 指标表 | dividendContribution 不静默为 0 或 null |
| 数据缺口解释 | PBT-8/PBT-9/PBT-10 | API blockedReasons + 页面提示 | 用户能看懂缺什么、为何不可比 |
| 任务与审计追踪 | PBT-10 | Operation + artifact 预览 | artifactRefs 可打开 |
| 不构成交易指令 | 全阶段 | trade gate contract | 禁止 ADD/REDUCE/ORDER_CREATE/AUTO_TRADE |

## 10. 需要给 ChatGPT 审计的文档路径

文档数控制在 5 个：

```text
docs/DIVIDEND_LOW_VOL_PRD.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_NEXT_STAGE_DOC_AUDIT.md
docs/target-architecture-gap.drawio
```

建议审计问题：

1. 当前文档是否足以指导 PBT-8 到 PBT-10 的自动化开发？
2. 是否存在把 research proxy 或本地样本误包装为正式投资建议的风险？
3. 是否明确阻断正式交易、自动再平衡和自动下单？
4. 验收标准是否能覆盖用户可见体验、后端契约、前端运行态和审计产物？
5. drawio 是否清楚表达当前架构、目标架构、开发计划、里程碑、验收门槛和出门条件？

## 11. 原型开发循环完成审计

更新时间：2026-06-23

本轮按“审计准入 -> 开发 -> 子阶段验收 -> PRD 规格检视 -> 失败回炉修正 -> 复验”的原型开发循环执行。

### 11.1 准入审计

结论：

```text
developmentEntryAllowed=true
fatalSpecDeviation=false
majorSpecDeviation=false
humanConfirmationRequired=false
```

准入依据：

- PRD、目标架构、组合回测计划和 drawio 均明确本阶段仅为 research-grade。
- 禁止动作 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 已在接口、页面、审计计划和 drawio 中保持一致。
- PBT-8 到 PBT-10 有单独验收标准，可以进入实质开发。

### 11.2 PBT-8 标准组合代理行情补齐

完成项：

- 新增 `portfolioProxyMarketDataService`。
- 标准组合代理 `510300 / 511010 / 511260 / 518880 / 159985` 使用免费行情和本地 `market_bar_canonical` 覆盖检查。
- 修复 ETF 交易所推断：`5xxxxx` 识别为上交所，`1xxxxx` 识别为深交所，避免免费源抓错 secid。
- 永久组合和全天候组合在代理总覆盖不少于 250 条真实行情后允许进入 completed 回测。

验收结果：

```text
standardPortfolioProxyDataReady=true
permanentPortfolioStatus=completed
allWeatherStatus=completed
proxyBarsObserved=905 for local validated proxy symbols
fakeProxySubstitution=false
```

曾发现并修正的偏差：

- 初版错误地要求“当前回测区间内 >=250 条行情”，导致 6 个月回测被误阻断。
- 已修正为“代理标的本地真实总覆盖 >=250 条”，回测区间曲线按用户选择区间运行。

### 11.3 PBT-9 Benchmark 与分红总回报研究路径

完成项：

- `portfolioBenchmarkService` 新增 `csi300_price_index` 免费宽基价格指数 benchmark。
- benchmark 状态区分：
  - `cash_cny: price_index`
  - `csi300_price_index: price_index`
  - `local_equal_weight_20: research_proxy`
- 回测结果输出 benchmark status warnings，避免 proxy/formal 混淆。
- 组合回测引擎新增研究级分红贡献估算：仅在存在 `DividendLowVolDaily.ttmDividendYield` 事实时计算，否则输出 `dividend_contribution_insufficient:no_audited_component_yield`。

验收结果：

```text
benchmarkResearchReady=true
csi300PriceIndexReady=true
localEqualWeight20MarkedResearchProxy=true
dividendContributionSilentNull=false
formalTotalReturnBenchmarkReady=false
formalValidationUnlocked=false
```

剩余限制：

- 当前接入的是宽基价格指数，不是官方 total-return benchmark。
- 分红贡献仍是 research-grade 估算或显式 insufficient；正式分红事件、除权和再投资链路未解锁 formal validation。

### 11.4 PBT-10 Operation、Artifact 与前端运行态

完成项：

- `/api/v1/portfolio-backtest/run` 支持 `executionMode=operation`。
- Operation 类型为 `portfolio_backtest_run`，完成后写入 artifactRefs。
- artifact 包含：
  - `01_request_and_strategy_definitions.json`
  - `02_input_data_coverage.json`
  - `03_backtest_results.json`
  - `04_benchmark_comparison.json`
  - `05_frontend_user_path.json`
  - `06_trade_gate_contract.json`
- 前端 Backtest 页面运行组合回测时提交 Operation 模式，同时保留即时结果展示。
- 前端显示任务产物入口、artifact 数、分红贡献、benchmark/缺口 warnings 和非交易 banner。
- Operations 页面支持 `portfolio_backtest_run` 类型展示。

验收结果：

```text
portfolioOperationArtifactReady=true
tradeGateArtifactReady=true
frontendUserPathVisible=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

### 11.5 机器验收记录

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract

cd frontend
npm run build
```

`test:portfolio-backtest-api-contract` 已覆盖：

- 模板接口非交易边界。
- 至少 3 条本地真实行情 completed 曲线。
- 永久组合 completed。
- 全天候组合 completed。
- `csi300_price_index` 状态可见。
- 分红贡献有事实估算或显式 insufficient。
- Operation submission completed。
- artifactRefs 可读取。
- `06_trade_gate_contract.json` 显示 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`。

待本轮最终收口继续执行：

```bash
cd backend
npm run test:production-readiness
npm run test:trade-action-readiness
```

### 11.6 PRD 规格检视

检视结论：

```text
prdUserPathSupported=true
multiPortfolioCurveCompareSupported=true
standardPortfolioCompareSupported=true
benchmarkVisibilitySupported=true
dividendContributionVisibilitySupported=true
operationAuditSupported=true
tradingBoundaryPreserved=true
```

当前已能支撑的用户路径：

```text
进入策略回测页
-> 设置区间、资金和参数
-> 运行组合回测
-> 查看本地真实样本、永久组合、全天候、当前持仓的曲线或缺口
-> 查看总收益、回撤、benchmark、超额收益、分红贡献或分红缺口
-> 跳转任务中心查看 Operation artifact
-> 确认研究态和禁止动作
```

仍不支撑的 PRD 外延：

- 正式交易下单。
- 自动再平衡。
- 自动交易。
- 官方 total-return benchmark 完整授权数据。
- 免费源 100% 每日最新承诺。

### 11.7 审计意见

未发现新增致命或重大规格偏差。本轮发现的一个验收口径偏差已经在开发循环中修正并复验通过。

下一步如果继续开发，应优先处理：

1. 正式分红事件与除权调整表，替代当前 TTM yield 研究估算。
2. 前端运行态自动化脚本 `test:portfolio-backtest-frontend-runtime`。
3. 组合回测 GPT audit package 生成命令。
4. 有真实持仓后复验 `current_holdings_buy_and_hold`。
5. 若需要 formal validation，接入官方或授权 total-return benchmark，并单独走人工评审。
