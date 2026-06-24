# FIVD-R Phase 4：Expected Return Distribution 开发前计划

版本：v0.2  
日期：2026-06-01

## 1. 阶段目标

Phase 4 的目标是把 FIVD-R 的 `expectedReturn` 从 placeholder 升级为基于真实历史行情的收益分布。

本阶段不开放自动交易，不改变 `validation_evidence` gate。

## 2. PRD 规格检视

对应 PRD 和模型架构要求：

- FIVD-R position 级结果必须包含 expectedReturn。
- expectedReturn 必须可追溯、可复现，有 method、sampleSize、confidence 和 evidenceRefs。
- 数据不足时必须显式 `confidence=insufficient`，不能给出乐观默认预测。
- LLM 只能解释结构化 expectedReturn，不能生成额外收益预测。
- 未通过 Validation Evidence 时，`ADD / REDUCE / AUTO_TRADE` 仍禁止。

当前实现差距：

- `expectedReturn` 当前为 `fivd.r.expected_return.placeholder.v1`。
- 当前字段可说明来源和状态，但没有真实收益分布。
- Phase 3.5 真实验收显示存在债券/基金类持仓，不能只按 A 股股票逻辑开发。

规格结论：

- Phase 4 与总 PRD 一致。
- 不能使用随机数、固定模板或静态收益假设。
- 必须优先用真实历史行情；无法取得足够历史行情时输出 insufficient。

## 3. 开发计划

### 3.1 后端 Expected Return 计算

开发内容：

1. 新增或扩展 FIVD-R expectedReturn 计算逻辑。
2. 输入：
   - positionId
   - asset symbol/type
   - 当前 reviewDate
   - 历史行情序列
3. 支持窗口：
   - `20d`
   - `60d`
4. 输出：
   - `schemaVersion=fivd.r.expected_return.distribution.v1`
   - `status=available | insufficient`
   - `method`
   - `lookbackDays`
   - `sampleSize`
   - `confidence`
   - `p05 / p25 / p50 / p75 / p95`
   - `probabilityUp`
   - `probabilityDown`
   - `maxDrawdown`
   - `evidenceRefs`
   - `blockedReasons`
5. 数据不足时：
   - `status=insufficient`
   - `distribution=null`
   - `confidence=insufficient`
   - 必须给出 blockedReasons 和 evidenceRefs。

### 3.2 无未来函数约束

开发内容：

1. 计算只允许读取 `reviewDate` 当日或之前的数据。
2. 验收脚本必须断言 `maxObservedTradeDate <= reviewDate`。
3. 输出中保留 `reviewDate`、`maxObservedTradeDate` 和 `dataVersion`。

### 3.3 前端展示

开发内容：

1. position 级 FIVD-R 详情展示 expectedReturn 分布。
2. available 时展示 p05-p95、上涨/下跌概率、最大回撤、样本量和置信度。
3. insufficient 时展示不足原因，不展示预测式话术。
4. 不增加交易动作按钮。

### 3.4 文档同步

开发后必须更新：

- 本文档的开发后 PRD 复检。
- 本文档的真实数据端到端验收结果。
- `09_FIVD_R_Remaining_Roadmap.md`。
- `HIGH_RELIABILITY_CORRECTNESS_PLAN.md`。
- `drawio-summary.txt`。

## 4. 验收计划

### 4.1 固定命令验收

必须通过：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

`test:trade-action-readiness` 在当前 validation 未通过时必须失败，且 blocker 必须仍为 `validation_evidence`。

### 4.2 阶段专属真实数据验收

必须新增或扩展真实数据验收脚本。

验收要求：

1. 使用至少 3 个真实持仓或当前真实持仓中尽可能多的非现金持仓。
2. 至少包含 1 个样本充分案例。
3. 至少包含 1 个样本不足案例；如果当前真实持仓没有样本不足案例，必须用真实资产但受控缩短 lookback 或明确记录无法构造，不得伪造数据。
4. 对每个验收持仓调用真实 position 级 FIVD-R API。
5. 验证 expectedReturn 不再是 placeholder。
6. 验证 available 结果包含 sampleSize、p05-p95、probabilityUp、probabilityDown、maxDrawdown、method 和 evidenceRefs。
7. 验证 insufficient 结果包含 blockedReasons。
8. 验证 `maxObservedTradeDate <= reviewDate`。
9. 前端打开 position 级 FIVD-R 详情并截图。

### 4.3 PRD 验收

必须确认：

- expectedReturn 基于真实历史行情。
- 没有随机数、静态默认收益率或乐观模板。
- insufficient 不被包装成预测分布。
- validation failed 时 formal trade action 不可用。
- LLM 没有新增收益预测结论。

## 5. 审计意见

审计时间：开发前。

结论：允许进入 Phase 4 实质开发。

致命风险：无。

重大风险：无。

