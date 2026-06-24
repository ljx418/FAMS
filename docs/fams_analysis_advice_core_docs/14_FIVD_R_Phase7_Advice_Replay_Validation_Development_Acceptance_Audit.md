# FIVD-R Phase 7：Advice Replay & Validation 开发前计划

版本：v0.2  
日期：2026-06-02

## 1. 阶段目标

Phase 7 的目标是用真实历史数据验证 FIVD-R 分析建议体系是否改善组合结果，并审计是否存在未来函数、Research-Only 被误执行、或 validation gate 被弱化。

本阶段不以收益表现作为唯一目标；必须同时输出动作质量、风险预算、无未来函数审计和 gate 执行结果。

## 2. PRD 规格检视

对应总 PRD 和模型架构要求：

- 支持 Fixed Start：3m / 2m / 1m。
- 支持 Rolling Start：最近半年每周。
- 支持模式：
  - Gate-Strict
  - Research-Only
  - Buy & Hold
  - Benchmark
- 输出：
  - decision timeline
  - simulated trades
  - portfolio curve
  - action quality
  - risk budget report
  - no-future-leak audit
- Gate-Strict 不得执行 validation failed 的 formal ADD / REDUCE。

当前实现差距：

- 系统已有策略回测和 validation evidence，但尚未对 FIVD-R position/portfolio 建议做 replay。
- Phase 6 已把 FIVD-R 接入 PositionAdvice，可作为 replay 的建议输入。
- 当前 validation evidence 仍未通过，Gate-Strict 模式应产生 no formal trade 的结果。

规格结论：

- Phase 7 与总 PRD 一致。
- 如果真实历史数据不足以覆盖阶段验收，不得用 mock 替代通过。
- 如果无法证明 reviewDate 后数据不可读取，必须打回计划阶段。

## 3. 开发计划

### 3.1 Replay 数据与时间边界

开发内容：

1. 新增 FIVD-R replay service 或脚本入口。
2. 输入：
   - userId
   - mode
   - startPolicy
   - reviewDate
   - horizonDays
3. 只读取 `reviewDate <= tradeDate <= horizonEnd` 的价格用于模拟结果。
4. 生成 no-future-leak audit：
   - maxObservedTradeDate
   - reviewDate
   - leaked=false
   - dataSourceRefs

### 3.2 决策与交易模拟

开发内容：

1. Gate-Strict：
   - validation failed 时不执行 formal ADD / REDUCE。
   - 只记录 OBSERVE / HOLD / RESEARCH。
2. Research-Only：
   - 记录模型倾向，但不进入 simulated trades。
3. Buy & Hold：
   - 以真实持仓作为基线。
4. Benchmark：
   - 使用可用宽基或组合现金基线。

### 3.3 输出与审计

开发内容：

1. 输出 replay report：
   - `schemaVersion=fivd.r.advice_replay.v1`
   - decisionTimeline
   - simulatedTrades
   - portfolioCurve
   - actionQuality
   - riskBudgetReport
   - noFutureLeakAudit
   - blockedReasons
2. 写入 `.verification/` 真实验收 JSON。
3. 前端或文档至少提供可审计摘要。

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
2. 至少选择一个有真实价格历史的非现金持仓。
3. 运行 Gate-Strict replay。
4. 验证 validation failed 时 simulatedTrades 不包含 formal ADD / REDUCE。
5. 验证 noFutureLeakAudit.leaked=false。
6. 验证 maxObservedTradeDate 不晚于 horizonEnd，且决策输入不读取 reviewDate 后数据。
7. 输出 `.verification/fivd-r-phase7-advice-replay-audit.json`。

PRD 验收：

- replay 不得用未来行情生成决策。
- Research-Only 不得进入正式模拟交易。
- Gate-Strict 必须执行 validation gate。
- 回放结果必须可复现。

## 5. 开发前审计意见

审计时间：2026-06-02。

结论：允许进入 Phase 7 第一段实质开发，范围限定为 Gate-Strict + Buy & Hold 的真实数据 replay 最小闭环。

致命风险：无。

重大风险：无。

一般风险：

1. 当前真实价格历史可能对基金/债券覆盖不足。
   - 闭环要求：第一段只验收有真实价格历史的非现金持仓；覆盖不足资产必须 explicit insufficient。
