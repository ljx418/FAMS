# 交互式策略回测剩余阶段开发与验收审计

更新时间：2026-06-24

## 1. 开发前审计结论

当前本阶段可以继续自动化开发，但不能解释为正式交易级开发完成。

```text
fatalSpecDeviation=0
majorSpecDeviation=0
canProceedToImplementation=true
requiresHumanConfirmation=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

当前真实状态：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualDraftReady=true
formalReviewReady=false
completedStrategies=6/7
dividendLowVolBasketStatus=completed
dividendLowVolBasketComponentCount=3
dividendLowVolBasketSymbols=000513,601398,000333
```

本阶段剩余主线已完成：红利低波篮子已从候选数量不足状态推进到真实候选数量 `3/3 completed`。后续主线转为 formal benchmark、交易约束和正式模型验证补齐。

## 2. 本阶段验收标准

必须满足以下条件之一才能收口：

1. 红利低波篮子真实候选达标：

```text
dividend_low_vol_basket.status=completed
selectedCandidateCount>=3
componentCount>=3
all components have dividend_low_vol_daily evidenceRefs
notTradingAdvice=true
prohibitedActions includes ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

2. 免费数据源无法达标时生成阻断审计：

```text
dividend_low_vol_basket.status=insufficient
candidate_expansion.status=blocked_by_real_data
blockedReasons explain real data gaps
localSampleSubstitutionAllowed=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

不允许通过以下方式出门：

- 用本地样本组合替代红利低波篮子。
- 用单只 100% 权重红利股票展示 completed 曲线。
- 放宽股息率、龙头、分红质量、低波动或 evidenceRefs 硬规则凑数。
- 把 price index 或 research proxy benchmark 包装成正式 total-return benchmark。
- 把 `tradeActionReadiness=true` 解释为正式交易可用。

## 3. 开发子阶段

### RBT-1 真实候选扩容

开发内容：

- 新增 `run:dividend-low-vol-basket-candidate-expansion`。
- 使用免费数据源和真实 `DividendLowVolDaily` 持久化。
- 分块扫描，chunk 后重新计算篮子状态，达到 `>=3` 即停止。
- 整批 provider 核心指标缺失时 dry-run，不污染候选池。

验收：

```bash
cd backend
npm run run:dividend-low-vol-basket-candidate-expansion
npm run test:dividend-low-vol-basket-snapshot
```

### RBT-2 组合回测与前端路径

开发内容：

- 红利低波篮子达标时进入 completed 曲线。
- 未达标时前端显示真实入篮数量、快照来源和 blockedReasons。
- 审计包输出 `07_dividend_low_vol_basket_snapshot_audit.json` 和候选扩容审计。

验收：

```bash
cd backend
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
npm run test:portfolio-backtest-frontend-runtime

cd frontend
npm run build
```

### RBT-3 PRD 规格检视与最终审计

开发内容：

- 更新 PRD、目标架构、阶段审计和 drawio 状态。
- 重新生成交互式策略回测审计包。
- 记录 formal blocker 和下一步阻断项。

验收：

```bash
cd backend
npm run run:interactive-strategy-backtest-audit-package
npm run test:production-readiness
npm run test:trade-action-readiness

cd ..
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
```

## 4. 高风险停机条件

出现以下情况必须停下来找用户确认：

- 需要降低红利低波硬规则。
- 需要配置 Tushare 或其他正式 provider 凭证。
- 需要执行破坏性数据库操作、迁移或大规模清库。
- 需要解锁正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。
- 免费源全量扫描后仍无法满足 3 只真实入篮标的。

## 5. 审计意见

当前无新增致命或重大规格偏差。`dividend_low_vol_basket` 只有在 3 个真实 evidence-backed 候选均存在时才标记 completed；主要虚假验收风险转为用研究代理 benchmark 解锁正式交易。后续执行必须坚持：

```text
research-ready is not formal-trading-ready
manual draft is not order creation
proxy benchmark is not formal total return
insufficient must stay insufficient
```

