# 测试与验证清单

版本：v0.1  
日期：2026-05-31

---

# 1. 单元测试

## 1.1 EvidenceGateService

必须覆盖：

```text
asset type unknown => blocked
coverage failed => blocked
price stale => partial / blocked
provider conflict severe => blocked
cash asset => pass with cash_no_action
validation evidence failed => formal ADD blocked
```

## 1.2 StockValuationModel

必须覆盖：

```text
sufficient data 输出 available
missing fundamentals 输出 partial
missing valuation data 降低 confidence
high financial risk 提高 financialRiskScore
poor trend 降低 timingScore
high concentration 降低 portfolioFitScore
```

## 1.3 EtfValuationModel

必须覆盖：

```text
sufficient index data
missing index valuation => partial
low liquidity lowers score
high fee lowers score
duplicate exposure lowers portfolioFitScore
```

## 1.4 GoldValuationModel

必须覆盖：

```text
macro facts sufficient
macro facts missing => observation only
gold does not use PE/PB
portfolio hedge value affects score
```

## 1.5 CashNoActionModel

必须覆盖：

```text
cash_no_action
NO_ACTION only
no valuationScore-based ADD
```

## 1.6 PositionAdviceImpactAdapter

必须覆盖：

```text
valuationScore 高映射 valuationMultiplier
evidence insufficient blocks ADD
validation failed formalTradeActionAllowed=false
financialRiskScore 高降低 riskPenaltyMultiplier
cash only NO_ACTION
```

---

# 2. 概率分布测试

## 2.1 ExpectedReturnDistributionService

必须覆盖：

```text
normal sample 输出 p05/p25/p50/p75/p95
small sample confidence=insufficient
extreme volatility raises expectedMaxDrawdown
stopLossPct 计算 probabilityOfStopLoss
takeProfitPct 计算 probabilityOfTakeProfit
```

---

# 3. TradingDisciplineEngine 测试

必须覆盖：

```text
core bucket max drawdown exceeded => no add
satellite bucket generates stopConditions
satellite bucket generates validUntil
cash bucket no_action
insufficient data => watch_only
```

---

# 4. Replay 测试

## 4.1 无未来函数

必须确保：

```text
reviewDate 后的数据不能被读取。
reviewDate 后的财报不能被读取。
reviewDate 后的新闻不能被读取。
reviewDate 后的交易状态不能被读取。
```

建议测试：

```text
构造未来价格大涨样本，确认 reviewDate 时模型不知道未来上涨。
```

## 4.2 Gate-Strict

必须覆盖：

```text
validation evidence failed 时不执行 formal ADD。
research_only 可记录理论动作，但标记不可作为正式建议。
```

## 4.3 交易追溯

必须覆盖：

```text
每笔 simulated_trade 有 decision_id。
每个 decision 有 evidenceRefs。
每个 replay snapshot 可追踪 slice_id。
```

---

# 5. 动作质量测试

必须输出：

```text
ADD_success_rate
REDUCE_success_rate
HOLD_success_rate
OBSERVE_opportunity_cost
AVOID_avoided_loss
average_return_after_ADD
average_return_after_REDUCE
```

测试数据需要覆盖：

```text
ADD 后上涨
ADD 后下跌
REDUCE 后下跌
REDUCE 后上涨
OBSERVE 后大涨
AVOID 后大跌
```

---

# 6. 概率校准测试

必须输出：

```text
p05_p95_coverage
p25_p75_coverage
gainProbabilityCalibration
stopLossProbabilityError
takeProfitProbabilityError
expectedReturnError
drawdownUnderestimateRate
```

验收：

```text
预测区间覆盖率可计算。
预测上涨概率 bucket 可计算。
模型过度乐观时能产生 warning。
```

---

# 7. 人工干预测试

必须覆盖：

```text
intervention append-only
不能覆盖历史 decision log
model_only vs human_override 可比较
reason 必填或可配置
```

---

# 8. Champion / Challenger 测试

必须覆盖：

```text
创建 challenger
运行 challenger replay
生成 model_comparison_report
未通过验证不能 promote
promote 需要人工确认
旧 champion 被 archived 或保留历史状态
```

---

# 9. 前端验收清单

分析建议卡必须展示：

```text
thesisType
formalTradeActionAllowed
valuationScore
qualityScore
growthScore
financialRiskScore
timingScore
portfolioFitScore
evidenceQualityScore
p05 / p50 / p95
probabilityOfGain
probabilityOfLoss
validUntil
reviewCadence
addConditions
reduceConditions
stopConditions
takeProfitConditions
invalidationConditions
missingData
blockedReasons
evidenceRefs
```

模型验证页必须展示：

```text
3m / 2m / 1m 起点回放
FAMS vs BuyHold vs Benchmark
最终市值
累计收益
最大回撤
每周建议时间线
模拟交易明细
动作质量统计
概率校准结果
人工干预前后对比
Champion / Challenger 对比
```

---

# 10. 上线前硬门禁

任何一条不满足都不能上线为正式分析建议：

```text
1. 无 evidenceRefs。
2. 关键数据缺失但输出确定性建议。
3. validation evidence failed 仍允许 formal ADD。
4. Replay 存在未来函数。
5. 概率分布样本不足却标记 high confidence。
6. 核心仓预计回撤超过风险预算仍建议加仓。
7. 卫星仓没有止损/有效期。
8. 人工干预覆盖历史结果而不是 append-only。
9. Challenger 未验证直接 promote。
10. AI 解释层新增了模型没有支持的交易建议。
```

