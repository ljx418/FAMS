# FIVD-R Phase 5：Trading Discipline Engine 完整化开发前计划

版本：v0.2  
日期：2026-06-02

## 1. 阶段目标

Phase 5 的目标是把 FIVD-R `tradingDiscipline` 从第一段动作/置信度/目标区间，升级为完整交易纪律结构。

本阶段不开放自动交易，不绕过 `validation_evidence`，不把 discipline 展示为正式买卖指令。

## 2. PRD 规格检视

对应 PRD 和模型架构要求：

- FIVD-R 必须明确允许动作与禁止动作。
- 交易纪律必须区分核心仓、卫星仓、现金或不适用资产。
- Validation Evidence 未通过时，正式 `ADD / REDUCE / AUTO_TRADE` 必须禁止。
- LLM 只能解释结构化纪律，不得新增买卖结论。

当前实现差距：

- 当前 `tradingDiscipline` 只有 `action / confidence / targetWeightRange / formalTradeActionAllowed / blockedReasons`。
- 缺少 bucket、disciplineType、validFrom、validUntil、reviewCadence。
- 缺少 add/reduce/stop/takeProfit/invalidation 条件结构。
- 现金和非交易类资产的纪律边界需要更明确。

规格结论：

- Phase 5 与总 PRD 一致。
- 不得因为 expectedReturn available 就开放交易动作。
- discipline 是“纪律边界”，不是“交易执行”。

## 3. 开发计划

### 3.1 后端 Trading Discipline 结构化

开发内容：

1. 将 `tradingDiscipline` 升级为完整结构：
   - `schemaVersion=fivd.r.trading_discipline.v2`
   - `bucket=core | satellite | cash | watchlist | unknown`
   - `disciplineType=hold_review | rebalance_watch | risk_control | no_action`
   - `validFrom`
   - `validUntil`
   - `reviewCadence`
   - `maxAllowedWeight`
   - `targetWeightMultiplier`
   - `formalTradeActionAllowed`
   - `blockedReasons`
2. 输出条件组：
   - `addConditions`
   - `reduceConditions`
   - `stopConditions`
   - `takeProfitConditions`
   - `invalidationConditions`
3. 现金类资产必须：
   - `bucket=cash`
   - `disciplineType=no_action`
   - `formalTradeActionAllowed=false`
   - 不生成 add/reduce/stop/takeProfit 条件。
4. validation failed 时：
   - formalTradeActionAllowed 必须 false。
   - `ADD / REDUCE / AUTO_TRADE` 仍在 prohibitedActions。

### 3.2 前端展示

开发内容：

1. position 级 FIVD-R 详情展示纪律 bucket、有效期、复核频率和条件组。
2. 用条件清单展示，不展示为交易按钮。
3. blockedReasons 必须可见。

### 3.3 验收脚本

开发内容：

1. 新增真实数据验收脚本。
2. 对当前真实组合覆盖：
   - 至少 1 个非现金持仓。
   - 若存在现金持仓，必须验证现金纪律为 no_action。
   - 若存在股票持仓，必须验证股票纪律包含退出/失效条件。
3. 验证 validation failed 时 formalTradeActionAllowed=false。

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
2. 调用真实 position 级 FIVD-R API。
3. 前端打开 position 级 FIVD-R 详情。
4. 验证 `tradingDiscipline.schemaVersion=fivd.r.trading_discipline.v2`。
5. 验证非现金持仓包含 bucket、disciplineType、validFrom、validUntil、reviewCadence、condition groups。
6. 验证现金类资产不生成买卖纪律。
7. 验证 validation failed 时 `formalTradeActionAllowed=false`。
8. 截图和审计 JSON 留存到 `.verification/`。

PRD 验收：

- discipline 不等于交易动作。
- discipline 不绕过 validation gate。
- LLM 不新增交易结论。
- 现金不生成买卖建议。

## 5. 审计意见

审计时间：开发前。

结论：允许进入 Phase 5 实质开发。

致命风险：无。

重大风险：无。

一般风险：

1. 当前真实组合资产类型较多，纪律规则可能需要先覆盖核心类型再渐进扩展。
   - 闭环要求：验收中必须明确已覆盖/未覆盖资产类型，未覆盖类型必须 explicit insufficient 或 no_action。
2. Phase 4 expectedReturn 对债券/基金类多为 insufficient。
   - 闭环要求：纪律不能把 insufficient 包装为可交易信号。
3. 当前 validation evidence 仍未通过。
   - 闭环要求：所有 discipline 输出都必须保留 formalTradeActionAllowed=false。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见均已有开发和验收约束。

进入实质开发条件：

- 允许进入 Phase 5 实质开发。
- 开发中若发现现金生成买卖建议、validation gate 被绕过、或纪律被包装为正式交易动作，必须停止并打回计划阶段。

## 6. 开发后实现结果

实现时间：2026-06-02。

实现结论：Phase 5 实质开发已完成。

后端实现：

