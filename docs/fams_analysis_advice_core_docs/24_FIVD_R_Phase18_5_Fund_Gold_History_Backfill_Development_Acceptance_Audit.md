# FIVD-R Phase 18.5 基金/债基 NAV 与黄金 goldFund 历史补齐开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

在 Phase 18.4 已解决黄金价格尺度混用后，本阶段目标是补齐真实历史样本：

```text
1. 基金/债基：从东方财富历史净值接口补齐 NAV history。
2. 黄金：使用 goldFund 对应的真实基金历史净值，按已有 factor 转换为实物金价/克代理历史。
```

本阶段仍只服务 research/observe，不放行交易动作。

## 2. 当前真实缺口

```text
009725 / 中期债（一年）：本地历史 6 条，fund factset insufficient
002611 / 黄金：goldFund 同尺度历史去重后 6 条，gold factset insufficient
```

已有工具：

```text
backend/src/utils/fundUtils.ts#getFundHistory
```

可从东方财富 `lsjz` 获取真实历史净值。

## 3. 开发任务

新增：

```text
backend/src/services/valuation/alternativeAssetHistoryBackfillService.ts
backend/scripts/verify-fivd-r-alternative-history-backfill.ts
```

修改：

```text
backend/package.json
```

服务职责：

- 对基金/债基持仓按 symbol 拉取 6M 历史净值。
- 写入 `priceHistory`，source=`eastmoney_nav_history`。
- 对黄金持仓 `002611` 拉取 goldFund 历史净值，并按 factor 转换为金价/克代理。
- 写入 `priceHistory`，source=`goldFund`。
- 使用 upsert/delete-create 或查重，避免同一天重复污染。
- 输出 backfill report。

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 009725 backfill 后本地历史样本数 >= 20。
2. 002611 goldFund backfill 后同尺度历史样本数 >= 20。
3. 009725 FundLikeFactSet 至少 20d window 可计算。
4. 002611 GoldMacroFactSet 选择 price_history:goldFund。
5. 002611 priceScaleCheck.status=passed。
6. 002611 不再出现 5000%+ 异常收益。
7. 如果 provider 返回不足，必须保持 insufficient 并输出 provider failure，不得伪造。
8. trade gate 不变。
```

## 5. 禁止事项

```text
不能生成 mock 历史。
不能用随机数补齐缺失日期。
不能把 ETF交易价与实物金价代理混写为同一 source。
不能删除用户原始持仓。
不能让 validation_evidence gate 通过。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- 东方财富接口可能失败或返回样本不足；验收必须允许 insufficient。
- goldFund factor 是当前系统已有换算规则，仍属于代理，不是正式交易所金价。
- 写入 `priceHistory` 会改变本地缓存，需要 source 明确、日期去重、不可覆盖用户持仓。

闭环措施：

- 只写 `priceHistory`。
- source 分别为 `eastmoney_nav_history` 和 `goldFund`。
- 验收读取 factset 结果确认 sourceSelection 和 scale gate。

结论：

允许进入实质开发。若 provider 失败或样本不足，不视为代码失败，但不得宣称 factset available。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetHistoryBackfillService.ts
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/scripts/verify-fivd-r-alternative-history-backfill.ts
```

新增 npm script：

```bash
npm run test:fivd-r-alternative-history-backfill
```

打回与修复记录：

1. 首次验收失败：
   - axios 调用东方财富历史净值接口出现 `ECONNRESET`。
   - 修复：改用 `getJsonWithCurlOnly`。

2. 第二次验收失败：
   - `pageSize=260` 导致东方财富返回空结果。
   - 修复：改为 `pageSize=20` 分页拉取。

3. 第三次验收失败：
   - DB 中 `goldFund` 已有足够样本，但 factset 读取时被 `market_bar_canonical` 同日覆盖。
   - 修复：黄金 source selection 使用 unmerged history，源分层前不跨 source 覆盖。

最终真实验收结果：

```text
backfill targets=14
completedTargets=14
provider=eastmoney_lsjz
```

基金样本：

```text
009725 / 中期债（一年）
sampleSize=117
status=partial
20d window available
rollingReturnPct=-0.1723
annualizedVolatilityPct=1.2395
maxDrawdownPct=-0.5072
blockedReasons=[
  "fund_profile_factset_missing",
  "fund_fee_factset_missing",
  "fund_holdings_factset_missing"
]
```

黄金样本：

```text
002611 / 黄金
sampleSize=121
status=partial
selectedSources=["price_history:goldFund"]
excludedSources includes market_bar_canonical:sina
priceScaleCheck.status=passed
maxAbsDailyReturnPct=11.1953
20d window available
rollingReturnPct=-4.3957
annualizedVolatilityPct=12.7726
maxDrawdownPct=-5.7146
blockedReasons=["gold_macro_proxy_missing"]
```

审计结论：

- Phase 18.5 通过真实数据验收。
- 基金/债基 NAV 历史已补齐到可计算研究级风险收益窗口。
- 黄金 goldFund 同尺度历史已补齐并可计算研究级风险收益窗口。
- fund/gold 仍为 `partial`，因为基金 profile/fee/holdings 和黄金宏观代理仍缺失。
- 交易 gate 不变。
