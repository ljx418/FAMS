# Formal Validation 指标定义

更新时间：2026-07-16

## 1. 目的

将 S4 formal validation 中的阈值公式化，避免不同实现对 `effectivePathCount`、walk-forward、行业分组和参数敏感性产生不同解释。

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

## 3. S4 最低门槛

```text
effectivePathCount >= 30
industryGroupCount >= 3
walkForwardWindows >= 6
walkForwardPassedRatio >= 0.6
parameterSensitivityStatus != insufficient
groupStabilityStatus != insufficient
tradeConstraintsComplete=true
totalReturnBenchmarkAvailable=true or validationStatus=insufficient
```

任一门槛不满足，`formalValidationStatus` 必须是 `insufficient` 或 `failed`，不得写成 `passed`。

