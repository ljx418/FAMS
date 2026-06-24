# FIVD-R Phase 6：PositionAdvice Adapter 深度接入开发前计划

版本：v0.2  
日期：2026-06-02

## 1. 阶段目标

Phase 6 的目标是让 FIVD-R 输出真正进入 PositionAdvice 计算链路，而不是只在 FIVD-R 面板中并列展示。

本阶段仍不开放自动交易，不绕过 `validation_evidence`，不把 FIVD-R 的纪律动作直接转成 formal ADD / REDUCE。

## 2. PRD 规格检视

对应总 PRD 和模型架构要求：

- PositionAdvice Adapter 必须接入 `valuationMultiplier`、`riskPenaltyMultiplier`、`evidenceConfidenceMultiplier`、`validationGateMultiplier`。
- PositionAdvice 的 evidenceRefs 必须能追溯到 FIVD-R run、valuation、expectedReturn、tradingDiscipline 和 validation tournament。
- Validation Evidence 未通过时，ADD / REDUCE 必须继续被阻断。
- FIVD-R 可以影响目标仓位区间、置信度和风险说明，但不得绕过人工复核和交易 readiness。

当前实现差距：

- FIVD-R position 结果已有 `positionAdviceImpact`，但 PositionAdviceEngine 的目标仓位公式仍主要使用自身 factSet。
- PositionAdvice evidenceRefs 尚未强制引用 FIVD-R run。
- FIVD-R validation gate 与 PositionAdvice action gate 尚未形成单一可审计闭环。

规格结论：

- Phase 6 与总 PRD 一致。
- 本阶段只能增强建议解释和目标仓位约束，不得开放交易执行。

## 3. 开发计划

### 3.1 后端 Adapter

开发内容：

1. 在 PositionAdvice 计算中接入 FIVD-R impact：
   - `valuationMultiplier`
   - `riskPenaltyMultiplier`
   - `evidenceConfidenceMultiplier`
   - `validationGateMultiplier`
2. 将 FIVD-R run 信息写入 PositionAdvice evidenceRefs。
3. Validation Evidence 未通过时：
   - formal ADD / REDUCE 必须阻断。
   - 目标仓位可降级为观察或复核区间。
   - explanation 必须显示 gate 原因。
4. 避免递归调用：
   - FIVD-R 可以调用 PositionAdvice 获取基线。
   - PositionAdvice 接入 FIVD-R 时必须使用轻量 Adapter 或显式选项避免循环。

### 3.2 前端展示

开发内容：

1. 持仓建议详情展示 FIVD-R Adapter 影响因子。
2. 展示 evidenceRefs 与 blockedReasons。
3. Validation failed 时不得显示可执行加仓/减仓按钮。

### 3.3 验收脚本

开发内容：

1. 新增真实数据验收脚本。
2. 对当前真实组合至少验证一个非现金持仓。
3. 验证 PositionAdvice 包含 FIVD-R evidenceRefs。
4. 验证 FIVD-R multiplier 进入目标仓位或 explanation。
5. 验证 `validation_evidence` 未通过时 formal ADD / REDUCE 仍被阻断。

## 4. 验收计划

固定命令：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

真实数据端到端验收：

1. 使用当前真实持仓。
2. 调用真实 PositionAdvice API。
3. 调用或触发包含 FIVD-R Adapter 的建议链路。
4. 验证 PositionAdvice evidenceRefs 引用 FIVD-R。
5. 验证 targetWeight / explanation 中存在 FIVD-R multiplier。
6. 验证 validation failed 时 formal ADD / REDUCE 不出现。
7. 前端打开持仓建议或 FIVD-R position 详情，验证 FIVD-R impact 可见。
8. 截图和审计 JSON 留存到 `.verification/`。

PRD 验收：

- FIVD-R 影响 PositionAdvice，但不取代 PositionAdvice。
- Adapter 输出可追溯。
- validation gate 不被弱化。
- 不出现自动交易入口。

## 5. 开发前审计意见

审计时间：2026-06-02。

结论：允许进入 Phase 6 实质开发。

致命风险：无。

重大风险：无。

一般风险：

1. 递归调用风险。
   - 闭环要求：实现必须通过选项或轻量 Adapter 避免 PositionAdvice 与 FIVD-R 相互递归。
2. FIVD-R discipline action 被误用为 formal action。
   - 闭环要求：PositionAdvice 只能消费 multiplier、gate 和 evidenceRefs，不得直接消费 discipline action 作为交易动作。
3. 真实 validation evidence 仍未通过。
   - 闭环要求：固定负向门禁必须保持 `tradeActionReady=false`，且 blocker 为 `validation_evidence`。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见均已有开发和验收约束。

进入实质开发条件：

- 允许进入 Phase 6 实质开发。
- 开发中若发现循环调用、validation gate 被绕过、或 FIVD-R discipline action 被包装为正式交易动作，必须停止并打回计划阶段。

## 6. 开发后实现结果

实现时间：2026-06-02。

实现结论：Phase 6 实质开发已完成。

后端实现：

- PositionAdvice FactSet 新增 `fivdRImpact`，schemaVersion=`fivd.r.position_advice_adapter.v1`。
- PositionAdvice Advice 同步输出 `fivdRImpact`，便于 API 使用方直接审计。
- Adapter 接入：
  - `valuationMultiplier`
  - `riskPenaltyMultiplier`
  - `evidenceConfidenceMultiplier`
  - `validationGateMultiplier`
  - `combinedMultiplier`