## 6. 2026-06-26 FTR-1 到 FTR-6 执行审计补充

本轮按正式交易 release 前置计划继续执行。结论：

```text
executionStatus=passed_for_current_formal_review_stage
fieldLevelDataGovernanceImproved=true
portfolioBacktestFormalReviewReady=true
longHorizonRealDataBacktestReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
orderCreateAllowed=false
canCreateOrder=false
releaseGateStatus=blocked
```

### 6.1 本轮实质改动

- 补齐 `PortfolioDataGradeItem.asOfDate`。
- `PortfolioBacktestEngine` 在策略级 `dataGradeAudit` 和 release 级 `dataGovernanceAudit` 中透传 `asOfDate`。
- insufficient 分支也显式输出 `asOfDate=null`，避免把缺口伪装成有证据。
- `verify-portfolio-backtest-formal-review-readiness.ts` 新增字段级数据治理断言，要求每个 release 字段具备 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / coveragePercent / evidenceRefs`。

### 6.2 真实数据验收结果

已执行并通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:portfolio-backtest-api-contract
npm run test:portfolio-backtest-formal-review-readiness
npm run test:portfolio-backtest-long-horizon
npm run test:fivd-r-trade-gate-contract
npm run test:production-readiness
npm run test:trade-action-readiness
npm run run:interactive-strategy-backtest-audit-package
npm run test:portfolio-backtest-frontend-runtime

cd frontend
npm run build
```

最新长周期验收：

```text
1y coverage=96.43%, completedStrategyCount=7, comparableStrategyCount=7
3y coverage=95.90%, completedStrategyCount=7, comparableStrategyCount=7
5y coverage=95.71%, completedStrategyCount=7, comparableStrategyCount=7
custom coverage=94.49%, completedStrategyCount=7, comparableStrategyCount=7
```

最新审计包：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/15_release_data_governance_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-12-17-124Z/03_frontend_runtime_and_operation_audit.json
```

`15_release_data_governance_audit.json` 已确认 `missingAsOfDate=[]`，样例字段包括：

```text
portfolio_backtest.price: asOfDate=2026-06-05, coverage=94.49, status=passed
portfolio_backtest.benchmark: asOfDate=2026-06-05, coverage=100, status=passed
portfolio_backtest.dividend: asOfDate=2026-06-05, coverage=100, status=passed
portfolio_backtest.tradeability: asOfDate=2026-06-05, coverage=99.58, status=passed
```

### 6.3 PRD 规格检视

本轮未改变产品边界。当前仍只能声明：

```text
researchReady=true
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
paperSandboxReviewReady=true
longHorizonRealDataBacktestReady=true
```

当前仍不能声明：

```text
formalTradingUnlocked 不得为 true
autoTradeUnlocked 不得为 true
orderCreateAllowed 不得为 true
canCreateOrder 不得为 true
formal ADD / REDUCE released
auto rebalance ready
```

### 6.4 剩余 release blocker

- `DataGovernanceStatus` 已补齐字段级 `asOfDate`，但正式 provider 和 official_authorized cross-check 仍未完成，release gate 继续 blocked。
- `BenchmarkQualificationStatus` 可支撑 formal review，但官方或可信 total-return benchmark 仍需最终复核。
- `FormalValidationStatus` 仍为 warning，参数敏感性和分组稳定性仍不能声明 formal passed。
- `ManualSignoffStatus=missing`，数据、模型、风控、合规、最终 release 签核未完成。
- `production_order_adapter_not_enabled` 和 `auto_trade_policy_locked` 继续阻断正式下单和自动交易。

审计意见：本轮可以收口为“正式交易 release 前置评审材料进一步完整”，不能收口为“正式交易 release 完成”。若下一轮要继续推进，优先级应为正式 provider/benchmark 凭证路线、formal validation 真重放、人工签核工作流，而不是继续扩展研究级页面功能。
