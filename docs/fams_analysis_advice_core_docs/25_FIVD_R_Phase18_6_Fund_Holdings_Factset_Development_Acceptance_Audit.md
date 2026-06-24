# FIVD-R Phase 18.6 基金持仓风格事实集开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

在 Phase 18.5 已补齐基金/债基 NAV 历史后，本阶段继续把基金 broad blocker 拆细：

```text
1. 使用真实东方财富 F10 持仓接口补齐 fund holdings factset。
2. 从前十大持仓推导 research-only 的 holdingsStyle、top10 集中度和股票持仓暴露。
3. 对已取得 holdings 的基金移除 fund_holdings_factset_missing。
4. 未取得 holdings 的基金继续保留 partial/blocked data gap，不伪造可用。
```

本阶段不接入正式 fee、manager、fundScale、riskLevel，也不放行交易动作。

## 2. 当前真实缺口

Phase 18.5 真实验收显示：

```text
009725 / 中期债（一年）
NAV sampleSize=117
20d window available
blockedReasons=[
  "fund_profile_factset_missing",
  "fund_fee_factset_missing",
  "fund_holdings_factset_missing"
]
```

真实 provider 探测：

```text
https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=009725&topLine=10
返回 2026-03-31 股票投资明细，可解析前十大持仓。
```

## 3. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
backend/package.json
```

新增：

```text
backend/scripts/verify-fivd-r-fund-holdings-factset.ts
```

服务职责：

- 在 `FundLikeFactSet` 中新增 `holdings` 子事实集。
- 使用 curl 调用东方财富 F10 `FundArchivesDatas.aspx?type=jjcc`。
- 解析 reportDate、stockCode、stockName、proportion、shares、marketValue。
- 计算 `top10ConcentrationPct`。
- 根据 top10 集中度和持仓数量推导 `holdingsStyle`。
- provider 失败、返回空、HTML 格式变化时保留 `fund_holdings_factset_missing`。

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 至少一个真实 open fund/bond_fund/etf 持仓返回 holdings.status=available。
2. holdings.available 时必须有 reportDate、topHoldings、top10ConcentrationPct、holdingsStyle。
3. holdings.available 的标的不能再包含 fund_holdings_factset_missing。
4. profile/fee 未接入时仍保留 fund_profile_factset_missing、fund_fee_factset_missing。
5. holdings.unavailable 的标的继续保留 fund_holdings_factset_missing。
6. value assessment providerTrace 必须包含 fundLikeFactSet.holdings。
7. FIVD-R formalTradeActionAllowed=false，autoTradeAllowed=false。
8. validation_evidence gate 不变，trade-action-readiness 仍按预期失败。
```

## 5. 禁止事项

```text
不能用 mock holdings。
不能把 holdingsStyle 当作完整基金 profile。
不能因为 holdings 可用就把基金 factset 改为 available。
不能删除 profile/fee 缺口。
不能绕过 validation_evidence。
不能生成 ADD / REDUCE / AUTO_TRADE。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- 东方财富 F10 HTML 结构可能变化。
- 债基的股票持仓明细不等于完整债券久期/信用风险事实集。
- top10 股票持仓只能推导研究级风格，不能替代正式基金合同、季报和费用数据。

闭环措施：

- 使用 providerTrace/evidenceRefs 暴露来源。
- provider 失败时保留 blocker。
- 只移除 holdings blocker，不移除 profile/fee blocker。
- 验收显式检查 trade gate 仍关闭。

结论：

允许进入实质开发。若真实 provider 不返回 holdings，本阶段验收打回，不以静态 mock 通过。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/scripts/verify-fivd-r-fund-holdings-factset.ts
backend/package.json
```

新增 npm script：

```bash
npm run test:fivd-r-fund-holdings-factset
```

真实验收结果：

```text
checkedPositions=13
availableHoldingsCount=8
unavailableHoldingsCount=5
```

样本：

```text
009725 / 中期债（一年）
assetType=bond
NAV sampleSize=117
holdings.status=available
provider=eastmoney_f10_jjcc
reportDate=2026-03-31
top10ConcentrationPct=3.11
holdingsStyle=low_equity_or_bond_like
```

009725 当前 blocker：

```text
[
  "fund_profile_factset_missing",
  "fund_fee_factset_missing"
]
```

已闭环：

```text
fund_holdings_factset_missing 已从 009725 移除。
providerTrace.fundLikeFactSet.holdings 可审计。
evidenceRefs 包含 fund-holdings:009725:2026-03-31。
sourceRefs 包含 Eastmoney F10 FundArchivesDatas.aspx。
```

仍保留：

```text
fund_profile_factset_missing
fund_fee_factset_missing
durationProxy / creditRiskProxy 缺口
validation_evidence gate
```

未取得 holdings 的样本继续保留 `fund_holdings_factset_missing`，包括：

```text
021634 / 恒生科技
014086 / 中期债（半年）
014674 / 港股互联网
015311 / 恒生科技
019062 / 软件etf
```

审计结论：

- Phase 18.6 通过真实数据验收。
- 已把基金 holdings broad blocker 转成 provider 可追溯事实集。
- 可用 holdings 只改善 research/observe 可信度，不改变 trade gate。
- profile/fee 仍未完成，不能宣称基金事实集完整。
- validation_evidence 仍是交易动作硬 blocker。
