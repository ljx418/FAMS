# S2 Wave A 失败与重规划

日期：2026-09-12

## 提交前当前时点复验失败

```text
command=npm run test:current-market-data-freshness
result=FAIL
failureCategory=current_scope_added_symbols_without_canonical_bars
freshnessStatus=unknown
```

全系统 E2E 通过后，active-strategy 当前范围新增 30 个没有本地 canonical bars 的目标。执行时真实时钟验收因此正确失败，没有沿用稍早的 11 fresh / 289 delayed 结果冒充提交时状态。

## 定向修复与结果

按准入计划执行：

```bash
FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run run:current-market-data-freshness-remediation
npm run test:current-market-data-freshness
```

定向刷新只写 `market_bar_canonical` 研究缓存，不修改账户、成交或订单事实。结果：

```text
remediationTargetCount=30
completedTargetCount=30
failedTargetCount=0
expectedLatestTradeDate=2026-09-11
latestTradeDate=2026-09-11
freshSymbols=46
delayedOneTradingDaySymbols=254
staleSymbols=0
unknownSymbols=0
blockers=[]
retryDecision=PASS
```

`delayed` 表示范围中存在比预期日晚一个交易日的免费源数据，不代表所有 300 个目标都达到当日。S2 允许最多延迟一个交易日用于研究，但不得据此声明正式交易数据就绪。
