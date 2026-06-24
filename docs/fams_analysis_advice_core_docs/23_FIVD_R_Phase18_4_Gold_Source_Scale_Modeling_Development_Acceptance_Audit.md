# FIVD-R Phase 18.4 黄金源分层与价格尺度建模开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

在 Phase 18.1-18.3 已经发现黄金历史价格尺度混用后，本阶段目标是建立黄金数据源分层和价格尺度选择规则。

当前真实数据：

```text
002611 / 黄金 currentPrice ~= 986
price_history:goldFund ~= 974-1036
market_bar_canonical:sina ~= 16-20
```

结论：

- `price_history:goldFund` 与当前黄金持仓价格同尺度，更接近实物金价/克。
- `market_bar_canonical:sina` 更像黄金基金/ETF交易价格或净值尺度。
- 两者不能合并计算收益、波动和回撤。

## 2. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
```

新增逻辑：

1. 黄金历史读取不再简单合并 `priceHistory` 和 `marketBarCanonical`。
2. 按 source family 分组：
   - `physical_gold_price_proxy`：`price_history:goldFund`
   - `fund_or_etf_trade_price`：`market_bar_canonical:*`、`price_history:sina`、`price_history:eastmoney`
3. 选择与当前 `position.currentPrice` / `asset.lastPrice` 同尺度的 source family。
4. 未选中的 source family 进入 `excludedSources`，不参与指标计算。
5. 选中序列仍要跑 20% 单日涨跌 gate。
6. 如果选中序列样本不足，保持 `insufficient`，不能伪造成 `available`。

## 3. 验收标准

必须使用真实本地数据。

必须通过：

```text
1. 002611 黄金选择 price_history:goldFund 或同尺度 source。
2. market_bar_canonical:sina 被排除，不参与黄金实物价格指标。
3. priceScaleCheck 不再因混合尺度失败。
4. 如果 goldFund 去重后样本不足，status=insufficient。
5. blockedReasons 包含 gold_price_history_insufficient 或 gold_macro_proxy_missing。
6. 不允许输出 5000%+ 异常收益。
7. trade gate 不变。
```

## 4. 禁止事项

```text
不能把基金/ETF交易价格自动换算成实物金价，除非有明确 conversion rule。
不能把不同尺度历史合并计算。
不能为了通过验收放宽 20% 单日波动 gate。
不能因为黄金口径修复而放行 ADD / REDUCE / AUTO_TRADE。
```

## 5. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- `goldFund` 历史样本可能不足，导致黄金 factset 仍为 `insufficient`。
- 未实现正式 conversion rule 前，ETF/联接基金价格只能排除，不能混入实物金价序列。

结论：

允许进入实质开发。若实现后仍出现混合尺度、异常收益被计算、或 `market_bar_canonical:sina` 未被排除，必须打回计划阶段。

## 6. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
```

已实现：

- `GoldMacroFactSet.sourceSelection`
- 黄金 source family：
  - `physical_gold_price_proxy`
  - `fund_or_etf_trade_price`
  - `unknown`
- 与当前持仓价格同尺度的 source selection。
- 未选中 source 进入 `excludedSources`。
- 选中 source 后仍执行 20% 单日波动 gate。

真实验收结果：

```text
gold symbol=002611
referencePrice=986.49
selectedFamily=physical_gold_price_proxy
selectedSources=["price_history:goldFund"]
excludedSources includes market_bar_canonical:sina
priceScaleCheck.status=passed
maxAbsDailyReturnPct=2.7999
sampleSize=6
status=insufficient
blockedReasons=["gold_price_history_insufficient","gold_macro_proxy_missing"]
```

审计结论：

- 混合尺度问题已闭环。
- `market_bar_canonical:sina` 不再参与黄金实物价格指标计算。
- 因 `goldFund` 去重后只有 6 条样本，黄金 factset 仍保持 `insufficient`。
- 未放行交易动作。
