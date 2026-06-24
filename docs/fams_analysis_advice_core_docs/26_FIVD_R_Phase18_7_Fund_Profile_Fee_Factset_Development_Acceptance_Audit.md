# FIVD-R Phase 18.7 基金 Profile / Fee 事实集开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

在 Phase 18.6 已接入基金前十大持仓风格后，本阶段继续补齐基金/债基 research-only 事实集：

```text
1. 使用真实东方财富 F10 基本概况页补齐基金 profile。
2. 使用真实东方财富 F10 费率页补齐运作费率。
3. 对 profile 和 fee 可用的基金移除 fund_profile_factset_missing、fund_fee_factset_missing。
4. 不把申赎费率、风险等级、债基久期/信用风险包装为已完成。
```

本阶段仍只服务 research/observe，不放行任何交易动作。

## 2. 当前真实缺口

Phase 18.6 真实验收样本：

```text
009725 / 中期债（一年）
holdings.status=available
blockedReasons=[
  "fund_profile_factset_missing",
  "fund_fee_factset_missing"
]
missingFields=[
  "fee",
  "manager",
  "fundScale",
  "riskLevel",
  "durationProxy",
  "creditRiskProxy"
]
```

真实 provider 探测：

```text
https://fundf10.eastmoney.com/jbgk_009725.html
可稳定提取：基金类型、管理人、基金经理人、净资产规模、成立日期、管理费率、托管费率、销售服务费率。

https://fundf10.eastmoney.com/jjfl_009725.html
可稳定提取：管理费率、托管费率、销售服务费率。
```

## 3. 开发任务

修改：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/package.json
```

新增：

```text
backend/scripts/verify-fivd-r-fund-profile-fee-factset.ts
```

服务职责：

- 在 `FundLikeFactSet` 中新增 `profile` 子事实集。
- 在 `FundLikeFactSet` 中新增 `fee` 子事实集。
- 使用 curl 获取东方财富 F10 HTML。
- 只解析可稳定定位的字段。
- provider 失败或字段缺失时保留对应 blocker。
- 输出 evidenceRefs/sourceRefs，便于 GPT/人工审计。

## 4. 验收标准

必须使用真实 provider 数据。

必须通过：

```text
1. 至少一个真实 open fund/bond_fund/etf 持仓返回 profile.status=available。
2. 至少一个真实 open fund/bond_fund/etf 持仓返回 fee.status=available。
3. 009725 若 provider 返回真实字段，则 profile/fee blocker 应移除。
4. fee 可用时至少包含 managementFeePct、custodianFeePct、salesServiceFeePct。
5. profile 可用时至少包含 fundCategory、managerNames、managementCompany、fundScaleText。
6. riskLevel 未接入时仍保留 riskLevel missing field。
7. 债基 durationProxy / creditRiskProxy 仍保留。
8. FIVD-R formalTradeActionAllowed=false，autoTradeAllowed=false。
9. validation_evidence gate 不变，trade-action-readiness 仍按预期失败。
```

## 5. 禁止事项

```text
不能用 mock profile/fee。
不能把申赎费率当作运作费率。
不能把 fee/profile 可用解释为基金事实集 complete。
不能删除 riskLevel、durationProxy、creditRiskProxy 缺口。
不能绕过 validation_evidence。
不能生成 ADD / REDUCE / AUTO_TRADE。
```

## 6. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- 东方财富 F10 HTML 结构可能变化。
- 基金规模文本可能包含日期，需保留原文，不做过度数值化。
- fee 页与 profile 页都含费率字段，解析冲突时以 fee 页为准。
- riskLevel、久期、信用风险仍未接入，不得宣称交易级事实集完整。

闭环措施：

- 字段缺失即保留 blocker。
- evidenceRefs/sourceRefs 必须记录真实来源。
- 只移除 profile/fee blocker，不触碰 validation gate。
- 验收显式检查 `formalTradeActionAllowed=false`、`autoTradeAllowed=false`。

结论：

允许进入实质开发。若真实 provider 无法返回 profile/fee，本阶段验收打回，不以静态 mock 通过。

## 7. 实现与验收同步

实现内容：

```text
backend/src/services/valuation/alternativeAssetFactsetService.ts
backend/src/services/valuation/valueAssessmentService.ts
backend/src/services/analysis/dataGapSummaryService.ts
backend/scripts/verify-fivd-r-fund-profile-fee-factset.ts
backend/scripts/verify-fivd-r-fund-gold-local-factset.ts
backend/scripts/verify-fivd-r-fund-holdings-factset.ts
backend/package.json
```

新增 npm script：

```bash
npm run test:fivd-r-fund-profile-fee-factset
```

打回与修复记录：

1. 首次专项验收失败：
   - `feeAvailableCount=0`。
   - 原因：费率页使用 `<td class="th w110">管理费率</td>`，解析器只匹配 `<th>`。
   - 修复：`extractTableValue` 改为匹配 `<th>` 或带 class 的 `<td>` label。

2. 回归验收失败：
   - 旧脚本仍要求 `fund_profile_factset_missing` 存在。
   - 原因：Phase 18.7 的目标就是移除 profile/fee blocker。
   - 修复：回归脚本改为检查新的剩余真实缺口。

3. 第二轮验收发现规格风险：
   - `009725` 的 `missingFields` 仍有 `riskLevel/durationProxy/creditRiskProxy`，但 `blockedReasons=[]`。
   - 这会造成前端/审计无法看到可行动剩余 blocker。
   - 修复：新增 `fund_risk_level_missing`、`bond_duration_credit_proxy_missing`，并接入 `DataGapSummaryService`。

最终真实验收结果：

```text
checkedPositions=13
profileAvailableCount=13
feeAvailableCount=13
profileUnavailableCount=0
feeUnavailableCount=0
```

样本：

```text
009725 / 中期债（一年）
profile.status=available
fundCategory=混合型-偏债
managerNames=["王佳骏"]
managementCompany=东方红资产管理
fundScaleText=6.98亿元（截止至：2026年03月31日）份额规模6.708亿份（截止至：2026年03月31日）

fee.status=available
managementFeePct=0.4
custodianFeePct=0.1
salesServiceFeePct=0
```

009725 当前 blocker：

```text
[
  "fund_risk_level_missing",
  "bond_duration_credit_proxy_missing"
]
```

已闭环：

```text
fund_profile_factset_missing 已从 009725 移除。
fund_fee_factset_missing 已从 009725 移除。
profile/fee sourceRefs 指向真实 F10 页面。
profile/fee evidenceRefs 已输出。
剩余 risk/duration/credit 缺口有结构化 DataGap 映射。
```

仍保留：

```text
fund_risk_level_missing
bond_duration_credit_proxy_missing
validation_evidence gate
```

审计结论：

- Phase 18.7 通过真实数据验收。
- 本阶段减少了基金 profile/fee broad blocker。
- 没有把基金事实集提升为 available。
- 没有隐藏剩余 data gaps。
- validation_evidence 仍是交易动作硬 blocker。
