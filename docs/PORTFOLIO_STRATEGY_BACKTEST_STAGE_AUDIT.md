# 组合策略回测阶段开发准入与验收审计

更新时间：2026-06-24

## 1. 审计结论

```text
stage=portfolio_strategy_backtest_research_grade
entryDecision=approved_for_development
implementationDecision=research_grade_passed
fatalSpecDeviation=none
majorSpecDeviation=none
overPromiseRisk=controlled
manualDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段已完成 research-grade 组合策略回测实现验收。开发目标限定为 research-grade 组合策略回测：多组合、多时间段收益率曲线、回撤曲线、指标表、benchmark 对比、数据缺口和审计产物。

本阶段不得输出正式交易动作、自动再平衡或订单创建。

最新实现状态：

```text
overallStatus=passed
runtimeHealth=healthy
proxyEtfCoverage=ready
frontendRuntimeEvidence=passed
completedStrategies=6/7
dividendLowVolBasketStatus=completed
dividendLowVolBasketComponentCount=3
dividendLowVolBasketSymbols=000513,601398,000333
researchGradeStrategyComparisonReady=true
formalReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

状态来源：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T11-58-33-608Z/SUMMARY_FOR_GPT.md
```

## 2. 已审计文档

```text
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md
```

## 3. PRD 规格检视

通过项：

- FAMS 定位仍是研究与决策系统，不是自动交易系统。
- LLM 不直接决定买卖。
- 回测和策略输出必须有 evidenceRefs。
- 数据不足必须显示 insufficient / blockedReasons。
- 红利低波和组合回测均保持 research-grade 边界。
- `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 继续禁止。

需持续检查项：

- 组合回测曲线不得被解释为未来收益承诺。
- proxy benchmark 不得被标记为 formal benchmark。
- 缺行情、分红或 benchmark 时不得静默跳过。
- 用户当前持仓参与回测时，审计包必须避免暴露隐私明细；GPT 审计只使用脱敏聚合或本地样例。

## 4. 开发计划

### PBT-1 文档与架构闭环

状态：已完成。

验收：

- `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md` 已新增。
- `docs/TARGET_ARCHITECTURE_GAP.md` 已更新。
- `docs/target-architecture-gap.drawio` 已新增第 7 页。
- drawio 可解析，页数小于 8。

### PBT-2 组合策略定义与输入构建

状态：已完成 research-grade 验收。

开发项：

- 新增 portfolio strategy registry。
- 支持永久组合、全天候组合、当前持仓、红利低波组合和自定义权重。
- 生成 `PortfolioStrategyDefinition`。
- 校验权重、proxyReason、缺失资产和 evidenceRefs。

验收：

- 每个策略都有 `strategyId / strategyVersion / components / rebalancePolicy / dividendPolicy / costModel / benchmarkPolicy / evidenceRefs`。
- 自定义权重不等于 100% 必须失败。
- 当前持仓组合必须记录持仓快照时间。

### PBT-3 组合级回测引擎

状态：已完成 research-grade 验收。

开发项：

- 按日组合净值 replay。
- 支持再平衡、费用、滑点、现金、分红现金持有和分红再投资。
- 输出 equityCurve、drawdownCurve、dailyReturns 和 metrics。

验收：

- 同一输入重复运行结果一致。
- 曲线点包含 date、netValue、cumulativeReturnPercent、drawdownPercent。
- 缺数据时输出 blockedReasons。

### PBT-4 Benchmark 与对比

开发项：

- 支持现金基准、沪深300、中证红利、中证全指 proxy / formal 状态。
- 输出 benchmark 曲线和 excessReturn。

验收：

- benchmark 缺失时组合曲线仍可展示，对比指标为 insufficient。
- proxy benchmark 不得升级 formal validation。

### PBT-5 前端组合回测页面

状态：已完成 runtime 验收。

开发项：

- 在策略回测页面增加组合回测模式，或新增组合回测页面。
- 支持多组合选择、时间区间、参数表单、收益曲线、回撤曲线、指标表、缺口提示。

验收：

- 用户能完成 `选择组合 -> 设置区间 -> 运行 -> 查看多组合曲线`。
- 至少 3 个组合可同屏对比。
- 页面固定展示“研究回测，不构成交易指令”。

### PBT-6 审计与交易边界

状态：已完成 research-grade 审计包与 trade gate contract 验收。

开发项：

- 生成组合回测审计包。
- 接入 trade gate contract。

验收：

- 审计包包含输入、版本、曲线、指标、benchmark、数据覆盖、blockedReasons 和 evidenceRefs。
- `test:trade-action-readiness` 不得因组合回测 research-ready 解锁正式交易。

### PBT-7 用户路径与端到端验收

状态：已完成 `/backtest` 无头浏览器专项验收；红利低波篮子真实候选快照读取已接入，当前真实入篮数量为 3/3，已可作为研究级 completed 曲线参与组合策略比较。

开发项：

- 用真实本地数据运行永久组合、全天候组合、当前持仓和红利低波组合。
- 覆盖近 1 年和近 3 年两个区间。
- 生成用户路径审计 artifact。

验收：

- 页面能说明不同组合收益、回撤、数据不足项。
- 所有结论带 `notTradingAdvice=true` 和 evidenceRefs。

## 5. 真实数据验收原则

本阶段“真实数据”定义为项目本地 SQLite / canonical cache / PriceHistory / market_bar_canonical / 已持久化免费源数据中的真实行情与持仓数据。

如果本地真实数据覆盖不足：

- 不允许改用纯 mock 伪造通过。
- 必须输出 `insufficient` 和 blockedReasons。
- 开发任务回退到数据输入构建或 provider/cache 补齐。

## 6. 审计意见闭环

当前审计意见：

```text
fatal=0
major=0
minor=3
```

minor：

- 前端页面可以复用 Backtest 页，也可以新增 PortfolioBacktest 页；开发时需选择一种并保持导航清晰。
- benchmark 第一阶段可用 proxy，但必须显式标注。
- 用户持仓进入 GPT 审计包前需要脱敏或聚合。

闭环状态：

- 三项 minor 已写入验收标准和审计包要求。
- 无新增 fatal 或 major 规格偏差。

## 7. 准入结论

```text
canStartImplementation=true
requiredHumanConfirmation=false
nextStep=dividend_low_vol_basket_candidate_expansion_and_formal_data_upgrade
```
