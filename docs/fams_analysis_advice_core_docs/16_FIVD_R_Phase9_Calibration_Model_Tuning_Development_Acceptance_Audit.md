# FIVD-R Phase 9：Calibration 与 Model Tuning 开发验收审计

版本：v0.1  
日期：2026-06-02

## 1. 阶段目标

Phase 9 的目标是基于 Phase 7 replay 产物建立动作质量、概率校准和 Champion/Challenger 调优闭环。

本阶段不得因为调参目标而降低 validation gate，不得自动 promote challenger。

## 2. PRD 规格检视

对应总 PRD 和模型架构要求：

- 输出 ADD/REDUCE/HOLD/OBSERVE/AVOID 动作质量。
- 输出 p05-p95、p25-p75、上涨概率、expectedReturnError 等校准指标。
- 支持 challenger trial 和 comparison report。
- promote 必须人工确认。

当前实现差距：

- Phase 7 replay 产物已存在，但还没有 calibration report。
- 当前 replay 未包含每个窗口的 expectedReturn quantile outcome。
- validation gate 未通过，因此没有可执行 ADD/REDUCE 样本。

规格结论：

- 本阶段可以完成 action quality 和 comparison report。
- 概率校准不足必须明确 `insufficient`，不得伪造 coverage 指标。

## 3. 开发计划

开发内容：

1. 新增 `backend/scripts/verify-fivd-r-phase9-calibration.ts`。
2. 读取 `.verification/fivd-r-phase7-advice-replay-audit.json`。
3. 输出：
   - actionQuality
   - probabilityCalibration
   - modelComparison
   - promoteDecision
4. 验证：
   - Gate-Strict 没有 formal ADD / REDUCE。
   - 概率校准不足时明确 insufficient。
   - challenger 不得自动 promote。

## 4. 验收结果

专项命令：

```text
node node_modules/tsx/dist/cli.mjs scripts/verify-fivd-r-phase9-calibration.ts
```

结果：通过。

真实来源：

- Phase 7 真实 replay 产物：`.verification/fivd-r-phase7-advice-replay-audit.json`
- windowsChecked=`8`
- validationGateRespected=`true`
- probabilityCalibration=`insufficient`
- promoteStatus=`not_promoted`
- requiresHumanConfirmation=`true`

验收产物：

- `.verification/fivd-r-phase9-calibration-audit.json`

专项验收判断：

- 未使用 mock replay。
- 未伪造概率校准指标。
- 未自动 promote challenger。
- 未弱化 validation gate。

## 5. 固定门禁复验结果

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
- Calibration 未触发 promote，也未弱化交易 gate。

## 6. 审计意见

审计时间：2026-06-02。

结论：Phase 9 验收通过，允许进入 Phase 10 开发前计划与审计。

致命风险：无。

重大风险：无。

一般风险：

1. 概率校准仍为 insufficient。
   - 审计意见：这是正确结果，原因是 Phase 7 replay 尚未携带 expectedReturn quantile outcome。
2. Challenger 只是 research-only shadow。
   - 审计意见：不得 promote，后续需要更多 replay 样本和人工确认。