2. 未来函数风险高于前序阶段。
   - 闭环要求：脚本必须输出 noFutureLeakAudit，且验收必须断言 leaked=false。
3. 当前 validation evidence 未通过。
   - 闭环要求：Gate-Strict replay 不得产生 formal ADD / REDUCE simulated trades。
4. Replay 完整 PRD 范围较大。
   - 闭环要求：第一段明确只完成 Gate-Strict + Buy & Hold 最小闭环，Rolling Start、多模式对比和前端完整可视化进入后续子段。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见均已有开发和验收约束。

进入实质开发条件：

- 允许进入 Phase 7 第一段实质开发。
- 开发中若发现无法证明无未来函数、真实数据不足以验收、或 Gate-Strict 执行了 validation failed 的 formal trade，必须停止并打回计划阶段。

## 6. 开发后实现结果

实现时间：2026-06-02。

实现结论：Phase 7 第一段实质开发已完成。

实现内容：

- 新增真实数据 replay 验收脚本：`backend/scripts/verify-fivd-r-phase7-advice-replay.ts`。
- 从当前真实持仓中选择有真实 `PriceHistory` 的非现金资产。
- 以历史 `reviewDate` 作为决策输入边界。
- reviewDate 后的价格只用于 outcome / portfolio curve，不用于决策。
- 输出：
  - `schemaVersion=fivd.r.advice_replay.v1`
  - decisionTimeline
  - simulatedTrades
  - portfolioCurve
  - buyHoldCurve
  - actionQuality
  - riskBudgetReport
  - noFutureLeakAudit
  - blockedReasons

## 7. 开发后 PRD 规格复检

复检结论：第一段通过。

规格对应关系：

- Gate-Strict 已执行 validation gate。
- Validation evidence 不可用于历史 reviewDate 时，明确输出 `validation_evidence_unavailable_at_review`。
- validation failed 时未生成 formal ADD / REDUCE simulated trades。
- no-future-leak audit 已输出并断言 `leaked=false`。
- Buy & Hold baseline 已输出。

未覆盖的完整 Phase 7 PRD 范围：

- Rolling Start 最近半年每周尚未实现。
- Research-Only / Benchmark 多模式对比尚未完整实现。
- 前端完整 replay 可视化尚未实现。
- 多持仓组合级资金再平衡尚未实现。

审计判断：

- 这些是 Phase 7 后续子段范围，不构成第一段重大偏差。
- 第一段目标是证明真实历史数据 replay、Gate-Strict 和 no-future-leak 最小闭环可用。

## 8. 真实数据端到端验收结果

验收时间：2026-06-02。

专项命令：

```text
node node_modules/tsx/dist/cli.mjs scripts/verify-fivd-r-phase7-advice-replay.ts
```

验收结果：通过。

真实样本：

- 标的：`009725`
- reviewDate=`2026-05-11`
- horizonEnd=`2026-05-29`
- decisionAction=`OBSERVE`
- simulatedTrades=`0`
- noFutureLeakAudit.leaked=`false`
- blockedReasons=`["validation_evidence_unavailable_at_review","validation_evidence"]`

验收产物：

- 审计 JSON：`.verification/fivd-r-phase7-advice-replay-audit.json`

专项验收判断：

- 使用真实持仓和真实 PriceHistory。
- 决策输入未读取 reviewDate 后价格。
- outcome curve 使用 reviewDate 后真实价格。
- Gate-Strict 没有执行 validation failed 的 formal ADD / REDUCE。
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

结论：Phase 7 第一段验收通过，允许进入 Phase 7 第二段或 Phase 8 的开发前计划与审计。

致命风险：无。

重大风险：无。

一般风险：

1. 第一段只覆盖单持仓 replay。
   - 审计意见：下一子段必须扩展到组合级 replay 和多模式对比。
2. reviewDate 上 validation evidence 不可用时只能输出 blocked replay。
   - 审计意见：这是正确的无未来函数处理，不应通过引用未来 validation operation 来让历史决策变绿。
3. 当前 benchmark 仅为 Buy & Hold。
   - 审计意见：后续子段需要补宽基 Benchmark 与 Research-Only 对照。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见进入后续 Phase 7 子段。

