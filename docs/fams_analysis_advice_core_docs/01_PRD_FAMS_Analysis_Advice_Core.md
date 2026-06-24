# PRD：FIVD-R 统一分析建议核心

版本：v0.2  
日期：2026-06-01  
模块名称：FAMS Analysis Advice Core  
模型代号：FIVD-R，FAMS Investment Valuation, Discipline & Replay Model

---

## 1. 产品判断

FIVD-R 与 P4 可以放在一起开发。P4 的“策略竞标赛/锦标赛”不应作为一个独立用户产品存在，而应内化为 FIVD-R 的 Core 验证与回放 Agent。

原因：

1. FIVD-R Core 要回答“这个标的/组合是否值得继续研究、人工复核或交易计划复核”。
2. P4 竞标赛本质是在同一套候选策略中比较价值评估、入场纪律、退出纪律、成本、市场约束和样本外稳定性。
3. 两者都依赖同一套证据：行情事实、持仓事实、价值评分、策略回放、Validation Evidence、候选处置。
4. 如果对外暴露两套入口，会造成用户看到“价值评估”和“竞标赛排名”两套结论，增加解释冲突。

因此产品口径调整为：

```text
对外只呈现 FIVD-R 一套入口。
P4 策略竞标赛是 FIVD-R 内部多 Agent 编排中的 validation_tournament_agent。
所有 ADD / REDUCE / AUTO_TRADE 仍由 evidence gate 和人工确认 gate 控制。
```

---

## 2. 背景

FAMS 已具备资产与持仓账本、行情缓存、技术特征、Provider 治理、Operation 异步任务、AI 选股、策略回测、Validation Evidence、PositionAdviceFactSet、PositionAdviceEngine 和价值评估服务。

当前缺口不是再新增一个“P4 页面”，而是把这些能力收敛成一个统一的 FIVD-R 研究结果：

```text
这个标的/组合的价值状态是什么？
它是否适合作为核心仓、卫星仓或观察池候选？
当前交易纪律是什么？
策略证据是否经过样本外、walk-forward、参数敏感性和分组稳定性验证？
候选是否可进入人工复核，还是只能继续研究观察？
```

---

## 3. 产品目标

### 3.1 用户目标

用户需要一个统一视图完成：

1. 查看单个持仓或组合的 FIVD-R 结论。
2. 明确允许动作：`RESEARCH / OBSERVE / PAPER_TRADE / MANUAL_REVIEW`。
3. 明确禁止动作：未通过验证时禁止 `ADD / REDUCE / AUTO_TRADE`。
4. 查看价值评估、交易纪律、候选处置和验证证据。
5. 看到一套可解释结果，而不是分别理解 FIVD-R 与 P4 两套系统。

### 3.2 系统目标

系统必须做到：

```text
单一 API 入口
结构化输出
可追溯 evidenceRefs
可复现 runId / modelVersion / dataVersion
P4 竞标赛内化为验证 Agent
LLM 只解释结构化结果，不新增交易结论
```

---

## 4. 非目标

本阶段不做：

1. 自动交易。
2. 真实券商下单。
3. 独立 P4 用户入口。
4. LLM 自主决定买入、卖出、加仓、减仓。
5. 未通过 Validation Evidence 的正式交易动作。
6. 用短窗回放证明长期 Alpha。

---

## 5. 用户故事

### US-01：查看统一 FIVD-R 结果

作为用户，我打开单个持仓或组合后，只看到一套 FIVD-R 结果：

- 当前结论。
- 允许动作与禁止动作。
- 价值评估。
- 交易纪律。
- P4 内部验证结果。
- 候选处置。
- 证据引用和缺失项。

### US-02：理解竞标赛结果

作为用户，我不需要知道 P4 是单独模块，只需要知道 FIVD-R 已经通过内部验证锦标赛比较过候选策略，并给出：

- 是否通过验证。
- 哪些候选可进入人工复核。
- 哪些候选仅观察。
- 哪些候选应退休或补样本。

### US-03：人工复核

作为用户，我可以基于 FIVD-R 结果进入人工复核，但系统必须继续记录：

- 人工决策。
- 覆盖原因。
- 对应 evidenceRefs。
- 后续回放对比。

---

## 6. 功能需求

## 6.1 统一入口

后端提供：

```text
GET /api/v1/analysis/fivd-r
```

参数：

```text
userId
scope=portfolio | position
positionId
symbol
forceRefresh
```

返回必须包含：

```text
schemaVersion=fivd.r.analysis.result.v1
runId
generatedAt
modelVersion
dataVersion
orchestrationMode
summary
evidenceGate
valuation
expectedReturn
tradingDiscipline
strategyValidation
candidateDisposition
positionAdviceImpact
agentTrace
explanation
```

## 6.2 多 Agent 内部编排

FIVD-R 内部使用确定性多 Agent 编排口径：

```text
evidence_agent              证据采集与质量检查
valuation_agent             价值评估
validation_tournament_agent 原 P4 策略竞标赛、回放和候选处置
discipline_agent            交易纪律与仓位建议联动
explanation_agent           结构化解释，不新增交易结论
```

## 6.3 验证锦标赛

P4 内化后仍保留以下能力：

```text
strategy_tournament
out_of_sample_validation
walk_forward_validation
parameter_sensitivity
group_stability
oos_multi_window_regime_retest
validation_evidence_matrix
validation_candidate_disposition
```

这些能力只作为 `strategyValidation` 和 `candidateDisposition` 出现在 FIVD-R 结果内。

## 6.4 交易边界

任何正式交易动作必须满足：

```text
evidenceGate.status=pass
validationDecision.usableForTradingAdvice=true
candidateDisposition.status=ready_for_manual_review
人工确认完成
```

否则只允许：

```text
RESEARCH
OBSERVE
```

---

## 7. 验收标准

1. `/api/v1/analysis/fivd-r` 可返回组合级结果。
2. 对已有持仓可返回 position 级结果。
3. 输出包含 `strategyValidation`，且来源为 FIVD-R 内部验证锦标赛。
4. 输出包含 `candidateDisposition` 字段；没有产物时也必须显式为 `null`。
5. `agentTrace` 可说明内部编排步骤。
6. Validation Evidence 未通过时，结果必须禁止 `ADD / REDUCE / AUTO_TRADE`。
7. 后端和前端 TypeScript 编译通过。
8. `npm run test:fivd-r-core` 通过。
