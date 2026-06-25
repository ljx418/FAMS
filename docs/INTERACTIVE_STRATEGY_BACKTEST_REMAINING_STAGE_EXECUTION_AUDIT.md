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
