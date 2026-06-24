# FIVD-R Phase 18.9 黄金美元趋势代理开发计划、验收标准与审计意见

日期：2026-06-03

## 1. 阶段目标

在黄金价格历史和尺度 gate 已完成后，本阶段补齐黄金宏观代理的第一段：

```text
1. 使用真实公开行情数据获取 DXY / 美元指数趋势。
2. 在 GoldMacroFactSet 中输出 usdTrendProxy。
3. 移除 usdTrend 缺口。
4. 实际利率和通胀预期仍保留 blocker，不伪造完整宏观事实集。
```

本阶段仍只服务 research/observe，不放行交易动作。

## 2. Provider 探测结论

已探测：

```text
Yahoo chart: DX-Y.NYB 可返回 DXY 日线。
Nasdaq UUP historical 可返回 UUP ETF 日线。
FRED CSV: DFII10 / T10YIE / DTWEXBGS 在当前网络环境下 15s 超时。
Stooq CSV: 要求 apikey，不适合自动验收。
```

本阶段采用：

```text
Yahoo chart DX-Y.NYB
```

保守边界：

```text
只把 DXY 作为 usdTrendProxy。
不把 DXY 代理为实际利率。
不把 DXY 代理为通胀预期。
```

## 3. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/src/services/analysis/dataGapSummaryService.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
backend/package.json
```

新增：

```text
backend/scripts/verify-fivd-r-gold-usd-trend-proxy-factset.ts
```

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 002611 GoldMacroFactSet.usdTrendProxy.status=available。
2. usdTrendProxy 必须包含 sampleSize、latestDate、latestValue、20d/60d return。
3. missingFields 不再包含 usdTrend。
4. blockedReasons 不再使用 broad gold_macro_proxy_missing 表示所有宏观代理缺失。
5. 仍必须保留 gold_real_rate_proxy_missing。
6. 仍必须保留 gold_inflation_expectation_proxy_missing。
7. 黄金价格尺度 gate 继续 passed。
8. FIVD-R formalTradeActionAllowed=false，autoTradeAllowed=false。
9. validation_evidence gate 不变，trade-action-readiness 仍按预期失败。
```

## 5. 禁止事项

```text
不能用 mock DXY。
不能用 DXY 代替实际利率或通胀预期。
不能因为 usdTrend 可用就把 GoldMacroFactSet 改为 available。
不能绕过 validation_evidence。
不能生成 ADD / REDUCE / AUTO_TRADE。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- Yahoo chart 可能限流；验收失败时必须保留 usdTrend 缺口。
- DXY 是美元趋势代理，不是黄金完整宏观模型。
- 实际利率和通胀预期仍需后续稳定 provider。

闭环措施：

- provider 失败时保留 blocker。
- 成功时仅移除 usdTrend。
- 验收显式检查 realRate 和 inflation blocker 仍存在。

结论：

允许进入实质开发。若 Yahoo DXY 不返回真实数据，不以静态 mock 通过。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/analysis/dataGapSummaryService.ts
backend/scripts/verify-fivd-r-gold-usd-trend-proxy-factset.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
backend/package.json
```

新增 npm script：

```bash
npm run test:fivd-r-gold-usd-trend-proxy-factset
```

真实验收结果：

```text
002611 / 黄金
usdTrendProxy.status=available
provider=yahoo_chart
symbol=DX-Y.NYB
sampleSize=125
latestDate=2026-06-03
latestValue=99.32
return20dPct=1.3263
return60dPct=0.4958
trend=flat
```

当前黄金 blocker：

```text
[
  "gold_real_rate_proxy_missing",
  "gold_inflation_expectation_proxy_missing"
]
```

已闭环：

```text
missingFields 不再包含 usdTrend。
blockedReasons 不再包含 gold_usd_trend_proxy_missing。
sourceRefs 指向 Yahoo DXY chart。
evidenceRefs 包含 gold-usd-trend-proxy:DX-Y.NYB:2026-06-03。
黄金 priceScaleCheck.status=passed。
```

仍保留：

```text
gold_real_rate_proxy_missing
gold_inflation_expectation_proxy_missing
validation_evidence gate
```

审计结论：

- Phase 18.9 通过真实数据验收。
- DXY 只作为美元趋势代理，不替代实际利率或通胀预期。
- 黄金事实集仍为 partial，不宣称完整宏观模型。
- 交易 gate 未改变。
