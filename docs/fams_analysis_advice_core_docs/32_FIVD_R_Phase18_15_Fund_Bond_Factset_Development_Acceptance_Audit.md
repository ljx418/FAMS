# FIVD-R Phase 18.15：基金/债基事实集补齐开发计划、验收标准与审计意见

日期：2026-06-03

## 1. 阶段目标

补齐基金/债基持仓研究中最影响可读性的事实集缺口：风险等级、债基久期代理、净值样本和债券风险代理。该阶段仍只提升研究/观察能力，不放行交易动作。

## 2. 开发范围

后端：

- 在 `FundLikeFactSet` 中新增 `riskLevelProxy`。
- 在 `FundLikeFactSet` 中新增 `durationProxy`。
- 风险等级代理基于真实本地 NAV/价格历史、最大回撤和年化波动生成。
- 债基久期代理基于真实本地 NAV/价格历史、波动/回撤和债券配置生成。
- 将代理字段写入 value assessment facts。
- 在 holdings research 的 `researchEvidenceDetails.fundLike` 输出基金/债基专属摘要。
- 过滤旧 position advice cache 中已被实时 factset 闭环的陈旧 blocker。

前端：

- Analysis 持仓卡展示基金/债基研究代理摘要。
- Analysis 持仓详情弹窗展示风险等级代理、净值样本区间、久期代理、债券配置、债券集中度和信用风险 flags。
- 页面明确说明代理值不是官方评级、真实加权久期、到期收益率或交易依据。

## 3. 代理规则

风险等级代理：

```text
method = nav_drawdown_volatility_risk_level_proxy_v1
provider = local_nav_risk_proxy
inputs = sampleSize, maxDrawdownPct, annualizedVolatilityPct, assetType
```

债基久期代理：

```text
method = bond_fund_nav_volatility_allocation_duration_proxy_v1
provider = local_nav_bond_allocation_proxy
inputs = sampleSize, annualizedVolatilityPct, maxDrawdownPct, bondPct, topBondConcentrationPct
```

边界：

- 代理值只用于研究解释和缺口审计。
- 不等同于基金公司/销售机构官方风险评级。
- 不等同于真实组合加权久期或到期收益率。
- 不得用于放行 ADD / REDUCE / AUTO_TRADE。

## 4. 验收标准

- 真实基金/债基/ETF 持仓都返回 `researchEvidenceDetails.fundLike`。
- 至少 1 个真实基金返回风险等级代理。
- 至少 1 个真实债基返回久期代理。
- 已被代理闭环的旧 `fund_risk_level_missing`、`bond_duration_proxy_missing`、`fund_nav_history_insufficient` 不再误显示。
- 保留真实未闭环缺口，例如基金持仓事实集、债基信用风险代理、validation evidence。
- `test:trade-action-readiness` 继续按预期失败，除非真实 validation evidence 通过。

## 5. 实施结果

已完成：

- `backend/src/services/valuation/alternativeAssetFactsetService.ts`
  - 新增 `riskLevelProxy`。
  - 新增 `durationProxy`。
  - 新增研究级风险等级和债基久期代理推导。
- `backend/src/services/valuation/valueAssessmentService.ts`
  - 新增 `fund_risk_level_proxy`、`fund_risk_score_proxy`、`bond_duration_bucket_proxy`、`bond_estimated_duration_years_proxy`、`bond_allocation_pct`、`top_bond_concentration_pct` facts。
- `backend/src/services/analysis/analysisService.ts`
  - `researchEvidenceDetails.fundLike` 输出专属摘要。
  - holdings blocker 合并时过滤已被实时 factset 闭环的旧缓存 blocker。
- `frontend/src/services/analysisService.ts`
  - 类型新增 `researchEvidenceDetails.fundLike`。
- `frontend/src/pages/Analysis.tsx`
  - 持仓卡和详情弹窗展示基金/债基代理事实。

## 6. 真实数据验收

真实 API：

```text
GET /api/v1/analysis/holdings-research?userId=default
```

结果摘要：

```json
{
  "totalHoldings": 19,
  "fundLike": 13,
  "withFundLike": 13,
  "riskAvailable": 13,
  "durationAvailable": 3,
  "remainingFundRiskGaps": 0,
  "remainingDurationGaps": 0,
  "remainingNavGaps": 0,
  "gaps": [
    "validation_evidence",
    "fund_holdings_factset_missing",
    "bond_credit_risk_proxy_missing"
  ]
}
```

样本：

```json
[
  {
    "name": "中期债（一年）",
    "type": "bond",
    "coverage": 62,
    "risk": { "status": "available", "level": "low", "score": 5.73 },
    "duration": { "status": "available", "bucket": "short", "years": 1.2 },
    "navSample": 117,
    "gaps": ["validation_evidence"]
  },
  {
    "name": "红利低波",
    "type": "fund",
    "coverage": 62,
    "risk": { "status": "available", "level": "medium", "score": 29.26 },
    "duration": { "status": "not_applicable", "bucket": "unknown", "years": null },
    "navSample": 117,
    "gaps": ["validation_evidence"]
  },
  {
    "name": "恒生科技",
    "type": "fund",
    "coverage": 57,
    "risk": { "status": "available", "level": "high", "score": 81.79 },
    "navSample": 117,
    "gaps": ["fund_holdings_factset_missing", "validation_evidence"]
  }
]
```

## 7. 命令验收

已通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness

cd frontend
npm run build
```

按预期失败：

```bash
cd backend
npm run test:trade-action-readiness
```

失败原因：

```text
tradeActionReady=false
blockerGateIds=["validation_evidence"]
readyForManualTradeDraft=false
```

服务 smoke：

```text
GET http://localhost:4000/health -> status=ok, database=ok, activeFivdRRefresh=null
GET http://localhost:3000/ -> 200
```

## 8. PRD 规格检视

检视结论：

- 符合“研究/观察质量提升，不放行交易动作”的阶段目标。
- 已将基金/债基 broad gaps 细化为真实可见的代理事实和剩余缺口。
- 没有把研究级代理包装为官方评级或交易信号。
- 没有绕过 `validation_evidence`。
- `ADD / REDUCE / AUTO_TRADE` 仍未放行。

剩余缺口：

- 部分基金仍缺前十大持仓事实集。
- 部分债基仍缺完整信用风险代理。
- 官方风险评级、真实组合加权久期、到期收益率仍需真实 provider 或人工审计导入。
- validation evidence 仍是交易动作 blocker。