- `tradingDiscipline` 升级为 `fivd.r.trading_discipline.v2`。
- 新增 `bucket`、`disciplineType`、`validFrom`、`validUntil`、`reviewCadence`、`currentWeight`、`maxAllowedWeight`、`targetWeightMultiplier`。
- 新增条件组：`addConditions`、`reduceConditions`、`stopConditions`、`takeProfitConditions`、`invalidationConditions`。
- 现金资产固定输出 `bucket=cash`、`disciplineType=no_action`、`action=NO_ACTION`、`formalTradeActionAllowed=false`。
- Validation Evidence 未通过时继续保留 `formalTradeActionAllowed=false`，并保留 `ADD / REDUCE / AUTO_TRADE` 禁止动作。

前端实现：

- Position 级 FIVD-R 详情新增 Trading Discipline Engine 区块。
- 展示 bucket、disciplineType、有效期、复核频率、最大允许仓位、目标仓位乘数和条件组。
- 条件以清单展示，不渲染为交易按钮。
- blockedReasons 与 `formalTradeActionAllowed=false` 保持可见。

## 7. 开发后 PRD 规格复检

复检结论：通过。

规格对应关系：

- FIVD-R 明确区分纪律边界和正式交易动作。
- 现金资产不生成买卖纪律。
- Validation Evidence 未通过时不允许 formal ADD / REDUCE / AUTO_TRADE。
- LLM 解释层没有新增买卖结论。
- 交易纪律已具备有效期、复核频率、退出/止损/止盈/失效条件。

未闭合但不构成本阶段重大偏差的事项：

- 当前真实非现金样本 `009725` 仍因 `fund_like_value_factset_missing` 和 `validation_evidence` 被阻断。
- 本阶段输出 `action=REDUCE` 是纪律复核动作，不是正式交易指令；正式执行仍由 `formalTradeActionAllowed=false` 阻断。
- Portfolio 级 FIVD-R 耗时仍偏高，后续应进入缓存化或 Operation 化性能治理。

## 8. 真实数据端到端验收结果

验收时间：2026-06-02。

专项命令：

```text
node scripts/verify-fivd-r-phase5-trading-discipline.mjs
```

验收结果：通过。

真实样本：

- 非现金持仓：`009725 / 中期债（一年） / positionId=4d144dc4-953d-4ce6-aa40-26f9277023b7`
  - `schemaVersion=fivd.r.trading_discipline.v2`
  - `bucket=core`
  - `disciplineType=hold_review`
  - `formalTradeActionAllowed=false`
  - `addConditions=0`
  - `reduceConditions=3`
  - `stopConditions=2`
  - `takeProfitConditions=1`
  - `invalidationConditions=6`
  - `blockedReasons=["fund_like_value_factset_missing","validation_evidence"]`
- 现金持仓：`现金-现金-银行卡 / 银行卡 / positionId=d12d3350-9915-4222-b5f4-aebb52ce30b8`
  - `schemaVersion=fivd.r.trading_discipline.v2`
  - `bucket=cash`
  - `disciplineType=no_action`
  - `action=NO_ACTION`
  - `formalTradeActionAllowed=false`
  - `addConditions=0`
  - `reduceConditions=0`
  - `stopConditions=0`
  - `takeProfitConditions=0`
  - `invalidationConditions=1`
  - `blockedReasons=["validation_evidence","cash_no_trade_discipline"]`

验收产物：

- 审计 JSON：`.verification/fivd-r-phase5-trading-discipline-audit.json`
- 前端截图：`.verification/fivd-r-phase5-trading-discipline.png`
- Portfolio 级真实接口耗时：`26885ms`
- Position 级真实接口耗时：非现金 `10545ms`，现金 `10742ms`

专项验收判断：

- `cashCovered=true`
- `validationGatePreserved=true`
- 前端展示 `Trading Discipline Engine`、加仓条件、减仓复核、失效条件和 `formalTradeActionAllowed=false`。
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
- `tradeActionReadiness.blockerGateIds=["validation_evidence"]`。

`test:trade-action-readiness` 作为固定负向门禁继续要求在 validation 未通过前失败，且 blocker 必须清晰指向 `validation_evidence`。

## 10. 开发后审计意见

审计时间：2026-06-02。

结论：Phase 5 验收通过，允许进入 Phase 6 的开发前计划与审计。

致命风险：无。

重大风险：无。

一般风险：

1. FIVD-R 真实接口耗时仍偏高。
   - 审计意见：不影响 Phase 5 规格正确性，但后续必须继续纳入性能治理。
2. 非现金样本仍存在事实集不足。
   - 审计意见：本阶段已正确将其表现为 blocker，而不是包装为可交易信号。
3. 纪律动作名称可能被误读为正式交易建议。
   - 审计意见：前后端必须持续展示 `formalTradeActionAllowed=false` 和 blockedReasons，Phase 6 接入 PositionAdvice 时不得把纪律动作直接转成 formal ADD/REDUCE。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见已进入 Phase 6 约束和后续性能治理。
