# FIVD-R Phase 18.1-18.3 FactSet Schema 与本地指标开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

按照方案 D，先实现基金/债基与黄金的研究级事实集底座：

```text
Phase 18.1：FundLikeFactSet / GoldMacroFactSet schema 与 gate
Phase 18.2：基金/债基本地 NAV/价格历史指标
Phase 18.3：黄金本地价格与宏观代理事实集
```

本阶段不接商业 provider，不放行交易动作。

## 2. 当前代码事实

现有状态：

- `valueAssessmentService` 对基金/债基输出 `fund_like_value_factset_missing`。
- `valueAssessmentService` 对黄金输出 `gold_macro_value_factset_missing`。
- `priceService` 已有基金最新 NAV 和多源金价能力。
- `priceHistory` / `market_bar_canonical` 可作为本地历史数据来源。
- DataGap remediation 中 fund/gold 仍是 unsupported。

## 3. 开发任务

### 3.1 新增事实集类型

新增：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
```

定义：

```ts
FundLikeFactSet
GoldMacroFactSet
AlternativeAssetFactSetStatus
AlternativeAssetMetricWindow
```

### 3.2 本地历史指标

基金/债基：

- 从 `priceHistory` 和 `market_bar_canonical` 读取真实历史价格/NAV。
- 计算 20d/60d/120d rolling return。
- 计算 maxDrawdown。
- 计算 volatility。
- 样本不足时输出 partial，不伪造成 available。

黄金：

- 从持仓价格、`priceHistory`、黄金 ETF/黄金标的历史中读取真实历史。
- 计算 volatility/drawdown/rolling return。
- 当前 realRate/USD/inflation proxy 缺失时保留 partial。

### 3.3 接入价值评估

修改：

```text
backend/src/services/valuation/valueAssessmentService.ts
```

要求：

- 基金/债基不再只有 placeholder。
- 黄金不再只有 placeholder。
- 仍然保留缺失字段对应 blockedReasons。
- `fund_like_value_factset_missing` 可以在基础历史指标可用时降级为更具体的缺口：
  - `fund_profile_factset_missing`
  - `fund_holdings_factset_missing`
  - `fund_fee_factset_missing`
- `gold_macro_value_factset_missing` 可以拆成：
  - `gold_macro_proxy_missing`
  - `gold_price_history_insufficient`

### 3.4 验证脚本

新增：

```text
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
```

新增 npm script：

```bash
npm run test:fivd-r-fund-gold-local-factset
```

## 4. 验收标准

必须使用真实本地数据。

必须通过：

```text
1. 至少找到一个基金/债基持仓并输出 FundLikeFactSet。
2. 至少找到一个黄金持仓并输出 GoldMacroFactSet。
3. 所有指标样本量、sourceRefs、evidenceRefs 可追踪。
4. 样本不足时 status=partial 或 insufficient。
5. 不允许 fund/gold 输出股票 PE/PB 估值模型。
6. validation_evidence failed 时 formalTradeActionAllowed=false。
7. prohibitedActions 仍包含 ADD / REDUCE / AUTO_TRADE。
```

若本地没有黄金持仓：

```text
使用现有黄金资产或黄金价格源构造只读 factset smoke，不创建交易记录。
```

## 5. 禁止事项

```text
不能伪造 NAV/history/macros。
不能用随机数、未来数据或 mock 数据通过验收。
不能把 partial 包装成 available。
不能因为 fund/gold factset 改进而让 test:trade-action-readiness 通过。
不能让 LLM 输出买入、加仓、减仓指令。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- 本地基金历史数据可能不足，需允许 partial。
- 黄金宏观代理短期可能缺失，需保留 `gold_macro_proxy_missing`。
- 不同资产的 price history 口径可能不一致，必须输出 sourceRefs。

闭环措施：

- 验收脚本要求真实持仓/真实本地历史。
- 指标输出必须包含 sampleSize、window、asOf、sourceRefs。
- valueAssessment 只给 research 级结论，不输出交易动作。

结论：

允许进入 Phase 18.1-18.3 实质开发。若验收发现使用 mock、未来数据、随机数、或把 partial 包装为 available，必须打回计划阶段并停止。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
```

新增 npm script：

```bash
npm run test:fivd-r-fund-gold-local-factset
```

已实现：

- `FundLikeFactSet`：`fivd.r.fund_like_factset.v1`
- `GoldMacroFactSet`：`fivd.r.gold_macro_factset.v1`
- 基金/债基本地历史窗口：20d/60d/120d return、volatility、maxDrawdown。
- 黄金本地价格窗口：20d/60d/120d return、volatility、maxDrawdown。
- 黄金 `priceScaleCheck`：
  - 单日绝对涨跌超过 20% => `gold_price_scale_inconsistent`
  - factset 降级 `insufficient`
  - 所有窗口收益、波动、回撤置空
  - 输出 abnormalMoves 供审计

真实验收结果：

```text
基金样本：009725 / 中期债（一年）
fund factset status=insufficient
sampleSize=6
blockedReasons=["fund_nav_history_insufficient","fund_like_value_factset_missing"]
```

```text
黄金样本：002611 / 黄金
gold factset status=insufficient
sampleSize=132
blockedReasons=["gold_price_scale_inconsistent","gold_macro_proxy_missing"]
priceScaleCheck.status=failed
maxAbsDailyReturnPct=5790.407
```

黄金异常归因：

```text
market_bar_canonical:sina 价格约 17-19
price_history:goldFund 价格约 974-1013
同一 symbol 历史序列混入不同价格尺度
```

审计结论：

- 首次验收发现黄金收益异常，存在虚假验收风险，已打回实现阶段。
- 已按保守方案增加尺度一致性 gate。
- 修复后真实数据验收通过。
- 不宣称黄金 factset available。
- 不宣称基金/债基 factset 完整。
- 交易边界不变：`formalTradeActionAllowed=false`、`autoTradeAllowed=false`、`capabilityState=TRADE_BLOCKED`。
