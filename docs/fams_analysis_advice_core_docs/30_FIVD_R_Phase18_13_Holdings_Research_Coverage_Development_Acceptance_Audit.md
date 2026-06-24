# FIVD-R Phase 18.13 第一段：持仓研究覆盖率开发计划、验收标准与审计意见

日期：2026-06-03

## 1. 阶段目标

将持仓研究从“逐项显示缺口”提升为“可判断研究资料是否足够”的工作台视图。现金类资产已在 Phase 18.11 从研究对象中剥离，本阶段只面向非现金持仓。

## 2. 开发范围

后端：

- 为 `holdings-research` 每个非现金持仓增加 `researchCoverage`。
- 覆盖技术指标、基本面/事实集、消息/事件、估值/价值四个维度。
- 每个维度输出状态、证据数量、缺口数量。
- 计算持仓级覆盖分、覆盖标签、首要缺口和下一步补数动作。

前端：

- 持仓研究顶部展示非现金持仓数量、平均研究覆盖分、ready/partial/insufficient 分布。
- 每张持仓卡展示研究覆盖分、四维度状态、证据/缺口数量和优先补齐项。

## 3. 验收标准

- 真实 `holdings-research` 返回 19 个非现金持仓，现金类不出现。
- 每个返回持仓包含 `researchCoverage`。
- 前端 build 通过。
- 后端 TypeScript 通过。
- 不改变 `validation_evidence` gate。
- 不输出 `ADD / REDUCE / AUTO_TRADE` 放行语义。

## 4. 审计意见

风险等级：minor

本阶段只对已有事实集和 data gaps 做可视化聚合，不新增交易判断，不伪造缺失事实。覆盖分用于研究资料完整度判断，不代表买卖信号。

允许进入开发。

## 5. 实施结果

已完成：

- `GET /api/v1/analysis/holdings-research` 为每个非现金持仓输出 `researchCoverage`。
- 覆盖维度包括技术指标、基本面/事实集、消息/事件、估值/价值。
- 每个维度输出状态、证据数量和 blocker 数量。
- 持仓级输出覆盖分、覆盖标签、首要缺口和下一步补数动作。
- Analysis 页面新增持仓研究覆盖率总览。
- Analysis 页面持仓卡新增覆盖分、维度状态、证据/缺口数量和优先补齐项。

## 6. 真实数据验收

运行时间：2026-06-03

后端真实 API：

```text
GET http://localhost:4000/api/v1/analysis/holdings-research?userId=default
```

摘要：

```json
{
  "holdings": 19,
  "withCoverage": 19,
  "cashHoldings": 0,
  "avgCoverage": 48,
  "labels": {
    "data_insufficient": 9,
    "research_ready": 1,
    "partial": 9
  },
  "topGaps": [
    "validation_evidence",
    "financial_report_missing"
  ]
}
```

样本：

```json
[
  {
    "name": "中期债（一年）",
    "type": "bond",
    "coverage": {
      "score": 42,
      "label": "data_insufficient",
      "primaryGap": "validation_evidence"
    }
  },
  {
    "name": "赛里斯",
    "type": "stock",
    "coverage": {
      "score": 86,
      "label": "research_ready",
      "primaryGap": "validation_evidence"
    }
  }
]
```

验收结论：

- 真实非现金持仓共 19 个，全部返回 `researchCoverage`。
- 现金类持仓未进入持仓研究列表。
- 平均覆盖分为 48，说明当前研究台仍存在较多事实集和验证证据缺口。
- `validation_evidence` 和 `financial_report_missing` 是当前最主要的阻断/降级原因。
- 该结果没有放行 formal ADD / REDUCE、manual trade draft 或 AUTO_TRADE。

## 7. 命令验收

已通过：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core

cd frontend
npm run build
```

服务 smoke：

```text
GET http://localhost:4000/health -> 200, database=ok, activeFivdRRefresh=null
GET http://localhost:3000/ -> 200
```

## 8. PRD 规格检视

检视结果：

- 符合“现金类资产不生成分析建议”的边界。
- 符合“研究/观察质量提升，不放行交易动作”的阶段目标。
- 覆盖分只衡量资料完整度和可研究程度，不替代 FIVD-R 价值评分或交易建议。
- 没有隐藏 data gaps，也没有把 partial/blocked 包装成 available。

剩余缺口：

- 技术指标和基本面事实集仍需继续补齐 provider 与字段覆盖。
- 基金/债基风险等级、久期代理仍需 Phase 18.15 收口。
- `validation_evidence` 仍未通过，交易动作继续被阻断。

## 9. 第二段：结构化事实集明细

目标：

- 将持仓研究从文本摘要继续推进到结构化事实明细。
- 复用已有 `PositionAdviceFactSet`、`market_feature_daily` 和 `valueAssessment.facts`。
- 明确哪些技术/基本面字段可用，哪些字段仍缺失。

已完成：

- `holdings-research` 新增 `researchEvidenceDetails`。
- 技术面输出来源、截止时间、支撑/压力、趋势分、动量分、相对强弱、波动、流动性、20/60 日收益、RSI14、MA20/MA60/MA120、ATR14、波动率、最大回撤、量比等字段。
- 基本面输出 facts 列表、可用/缺失计数和 warnings。
- 估值输出 status、conclusion、confidence、valuationBand、method、评分字段、reasons、risks、blockedReasons。
- 消息面输出 sentimentScore、eventRiskScore、eventCount 和最多 5 条事件。
- Analysis 持仓卡展示事实集可用/缺失计数和前 5 个技术字段。
- Analysis 持仓详情弹窗展示完整技术字段、基本面 facts、估值依据和估值 blocker。

真实数据验收：

```json
{
  "holdings": 19,
  "cashHoldings": 0,
  "withCoverage": 19,
  "withEvidenceDetails": 19,
  "avgCoverage": 47,
  "technicalAvailableSum": 125,
  "technicalMissingSum": 160,
  "fundamentalAvailableSum": 231,
  "fundamentalMissingSum": 24
}
```

样本：

```json
[
  {
    "name": "中期债（一年）",
    "type": "bond",
    "coverage": 42,
    "technicalSource": "position_advice_factset",
    "technicalAvailable": 5,
    "technicalMissing": 10,
    "fundamentalAvailable": 15,
    "fundamentalMissing": 0,
    "valuationStatus": "partial"
  },
  {
    "name": "赛里斯",
    "type": "stock",
    "coverage": 86,
    "technicalSource": "market_feature_daily",
    "technicalAvailable": 15,
    "technicalMissing": 0,
    "fundamentalAvailable": 9,
    "fundamentalMissing": 0,
    "valuationStatus": "available"
  }
]
```

验收命令：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

结果：

- `tsc` 通过。
- `test:fivd-r-core` 通过。
- `test:production-readiness` 通过，`productionReady=true`，`tradeActionReady=false`。
- `test:trade-action-readiness` 按预期失败，blocker 为 `validation_evidence`。
- `frontend npm run build` 通过。
- 后端 `/health` 返回 `database=ok`，`activeFivdRRefresh=null`。
- 前端 `http://localhost:3000/` 返回 200。

审计意见：

- 本段没有新增交易动作语义。
- 本段没有降低或绕过 `validation_evidence`。
- `researchEvidenceDetails` 中缺失字段保留为 `null` 和缺失计数，不伪造成可用事实。
- 技术字段缺失仍较多，下一段需要继续处理 provider 与资产类型差异，而不是直接提高评分。
