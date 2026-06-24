# FIVD-R Phase 18.10 黄金 TIPS / 通胀预期代理开发计划、验收标准与审计意见

日期：2026-06-03

## 1. 阶段目标

在 Phase 18.9 已补齐 DXY 美元趋势代理后，本阶段继续补齐黄金宏观代理：

```text
1. 使用真实 Nasdaq ETF 历史行情获取 TIP 和 IEF。
2. 使用 TIP 价格趋势构建 research-only 实际利率压力代理。
3. 使用 TIP / IEF 相对表现构建 research-only 通胀预期代理。
4. 移除 gold_real_rate_proxy_missing 和 gold_inflation_expectation_proxy_missing。
5. 明确这些是市场 ETF proxy，不是官方真实利率或 CPI/BEI 数据。
```

本阶段仍只服务 research/observe，不放行任何交易动作。

## 2. Provider 探测结论

已探测：

```text
Nasdaq TIP historical：可返回 126 条真实 ETF 日线。
Nasdaq IEF historical：可返回 126 条真实 ETF 日线。
Treasury real yield XML：当前返回 No results found。
FRED DFII10/T10YIE/DTWEXBGS：当前网络 15s 超时。
```

本阶段采用：

```text
TIP: iShares TIPS Bond ETF
IEF: iShares 7-10 Year Treasury Bond ETF
```

保守解释：

```text
TIP 价格上涨通常表示 TIPS 市场表现改善，不等于实际利率数值下降。
TIP/IEF 相对走强可作为通胀保护资产相对名义国债的市场 proxy，不等于正式通胀预期。
```

## 3. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/scripts/verify-fivd-r-gold-usd-trend-proxy-factset.ts
backend/package.json
```

新增：

```text
backend/scripts/verify-fivd-r-gold-tips-inflation-proxy-factset.ts
```

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 002611 GoldMacroFactSet.realRateProxy.status=available。
2. 002611 GoldMacroFactSet.inflationExpectationProxy.status=available。
3. realRateProxy 必须包含 TIP sampleSize、latestDate、20d/60d return、pressure。
4. inflationExpectationProxy 必须包含 TIP/IEF relativeReturn20dPct、relativeReturn60dPct、signal。
5. missingFields 不再包含 realRateProxy / inflationExpectationProxy。
6. blockedReasons 不再包含 gold_real_rate_proxy_missing / gold_inflation_expectation_proxy_missing。
7. GoldMacroFactSet 仍保持 partial，不得宣称交易级完整宏观模型。
8. FIVD-R formalTradeActionAllowed=false，autoTradeAllowed=false。
9. validation_evidence gate 不变，trade-action-readiness 仍按预期失败。
```

## 5. 禁止事项

```text
不能用 mock ETF 历史。
不能把 ETF proxy 表述为官方实际利率或官方通胀预期。
不能因为三个宏观 proxy 可用就放行交易。
不能绕过 validation_evidence。
不能生成 ADD / REDUCE / AUTO_TRADE。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- Nasdaq API 可能限流或结构变化。
- TIP/IEF proxy 只能解释市场相对表现，不能替代 FRED/官方宏观序列。
- ETF 价格含久期、信用、资金流等因素，解释必须保持保守。

闭环措施：

- provider 失败时保留 blocker。
- 输出 `method` 和 `provider`，明确 proxy 口径。
- 验收显式检查交易 gate 仍关闭。

结论：

允许进入实质开发。若 Nasdaq TIP/IEF 不返回真实数据，不以静态 mock 通过。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/scripts/verify-fivd-r-gold-tips-inflation-proxy-factset.ts
backend/scripts/verify-fivd-r-gold-usd-trend-proxy-factset.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
backend/package.json
```

新增 npm script：

```bash
npm run test:fivd-r-gold-tips-inflation-proxy-factset
```

真实验收结果：

```text
002611 / 黄金

realRateProxy.status=available
provider=nasdaq_historical
method=tips_etf_price_pressure_proxy_v1
symbol=TIP
sampleSize=126
latestDate=2026-06-02
latestValue=109.97
return20dPct=-0.9904
return60dPct=-1.4694
pressure=real_rate_pressure_up

inflationExpectationProxy.status=available
provider=nasdaq_historical
method=tips_vs_treasury_etf_relative_proxy_v1
symbols=["TIP","IEF"]
sampleSize=126
latestDate=2026-06-02
relativeReturn20dPct=-0.6857
relativeReturn60dPct=1.1549
signal=inflation_expectation_up
```

当前黄金 blocker：

```text
[]
```

已闭环：

```text
missingFields 不再包含 realRateProxy / inflationExpectationProxy。
blockedReasons 不再包含 gold_real_rate_proxy_missing / gold_inflation_expectation_proxy_missing。
evidenceRefs 包含 gold-real-rate-proxy 和 gold-inflation-expectation-proxy。
sourceRefs 指向 Nasdaq TIP/IEF historical API。
```

仍保留：

```text
GoldMacroFactSet.status=partial
valuation.conclusion=insufficient
validation_evidence gate
```

审计结论：

- Phase 18.10 通过真实数据验收。
- TIP/IEF 只作为 ETF 市场代理，不是官方实际利率或官方通胀预期。
- 黄金自身宏观缺口已闭环，但 FIVD-R 交易动作仍被 validation_evidence 阻断。
- 未放行 ADD / REDUCE / AUTO_TRADE。