---

# 11. 2026-06-02 FIVD-R Phase 12-15 验收补充

## 11.1 必跑命令

后端：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:fivd-r-trade-gate-contract
npm run test:fivd-r-validation-taxonomy
npm run test:trade-action-readiness
```

前端：

```bash
cd frontend
npm run build
```

预期：

- `tsc` 通过。
- `test:fivd-r-core` 通过。
- `test:production-readiness` 通过。
- `test:fivd-r-trade-gate-contract` 通过。
- `test:fivd-r-validation-taxonomy` 通过。
- `frontend build` 通过。
- `test:trade-action-readiness` 在真实 `validation_evidence` 未通过时必须失败，且失败原因应仍为 `validation_evidence`。

## 11.2 DataGapSummary 验收

必须覆盖：

```text
portfolio summary 返回 dataGapSummary
position detail 返回 dataGapSummary
holdings research 返回 dataGapSummary
candidate scoring 返回 dataGapSummary
manual trade draft blocked response 返回 dataGapSummary
validation retest audit 返回 dataGapSummary
```

每个 gap 必须包含：

```text
severity
category
missingFields
requiredFor
suggestedAction
evidenceRefs
```

禁止：

```text
通过隐藏 data gaps 把 partial/blocked 包装为 available
```

## 11.3 Candidate Scoring 验收

必须覆盖：

```text
signalScore
researchScore
evidenceAdjustedScore
默认按 evidenceAdjustedScore 排名
asset_identity_missing => needs_more_evidence
validation_evidence failed => 禁止 ADD / REDUCE / AUTO_TRADE
```

前端必须清楚显示：

```text
高策略信号但证据不足
allowedActions
prohibitedActions
dataGapSummary
```

## 11.4 Trade Gate Contract 验收

`npm run test:fivd-r-trade-gate-contract` 必须覆盖：

```text
portfolio summary validation failed => prohibit ADD/REDUCE/AUTO_TRADE
position detail validation failed => formalTradeActionAllowed=false
candidate scoring validation failed => no ADD/REDUCE/AUTO_TRADE allowed
manual trade draft validation failed => status=blocked
LLM explanation cannot output imperative trade instructions
snapshot/watch/risk-alert cannot create transactions
```

## 11.5 Validation Failure Taxonomy 验收

`npm run test:fivd-r-validation-taxonomy` 必须覆盖：

```text
validation retest creates validation_failure_taxonomy.json
latest validation report API returns fivd.r.validation_failure_taxonomy.v1
taxonomy contains failureCategories
taxonomy keeps tradeActionAllowed=false
taxonomy keeps manualTradeDraftAllowed=false
taxonomy keeps autoTradeAllowed=false
taxonomy prohibits ADD / REDUCE / AUTO_TRADE
```

当前真实失败类别应至少可解释：

```text
validation_evidence
out_of_sample
parameter_sensitivity
market_regime
sample_size
```

## 11.6 Data Gap Remediation 验收

新增命令：

```bash
cd backend
npm run test:fivd-r-data-gap-remediation
```

必须覆盖：

```text
latest summary dataGapSummary 可生成 remediation plan
validation_evidence gap 映射到 run_validation_retest_audit
fundamental/valuation/financial_report stock gap 映射到 refresh_stock_factset
fund gap 标记为 unsupported
gold macro gap 标记为 unsupported
validation retest execution 不放行 tradeActionAllowed
asset_identity_missing with symbol 映射到 resolve_asset_identity
resolve_asset_identity 使用 fivd_r_asset_identity_resolution Operation
```

禁止：

```text
unsupported gap 被标记为 executable
planned gap 被包装为 completed
补数/复验动作改变 validation_evidence gate
补数/复验动作让 ADD / REDUCE / AUTO_TRADE 可用
```

## 11.7 Asset Identity Remediation 验收

新增命令：

```bash
cd backend
npm run test:fivd-r-asset-identity-remediation
```

必须覆盖：

```text
symbol 级 asset_identity_missing 变成 executable
无 symbol 的 asset_identity_missing 仍保持 planned
生成 fivd.r.asset_identity_resolution_report.v1
解析结果区分 matched official asset、lightweight research identity 和 unresolved
无效 symbol 不能被伪造成 resolved
正式 Asset 表记录数保持不变
allowedActions 仅包含 RESEARCH / OBSERVE
prohibitedActions 包含 ADD / REDUCE / AUTO_TRADE
artifactRefs 包含 asset_identity_resolution_report.json
```

禁止：

```text
解析候选身份时创建正式资产账本记录
用 research identity 替代完整 factset
用身份解析结果绕过 validation_evidence gate
```

## 11.8 Market Data Remediation 验收

新增命令：

```bash
cd backend
npm run test:fivd-r-market-data-remediation
```

必须覆盖：

```text
market_data/provider_health gap with symbol => executable
operationType=market_bar_cache_preheat
queued worker 执行时保留 symbols
result.requestedSymbols 等于输入 symbol 数
artifactRefs 包含 market_bar_cache_preheat_report.json
artifact 包含 beforeCoverage / afterCoverage / featureReport
provider 或样本不足时保持 partial/warnings，不伪造成通过
```

禁止：

```text
worker replay 回退到默认 universe
无 symbol market gap 被标记为 executable
行情预热结果改变 validation_evidence gate
行情预热放行 ADD / REDUCE / AUTO_TRADE
```