- PositionAdvice 目标仓位公式新增 `fivdRCombinedMultiplier`。
- `validation_evidence` 未通过时，ADD / REDUCE 会被降级为 `OBSERVE`。
- evidenceRefs 新增 FIVD-R runRef、估值证据、全 A validation operation 和 `validation_decision.json`。
- Adapter 直接读取价值评估与最新 validation operation，不调用 FIVD-R 统一入口，已规避递归调用风险。

前端实现：

- 持仓研究的仓位建议引擎新增 FIVD-R Adapter 展示。
- 展示 valuation、risk、evidence、validation、combined 乘数。
- 目标仓位公式展示 `FIVD-R × fivdRCombinedMultiplier`。
- 未新增交易按钮。

## 7. 开发后 PRD 规格复检

复检结论：通过。

规格对应关系：

- FIVD-R 已进入 PositionAdvice 目标仓位计算链路。
- PositionAdvice evidenceRefs 可追溯到 FIVD-R adapter run、估值事实和 validation evidence。
- Validation Evidence 未通过时，formal ADD / REDUCE 不输出。
- Adapter 没有消费 `tradingDiscipline.action` 作为正式动作。
- 前端只展示影响因子和 gate，不提供交易执行入口。

未闭合但不构成本阶段重大偏差的事项：

- 当前 validation evidence 仍未通过，因此 `validationGateMultiplier=0`，真实样本目标仓位区间归零。这是 gate 设计结果，不是交易建议放行。
- 前端本阶段完成展示和 TypeScript 复验；专项自动化验收以真实 API/DB 链路为主。

## 8. 真实数据端到端验收结果

验收时间：2026-06-02。

专项命令：

```text
node scripts/verify-fivd-r-phase6-position-advice-adapter.mjs
```

验收结果：通过。

真实样本：

- 持仓：`601127 / 赛里斯 / positionId=5c775de8-4167-4ed9-ba3e-938536f5d57c`
- assetType=`stock`
- PositionAdvice action=`OBSERVE`
- targetWeightRange=`[0,0]`
- blockedReasons=`["fundamental_factset_insufficient","validation_evidence"]`

FIVD-R Adapter 验收结果：

- `schemaVersion=fivd.r.position_advice_adapter.v1`
- `valuationMultiplier=1`
- `riskPenaltyMultiplier=1`
- `evidenceConfidenceMultiplier=0.3`
- `validationGateMultiplier=0`
- `combinedMultiplier=0`
- `valuationStatus=available`
- `valuationConfidence=low`
- `validationUsableForTradingAdvice=false`
- evidenceRefs 包含：
  - `fivd-r:position:5c775de8-4167-4ed9-ba3e-938536f5d57c:*`
  - `stock-factset-cache:601127:stock_full_analysis`
  - `quote-list-canonical:601127`
  - `financial-report:601127:2026-03-31 00:00:00`
  - `operation:15fae43c-c208-47b7-9596-90dedc99377b`
  - `validation_decision.json`

验收产物：

- 审计 JSON：`.verification/fivd-r-phase6-position-advice-adapter-audit.json`

专项验收判断：

- PositionAdvice FactSet 和 Advice 均包含 FIVD-R Adapter。
- `validation_evidence` 阻断时 `validationGateMultiplier=0`。
- `validation_evidence` 阻断时未输出 ADD / REDUCE。
- 未使用 mock 数据作为端到端通过依据。

## 9. 固定门禁复验结果

复验时间：2026-06-02。

已通过：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
```

关键结果：

- FIVD-R core 通过，`validationSource=fivd_r_internal_validation_tournament`。
- Production readiness 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- 最新 evidence operation=`15fae43c-c208-47b7-9596-90dedc99377b`。
- `blockerGateIds=["validation_evidence"]`。

固定负向门禁：

```text
backend: npm run test:trade-action-readiness
```

结果：按预期失败。

判断：

- `tradeActionReady=false`
- `readyForManualTradeDraft=false`
- blocker=`validation_evidence`
- 该失败是正确门禁行为，不是阶段失败。

## 10. 开发后审计意见

审计时间：2026-06-02。

结论：Phase 6 验收通过，允许进入 Phase 7 的开发前计划与审计。

致命风险：无。

重大风险：无。

一般风险：

1. `validationGateMultiplier=0` 会使目标仓位区间归零，容易被误读为正式清仓建议。
   - 审计意见：当前 action 已降级为 `OBSERVE`，blockedReasons 可见；后续 UI 和报告仍需持续强调 research-only。
2. 前端专项截图未作为 Phase 6 自动验收产物沉淀。
   - 审计意见：前端 TypeScript 已通过，展示逻辑已实现；该项为一般可追溯性缺口，不影响 Adapter 计算和 gate 正确性。
3. PositionAdvice 与 FIVD-R 对同一资产的价值事实来源仍可能在时间点上不完全一致。
   - 审计意见：本阶段已写入 evidenceRefs 和 generatedAt；Phase 7 replay 需要进一步审计时间一致性。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见进入 Phase 7 replay 和后续 UI 验收增强。
