# FIVD-R Phase 3.5：Position 级面板与性能审计开发前计划

版本：v0.3  
日期：2026-06-01

## 1. 阶段目标

Phase 3 已完成 portfolio 级 FIVD-R 统一面板。Phase 3.5 的目标是在不改变交易门禁的前提下，补齐单持仓 FIVD-R 详情，并审计 portfolio 级真实接口耗时问题。

本阶段不是收益分布模型开发，不开放交易动作。

## 2. PRD 规格检视

对应 PRD 条款：

- 用户打开单个持仓后应看到一套 FIVD-R 结果。
- 对外仍只呈现 FIVD-R 一套入口。
- 结果必须包含价值评估、交易纪律、内部验证锦标赛、候选处置、证据引用和缺失项。
- Validation Evidence 未通过时，必须禁止 `ADD / REDUCE / AUTO_TRADE`。
- P4 只作为内部 `validation_tournament_agent` 出现。

当前实现差距：

- portfolio 级面板已完成。
- 后端 position 级 `/analysis/fivd-r` 已有结构化结果，但前端尚未从持仓卡进入 position 级详情。
- portfolio 级真实接口在 Phase 3 验收中耗时约 30-36 秒，存在用户体验和端到端验收稳定性风险。
- Expected Return 仍为 placeholder；Phase 3.5 只能展示当前状态，不能声称收益分布已完成。

规格结论：

- Phase 3.5 与 PRD 一致。
- 不存在需要修改总 PRD 的偏差。
- 不得将 position 级观察结论展示成交易建议。

## 3. 开发计划

### 3.1 前端 position 级 FIVD-R 详情

开发内容：

1. 在 FIVD-R portfolio 面板或持仓研究卡中提供“查看 FIVD-R 详情”入口。
2. 调用 `getFivdRAnalysis({ positionId, scope: 'position' })`。
3. 展示真实 position 级字段：
   - asset：positionId、assetId、symbol、name、assetType。
   - summary：status、conclusion、allowedActions、prohibitedActions、blockedReasons。
   - evidenceGate：status、evidenceQualityScore、missingData、evidenceRefs。
   - valuation：valueAssessment 当前结果。
   - expectedReturn：当前 placeholder 或后续真实状态，必须显式标明当前状态。
   - tradingDiscipline：action、confidence、targetWeightRange、formalTradeActionAllowed、blockedReasons。
   - strategyValidation：operationId、source。
   - candidateDisposition：status、summary。
   - positionAdviceImpact：targetWeightMultiplier、validationGateMultiplier、formalTradeActionAllowed。
   - agentTrace：五个内部 Agent。
4. 不新增任何记录交易、生成交易计划或自动交易按钮。

### 3.2 性能审计

开发内容：

1. 新增或扩展真实数据验收脚本，记录 portfolio 级和 position 级 FIVD-R 接口耗时。
2. 输出性能审计结论：
   - portfolioLatencyMs
   - positionLatencyMs
   - slowPathCandidates
   - cacheOrOperationRecommendation
3. 仅审计，不在本阶段强行重构缓存或 Operation 化。

### 3.3 文档同步

开发后必须更新：

- 本文档的开发后 PRD 复检。
- 本文档的真实数据端到端验收结果。
- `HIGH_RELIABILITY_CORRECTNESS_PLAN.md`。
- `drawio-summary.txt`。

## 4. 验收计划

### 4.1 命令验收

必须通过：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

`test:trade-action-readiness` 在当前 validation 未通过时必须失败，且 blocker 必须仍为 `validation_evidence`。

### 4.2 真实数据端到端验收

必须使用当前真实持仓数据：

1. 找到至少一个真实非现金持仓。
2. 调用真实 position 级 FIVD-R API。
3. 前端打开 position 级 FIVD-R 详情。
4. 页面显示真实 positionId、symbol、valuation、tradingDiscipline、positionAdviceImpact、blockedReasons 和 agentTrace。
5. 页面显示禁止动作 `ADD / REDUCE / AUTO_TRADE`。
6. 截图留存到 `.verification/`。
7. 验收脚本记录 portfolio 和 position 接口耗时。

### 4.3 PRD 验收

必须确认：

- 单持仓入口仍属于 FIVD-R，不新增 P4 独立入口。
- LLM 没有新增交易结论。
- Expected Return 若仍为 placeholder，页面必须如实展示状态，不能包装成预测分布。
- validation failed 时 formal trade action 不可用。

## 5. 审计意见

审计时间：开发前。

结论：允许进入 Phase 3.5 实质开发。

致命风险：无。

重大风险：无。

一般风险：

1. portfolio 级接口耗时较高，可能影响端到端验收稳定性。
   - 闭环要求：本阶段必须记录耗时并给出缓存/Operation 化建议。
2. Expected Return 仍未完成。
   - 闭环要求：页面必须显示当前状态，不得展示为真实收益预测。
3. position 级详情可能与持仓研究卡存在信息重复。
   - 闭环要求：FIVD-R 详情只作为结构化审计和决策边界视图，不替代持仓研究摘要。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见均已有开发和验收约束。

进入实质开发条件：

- 允许进入 Phase 3.5 实质开发。
- 开发中若发现真实 position 级数据无法生成、接口耗时不可接受、或前端无法证明真实 evidence 来源，必须停止并打回计划阶段。

## 6. 开发前基线复验

复验时间：2026-06-01。

复验结果：通过进入实质开发的基线门禁；交易动作仍未放行。

执行命令：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