## 11. Phase 7 第二段开发前计划与审计

计划时间：2026-06-02。

目标：补齐 Phase 7 第一段未覆盖的多模式、多窗口 replay 最小闭环。

开发范围：

- Fixed Start：`fixed_3m / fixed_2m / fixed_1m`。
- Rolling Start：`rolling_weekly`。
- 模式：
  - `gate_strict`
  - `research_only`
  - `buy_and_hold`
  - `benchmark_cash`
- 每个 replay window 均输出 no-future-leak audit。
- Gate-Strict 在 validation evidence 不可用或未通过时不得执行 formal ADD / REDUCE。

验收标准：

- 使用真实持仓和真实 PriceHistory。
- 至少 30 条真实价格历史才允许多窗口验收。
- 至少覆盖 3 个 fixed windows 和 1 组 rolling windows。
- 四种模式均必须出现在验收产物。
- `noFutureLeakAudit.leaked=false`。
- `decisionInputMaxObservedTradeDate <= reviewDate`。

PRD 规格复检：

- 多窗口 replay 是 Phase 7 PRD 的核心要求，第二段与总 PRD 一致。
- cash benchmark 是第一版 Benchmark，占位但可审计；宽基 benchmark 后续继续补。
- Research-Only 只能记录研究动作，不得进入 formal simulated trades。

审计意见：

- 致命风险：无。
- 重大风险：无。
- 一般风险：
  1. 宽基 benchmark 尚未接入。
     - 闭环要求：当前明确标记为 `benchmark_cash`，不得冒充指数 benchmark。
  2. 多持仓组合级资金再平衡尚未实现。
     - 闭环要求：当前仍是 single-position multi-window replay。

结论：允许进入 Phase 7 第二段实质开发。

## 12. Phase 7 第二段实现与验收结果

实现时间：2026-06-02。

实现结论：Phase 7 第二段实质开发已完成。

实现内容：

- 扩展 `backend/scripts/verify-fivd-r-phase7-advice-replay.ts`。
- 自动选择至少 30 条真实 PriceHistory 的非现金持仓。
- 输出 fixed/rolling 多窗口 replay。
- 输出四种模式：Gate-Strict、Research-Only、Buy & Hold、cash benchmark。
- 输出汇总 no-future-leak audit，并保留每个 window 的 audit 明细。

真实数据端到端验收：

- 命令：`node node_modules/tsx/dist/cli.mjs scripts/verify-fivd-r-phase7-advice-replay.ts`
- 结果：通过。
- 真实样本：`002611`
- priceHistoryRows=`36`
- startPolicies=`["fixed_3m","fixed_2m","fixed_1m","rolling_weekly"]`
- windowsChecked=`8`
- modes=`["gate_strict","research_only","buy_and_hold","benchmark_cash"]`
- simulatedTrades=`8`
- noFutureLeakAudit.leaked=`false`
- blockedReasons=`["validation_evidence_unavailable_at_review","validation_evidence"]`
- 产物：`.verification/fivd-r-phase7-advice-replay-audit.json`

专项验收判断：

- 多窗口真实数据验收通过。
- 四种模式均已覆盖。
- Research-Only 未进入 formal simulated trades。
- Gate-Strict 未执行 formal ADD / REDUCE。
- cash benchmark 没有冒充宽基指数。
- 未使用 mock 数据作为端到端通过依据。

固定门禁复验：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:fivd-r-core`：通过。
- `npm run test:production-readiness -- --strict`：通过。
- `npm run test:trade-action-readiness`：按预期失败，唯一 blocker=`validation_evidence`。

开发后审计意见：

- 致命风险：无。
- 重大风险：无。
- 一般风险：
  1. `simulatedTrades=8` 来自 Buy & Hold 的 HOLD baseline，不是 ADD / REDUCE。
     - 审计意见：验收已断言 Gate-Strict 不执行 formal ADD / REDUCE。
  2. 仍未完成宽基 benchmark 和组合级再平衡。
     - 审计意见：进入后续主线，不影响 Phase 7 第二段通过。

结论：Phase 7 第二段验收通过，允许进入 Phase 8 开发前计划与审计。
