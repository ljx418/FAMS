# FIVD-R Phase 18.8 债基持仓 / 信用风险代理开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

在 Phase 18.7 已补齐基金 profile/fee 后，本阶段继续收敛债基事实集缺口：

```text
1. 使用真实东方财富 F10 资产配置页补齐 bondAllocationPct。
2. 使用真实东方财富 F10 债券持仓接口补齐 topBondHoldings。
3. 基于债券名称做 research-only 信用风险 proxy。
4. 将原来的 bond_duration_credit_proxy_missing 拆成更准确的缺口。
5. 不宣称真实久期已完成。
```

本阶段不放行交易动作。

## 2. 当前真实缺口

Phase 18.7 样本：

```text
009725 / 中期债（一年）
blockedReasons=[
  "fund_risk_level_missing",
  "bond_duration_credit_proxy_missing"
]
```

真实 provider 探测：

```text
https://fundf10.eastmoney.com/zcpz_009725.html
可提取：2026-03-31 股票占净比 7.41%、债券占净比 92.68%、现金占净比 0.24%、净资产 7.18 亿元。

https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=zqcc&code=009725&topLine=10
可提取：2026-03-31 前五大债券持仓、占净值比例、持仓市值。
```

## 3. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/src/services/analysis/dataGapSummaryService.ts
backend/package.json
```

新增：

```text
backend/scripts/verify-fivd-r-bond-fund-credit-proxy-factset.ts
```

服务职责：

- 在 `FundLikeFactSet` 中新增 `bondRiskProxy` 子事实集。
- 解析资产配置最新报告期。
- 解析前十大债券持仓。
- 计算 top bond concentration。
- 根据债券名称做保守信用风险 proxy：
  - 银行二级资本债、永续债、次级债等标记为 `subordinated_or_capital_bond_exposure`。
  - 证券公司、城投/平台、企业债等标记为对应 exposure。
- 只移除信用风险 proxy 缺口。
- 久期仍保留 `bond_duration_proxy_missing`。

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 009725 bondRiskProxy.status=available 或 partial。
2. 009725 必须输出 latestAllocation.bondPct。
3. 009725 必须输出 topBondHoldings，至少 5 条。
4. 009725 必须输出 topBondConcentrationPct。
5. 009725 必须输出 creditRiskFlags。
6. bond_credit_risk_proxy_missing 应从 009725 移除。
7. bond_duration_proxy_missing 必须继续保留。
8. FIVD-R formalTradeActionAllowed=false，autoTradeAllowed=false。
9. validation_evidence gate 不变，trade-action-readiness 仍按预期失败。
```

## 5. 禁止事项

```text
不能把债券名称启发式当成正式评级。
不能用发行年份推导精确久期。
不能因为信用 proxy 可用就把债基事实集标为 available。
不能绕过 validation_evidence。
不能生成 ADD / REDUCE / AUTO_TRADE。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- 东方财富债券持仓只给前几大持仓，不能覆盖全组合。
- 债券名称启发式只能用于 research-only 风险提示，不能替代评级。
- 资产配置可能存在杠杆/回购导致债券占净比超过 100%。
- 久期仍无真实来源，必须继续阻断。

闭环措施：

- 输出 `bondRiskProxy.method=top_bond_holding_name_heuristic_v1`。
- 保留 `bond_duration_proxy_missing`。
- 验收显式检查交易 gate 关闭。

结论：

允许进入实质开发。若真实 provider 不能返回债券持仓，继续保留信用 proxy 缺口，不以 mock 通过。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/src/services/analysis/dataGapSummaryService.ts
backend/scripts/verify-fivd-r-bond-fund-credit-proxy-factset.ts
backend/package.json
```

新增 npm script：

```bash
npm run test:fivd-r-bond-fund-credit-proxy-factset
```

真实验收结果：

```text
009725 / 中期债（一年）
bondRiskProxy.status=available
method=top_bond_holding_name_heuristic_v1
reportDate=2026-03-31
bondPct=92.68
stockPct=7.41
cashPct=0.24
netAssetBillion=7.18
topBondHoldings=5
topBondConcentrationPct=14.2
creditRiskFlags=[
  "subordinated_or_capital_bond_exposure",
  "bank_credit_exposure",
  "brokerage_credit_exposure"
]
```

009725 当前 blocker：

```text
[
  "fund_risk_level_missing",
  "bond_duration_proxy_missing"
]
```

已闭环：

```text
bond_credit_risk_proxy_missing 未出现在 009725。
creditRiskProxy missingField 已移除。
bond_duration_proxy_missing 继续保留。
sourceRefs 指向 zcpz_009725.html 和 type=zqcc 债券持仓接口。
evidenceRefs 包含 bond-risk-proxy:009725:2026-03-31。
```

审计结论：

- Phase 18.8 通过真实数据验收。
- 债券持仓和信用风险代理已接入，但只作为 research-only 启发式。
- 久期、到期收益率和利率敏感性仍未完成。
- validation_evidence 仍是交易动作硬 blocker。