结果摘要：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- FIVD-R core 通过，`validationSource=fivd_r_internal_validation_tournament`。
- production readiness 严格模式通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- trade action readiness 按预期失败，`tradeActionReady=false`，唯一 blocker=`validation_evidence`。
- 最新 readiness evidence：operationId=`15fae43c-c208-47b7-9596-90dedc99377b`，`scanCoveragePercent=100`，`providerSuccessRate=98.61`，`cacheHitRate=99.95`，`backtestDays=60`，`bestSampleSize=3766`，`bestCredibility=high`，但 validation evidence 未通过。

审计判断：

- 未发现 PRD 与 Phase 3.5 目标存在较大偏差。
- 未发现虚假验收风险。
- 未通过降低 gate 获得通过结果。
- Phase 3.5 可以进入实质开发，但本阶段真实数据端到端验收必须在开发后重新执行；若 position 级真实数据无法复现，必须打回计划阶段。

## 7. 开发后实现结果

实现时间：2026-06-01。

实现内容：

- 分析页持仓研究面板新增 `查看 FIVD-R` 入口。
- 入口调用真实 `/api/v1/analysis/fivd-r?scope=position&positionId=...`。
- position 级详情展示：
  - `asset.positionId / symbol / name / assetType`
  - `summary.allowedActions / prohibitedActions / blockedReasons`
  - `evidenceGate.evidenceQualityScore / evidenceRefs`
  - `valuation`
  - `expectedReturn` 当前状态
  - `tradingDiscipline`
  - `strategyValidation / candidateDisposition`
  - `positionAdviceImpact`
  - `agentTrace`
- 未新增交易记录、交易计划生成、券商下单或自动交易按钮。
- 新增真实数据端到端验收脚本 `scripts/verify-fivd-r-phase3-5-position.mjs`。

## 8. 开发后 PRD 规格复检

复检结论：通过。

逐项检查：

- 单持仓入口仍属于 FIVD-R，没有恢复 P4 独立入口。
- P4 仍只作为 `validation_tournament_agent` 出现在 Agent Trace 和 `strategyValidation` 内。
- position 级结果使用真实 positionId 调用真实 API，没有用 portfolio 数据冒充。
- Expected Return 仍明确展示为当前状态，没有包装成已完成的收益概率分布。
- 页面展示 `ADD / REDUCE / AUTO_TRADE` 为禁止动作。
- `formalTradeActionAllowed=false`，未绕过 validation gate。

未闭环但不阻断本阶段的问题：

- portfolio FIVD-R 和 position FIVD-R 都存在明显慢路径，后续应缓存化或 Operation 化。
- 本阶段只展示 Expected Return 当前状态，不解决收益分布模型缺口；该缺口进入 Phase 4。

## 9. 真实数据端到端验收结果

验收时间：2026-06-01。

验收脚本：

```text
node scripts/verify-fivd-r-phase3-5-position.mjs
```

真实数据：

```text
positionId=4d144dc4-953d-4ce6-aa40-26f9277023b7
symbol=009725
name=中期债（一年）
type=bond
```

验收产物：

```text
.verification/fivd-r-phase3-5-position.png
.verification/fivd-r-phase3-5-performance-audit.json
```

验收断言：

- API 返回 `scope=position`。
- API 返回真实 `asset.positionId=4d144dc4-953d-4ce6-aa40-26f9277023b7`。
- API 返回真实 `asset.symbol=009725`。
- `valuation` 存在。
- `tradingDiscipline` 存在。
- `positionAdviceImpact` 存在。
- `agentTrace` 包含 `validation_tournament_agent`。
- 禁止动作包含 `ADD / REDUCE / AUTO_TRADE`。
- blockedReasons 包含 `validation_evidence`。
- 前端页面展示 Position 级 FIVD-R 详情、真实 positionId、symbol、价值评估、Expected Return 当前状态、交易纪律、PositionAdvice Impact、Agent Trace 和禁止动作。

性能审计：

```text
portfolioLatencyMs=33869
positionLatencyMs=16764
slowPathCandidates=portfolio_fivd_r_full_holdings_research, position_fivd_r_value_advice_validation_join
recommendation=Add cached latest FIVD-R run or Operation-backed refresh before using this as a high-frequency UI path.
```

验收结论：通过。

## 10. 固定门禁复验结果

复验时间：2026-06-01。

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

结果：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `test:fivd-r-core` 通过，`validationSource=fivd_r_internal_validation_tournament`。
- `test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。

## 11. 开发后审计意见

审计结论：Phase 3.5 完成。

致命风险：无。

重大风险：无。

一般风险：

1. portfolio FIVD-R 约 33.9 秒，position FIVD-R 约 16.8 秒。
   - 审计意见：功能验收通过，但高频 UI 路径不可接受；后续需要 cached latest FIVD-R run 或 Operation-backed refresh。
2. 当前真实验收持仓为债券/基金类，价值事实集存在 `fund_like_value_factset_missing`。
   - 审计意见：这是真实 blockedReason，不是虚假通过；Phase 4 和 Phase 5 需要继续处理非股票类资产的收益分布与纪律表达。
3. Expected Return 仍为当前状态展示。
   - 审计意见：不得把 Phase 3.5 标记为收益分布完成；Phase 4 必须用真实历史数据计算。

是否需要停止找用户确认：

- 未发现 PRD 大偏差。
- 未发现虚假验收风险。
- 未降低 validation gate。
- 未放行交易动作。
- 因此不触发停止条件，可以进入 Phase 4 开发前计划与审计。