一般风险：

1. 不同资产类型的历史行情来源不一致。
   - 闭环要求：股票/ETF/基金/债券类资产必须按现有行情能力给出 available 或 insufficient，不能缺源时编造分布。
2. 样本不足案例可能难以从当前真实组合自然产生。
   - 闭环要求：可以用真实资产和受控 lookback 构造不足场景，但不得使用 mock 行情。
3. Phase 3.5 暴露 position FIVD-R 约 16.8 秒耗时。
   - 闭环要求：Phase 4 不强行解决性能，但新增计算不能显著扩大慢路径；验收脚本必须记录耗时。

审计闭环状态：

- 无致命意见。
- 无重大意见。
- 一般意见均已有开发和验收约束。

进入实质开发条件：

- 允许进入 Phase 4 实质开发。
- 开发中若发现只能依赖 mock、随机数、未来行情或无法证明真实数据来源，必须停止并打回计划阶段。

## 6. 开发后实现结果

实现时间：2026-06-01。

实现内容：

- 后端 position 级 FIVD-R 的 `expectedReturn` 升级为 `fivd.r.expected_return.distribution.v1`。
- expectedReturn 只读取本地真实历史行情：
  - `market_bar_canonical`
  - `price_history`
- 不使用 mock、随机数、固定乐观收益率或未来行情。
- 输出 `20d / 60d` 两个窗口。
- available 时输出：
  - `sampleSize`
  - `confidence`
  - `p05 / p25 / p50 / p75 / p95`
  - `probabilityUp / probabilityDown`
  - `maxDrawdown`
- insufficient 时输出：
  - `distribution=null`
  - `confidence=insufficient`
  - `blockedReasons`
- 输出 `reviewDate` 和 `maxObservedTradeDate`，用于无未来函数审计。
- 前端 position 级 FIVD-R 详情展示 expectedReturn 的 20d/60d 分布或不足原因。
- 新增真实数据验收脚本 `scripts/verify-fivd-r-phase4-expected-return.mjs`。

## 7. 开发后 PRD 规格复检

复检结论：通过。

逐项检查：

- expectedReturn 不再是 placeholder。
- expectedReturn 基于真实本地行情数据。
- 样本不足时返回 insufficient，没有编造预测分布。
- available 结果包含分位数、上涨/下跌概率、最大回撤、样本量和置信度。
- 输出 `reviewDate / maxObservedTradeDate`，且验收验证 `maxObservedTradeDate <= reviewDate`。
- validation failed 时 formal trade action 仍不可用。
- 没有新增交易动作按钮。

未闭环但不阻断本阶段的问题：

- 非股票类持仓当前多数缺少足够历史收益样本，结果为 insufficient。
- position FIVD-R 慢路径仍存在。

## 8. 真实数据端到端验收结果

验收时间：2026-06-01。

验收脚本：

```text
node scripts/verify-fivd-r-phase4-expected-return.mjs
```

验收产物：

```text
.verification/fivd-r-phase4-expected-return.png
.verification/fivd-r-phase4-expected-return-audit.json
```

真实数据覆盖：

```text
009725 / 中期债（一年） / bond / insufficient
601127 / 赛里斯 / stock / available
013785 / 中期债（一年） / bond / insufficient
```

关键结果：

- `availableCount=1`
- `insufficientCount=2`
- `noFutureLeak=true`
- portfolioLatencyMs=`26106`
- `601127` expectedReturn：
  - status=`available`
  - confidence=`medium`
  - sampleSize=`110`
  - maxObservedTradeDate=`2026-05-29`
  - reviewDate=`2026-06-01`
  - 20d sampleSize=`110`
  - 60d sampleSize=`70`
- `009725` 和 `013785`：
  - status=`insufficient`
  - blockedReasons=`20d_sample_insufficient / 60d_sample_insufficient`
  - maxObservedTradeDate=`2026-05-29`

验收结论：通过。

## 9. 固定门禁复验结果

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

## 10. 开发后审计意见

审计结论：Phase 4 完成。

致命风险：无。

重大风险：无。

一般风险：

1. 债券/基金类持仓历史行情样本不足。
   - 审计意见：当前以 insufficient 暴露真实数据缺口，符合 PRD，不构成虚假验收。
2. position FIVD-R 慢路径仍存在，单持仓验收耗时约 11-26 秒。
   - 审计意见：后续 Phase 5 或专项性能阶段应缓存化或 Operation 化。
3. 当前收益分布是历史持有期收益分布，不是预测模型。
   - 审计意见：前端和字段命名必须继续避免承诺式预测话术。

是否需要停止找用户确认：

- 未发现 PRD 大偏差。
- 未发现虚假验收风险。
- 未使用 mock、随机数或未来行情。
- 未放行交易动作。
- 因此不触发停止条件，可以进入 Phase 5 开发前计划与审计。
