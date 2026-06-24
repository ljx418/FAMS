# FIVD-R Phase 17 Market Data Remediation 开发计划、验收标准与审计意见

日期：2026-06-02

## 1. 阶段目标

将 `market_data` / `provider_health` 类 DataGap 从 planned 推进到 symbol 级可执行补数动作。

本阶段只提升研究/观察的数据可用性：

- 不放行 `ADD / REDUCE / AUTO_TRADE`。
- 不绕过 `validation_evidence`。
- 不把缓存预热失败包装为通过。
- 不把行情可用包装成基本面、估值或财报事实集可用。

## 2. 开发任务

1. 扩展 `market_bar_cache_preheat` Operation 输入，支持 `symbols`。
2. DataGap remediation 将有 symbol 的 `market_data` / `provider_health` gap 映射为 executable。
3. `data-gap-remediation-operation` 支持启动 symbol 级 `market_bar_cache_preheat`。
4. 新增真实数据验证脚本。

## 3. 涉及文件

```text
backend/src/services/operation/operationService.ts
backend/src/services/analysis/dataGapRemediationService.ts
backend/src/routes/analysis.ts
backend/src/routes/operation.ts
frontend/src/services/analysisService.ts
backend/scripts/verify-fivd-r-market-data-remediation.ts
backend/package.json
docs/fams_analysis_advice_core_docs/18_FIVD_R_Phase12_15_Closure_Plan.md
docs/fams_analysis_advice_core_docs/05_Data_API_Schema_Reference.md
docs/fams_analysis_advice_core_docs/06_Testing_Validation_Checklist.md
docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md
```

## 4. 验收标准

必须通过：

```text
1. market_data/provider_health gap with symbol => executable。
2. operationType=market_bar_cache_preheat。
3. operationInput 包含 symbols、days、limit、chunkSize、executionMode。
4. 启动后生成 queued market_bar_cache_preheat operation。
5. worker 执行后产出 market_bar_cache_preheat_report.json。
6. result.requestedSymbols 等于输入 symbol 数，而不是默认 universe limit。
7. artifact 包含 beforeCoverage / afterCoverage / featureReport。
8. 交易边界不变，test:trade-action-readiness 仍因 validation_evidence 按预期失败。
```

禁止：

```text
1. 无 symbol 的 market gap 被标记为 executable。
2. 预热失败被包装成 sufficient。
3. 行情缓存预热改变 valuation/fundamental/financial_report gaps。
4. 任何接口因行情预热放行 ADD / REDUCE / AUTO_TRADE。
```

## 5. 审计意见

致命风险：无。

重大风险：无。

一般风险：

- provider 网络波动可能导致 operation partial。闭环要求保留 partial 和 warnings，不可伪造成 completed。
- 该动作只适用于交易所行情/特征缓存，不适用于基金净值事实集或黄金宏观事实集。

结论：

允许进入实质开发。若验收中 `requestedSymbols` 仍走默认 universe，或 failed/partial 被包装为 passed，必须打回计划阶段。
