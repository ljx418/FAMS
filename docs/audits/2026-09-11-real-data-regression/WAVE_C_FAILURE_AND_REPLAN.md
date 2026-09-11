# S2 Wave C 失败与重规划

日期：2026-09-12

## 轮动观察列表历史数量假设

```text
command=npm run test:relative-rotation-watchlist-real-data
result=FAIL
failureCategory=closed_set_fixture_drift
requiredResearchTargetsPresent=true
additionalCurrentWatchlistItems=1
businessComputationStarted=false
```

旧测试要求当前观察列表与三个历史研究标的完全相等。真实账户已增加一个观察标的，因此该断言错误地把正常用户数据变化识别为产品回归。

## 重规划

1. 三个跨周期研究基准继续作为必选子集，不降低已有覆盖。
2. 当前观察列表允许额外用户标的，但 `targetKey` 必须唯一并满足规范格式。
3. 真实周线、日线、样本充分性和多市场 canonical bar 计算继续逐项验证。
4. 验收输出只记录必选数和当前总数，不把用户观察标的清单写入公开审计。

```text
replanDecision=APPROVED_FOR_RETRY
fatalSpecificationDeviationCount=0
majorFalseAcceptanceRiskClosed=true
```
