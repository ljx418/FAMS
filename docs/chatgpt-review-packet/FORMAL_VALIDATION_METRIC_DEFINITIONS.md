# Formal Validation 指标定义

更新时间：2026-07-16

## 1. 目的

将 S4 formal validation 中的阈值公式化，避免不同实现对 `effectivePathCount`、walk-forward、行业分组和参数敏感性产生不同解释。

2026-07-16 起，本合同同时作为 `FTR-3` 的正式指标定义。`S4` 是已完成的合同实现基线；`FTR-3` 负责使用正式数据和合格 benchmark 对明确的 release candidate 集合执行这些指标。

必须先固定：

```text
releaseCandidateStrategyIds
releaseCandidateStrategyVersions
excludedStrategyIds
excludedStrategyReasons
```

release candidate 的失败结果不得为获得全绿而静默移除。`allReleaseCandidatesPassed=true` 才能设置 `formalValidationPassed=true`。

## 2. 指标定义

### effectivePath

一个 `effectivePath` 是一条可复算的策略-资产/组合-时间窗口路径，必须同时满足：

```text
inputUniverseResolved=true
priceSeriesCoverage >= 80%
tradeabilityCoverage >= 80%
benchmarkStatus in official_total_return / trusted_total_return / free_source_total_return
costModelResolved=true
rebalanceScheduleResolved=true
artifactReplayable=true
```

`effectivePathCount` 是满足以上条件的路径数量。缺 benchmark 或 replay 不可复算的路径不得计入。

上述集合用于兼容已经完成的 S4 formal-review 基线。进入 FTR-3 release candidate 验证时必须额外满足：

```text
benchmarkStatus in official_total_return / trusted_total_return
benchmarkQualificationPassed=true
```

因此 `free_source_total_return` 路径可以继续显示在研究/评审报告中，但不得计入 FTR-3 的 `releaseEffectivePathCount`，也不得帮助 `allReleaseCandidatesPassed` 判绿。

### walk-forward window

一个 walk-forward 窗口必须有独立训练区间、验证区间和参数快照。窗口 passed 条件：

```text
validationSampleSize >= configuredMinSampleSize
excessReturn >= 0
maxDrawdown <= configuredMaxDrawdown
turnoverWithinLimit=true
dataQualityStatus != insufficient
```

`walkForwardPassedRatio = passedWindows / validWindows`。数据缺失导致无效的窗口不进入分母，但必须进入 `insufficientWindowCount`。

### industryGroupCount

行业分组必须满足：

```text
groupEffectivePathCount >= 3
groupSampleCoverage >= 80%
```

`industryGroupCount` 只统计满足以上条件的行业组。

### parameterSensitivityStatus

参数敏感性从 `insufficient` 升级至少需要：

```text
testedParameterSets >= 5
stableParameterSetRatio >= 0.6
bestWorstReturnSpreadWithinPolicy=true
maxDrawdownSpreadWithinPolicy=true
```

### groupStabilityStatus

分组稳定性从 `insufficient` 升级至少需要：

```text
industryGroupCount >= 3
marketRegimeGroupCount >= 3
liquidityGroupCount >= 3
eachGroupHasEffectivePath=true
```

## 3. S4 基线与 FTR-3 最低门槛

```text
effectivePathCount >= 30
releaseEffectivePathCount >= 30  # FTR-3，仅 official/trusted benchmark
industryGroupCount >= 3
walkForwardWindows >= 6
walkForwardPassedRatio >= 0.6
parameterSensitivityStatus != insufficient
groupStabilityStatus != insufficient
tradeConstraintsComplete=true
totalReturnBenchmarkAvailable=true or validationStatus=insufficient
```

任一门槛不满足，`formalValidationStatus` 必须是 `insufficient` 或 `failed`，不得写成 `passed`。

即使 `formalValidationPassed=true`，仍必须保持：

```text
releaseApprovalStatus=pending_human_approval
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```
