# Formal Validation 指标定义

更新时间：2026-09-14

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

2026-09-14 路线 A 重入后，候选角色、门槛适用性和候选级 benchmark 以 `FORMAL_VALIDATION_PROFILE_CONTRACT.md` 为准。七个对象继续全部保留，但 `allReleaseCandidatesPassed` 只统计 `candidateRole=product_release_candidate` 且 `formalGateApplicable=true` 的对象；其他对象必须显示为 `formalGateStatus=not_applicable`，不能被删除或冒充 passed。

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

`effectivePathCount` 是满足以上条件的路径数量。缺 benchmark 或 replay 不可复算的路径不得计入。`equity_selection_release_v1` 中一条 release path 固定为“候选成分 × 冻结验证窗口”，同一成分/窗口只能计数一次。

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
maxDrawdown >= configuredMaxDrawdown
turnoverWithinLimit=true
dataQualityStatus != insufficient
```

FTR-3 `equity_selection_release_v1` 的冻结值为：

```text
configuredMinSampleSize=60 个交易日
configuredMaxDrawdown=-35%  # 回撤不得低于 -35%
maxAnnualizedTurnoverPercent=200%
```

换手口径固定为：验证窗口开始时的初始建仓不计入换手率分子，但初始建仓交易成本必须进入净值；窗口内后续日历调仓的双边绝对成交额计入换手率分子。这样可避免短窗口仅因初始资金部署被错误年化为高换手，同时不能隐藏真实调仓成本。

`walkForwardPassedRatio = passedWindows / validWindows`。数据缺失导致无效的窗口不进入分母，但必须进入 `insufficientWindowCount`。

### 分组适用性与 `industryGroupCount`

行业分组必须满足：

```text
groupEffectivePathCount >= 3
groupSampleCoverage >= 80%
```

`industryGroupCount` 只统计满足以上条件的行业组。

行业分组只对 `equity_selection_release_v1` 强制。`strategic_allocation_reference_v1`、`current_holdings_diagnostic_v1` 和 `engineering_path_only_v1` 不参与本阶段 release gate，行业分组为 `not_applicable`；该状态不得转换成 `passed`。

`equity_selection_release_v1` 还必须分别形成至少 3 个市场状态组和 3 个流动性组。市场状态按冻结 benchmark 窗口收益的确定性三分位划分，流动性按冻结成分序列中位成交量的确定性三分位划分，算法和输入哈希必须进入 artifact。

### parameterSensitivityStatus

参数敏感性从 `insufficient` 升级至少需要：

```text
testedParameterSets >= 5
stableParameterSetRatio >= 0.6
bestWorstReturnSpreadWithinPolicy=true
maxDrawdownSpreadWithinPolicy=true
```

其中两个离散度布尔值必须由真实参数重放计算，不得由样本长度或主曲线代理：

```text
bestWorstReturnSpreadPercentPoints <= 15
maxDrawdownSpreadPercentPoints <= 10
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
releaseEffectivePathCount >= 30  # 仅对 formalGateApplicable=true 的产品候选
industryGroupCount >= 3          # equity_selection_release_v1
marketRegimeGroupCount >= 3      # equity_selection_release_v1
liquidityGroupCount >= 3         # equity_selection_release_v1
walkForwardWindows >= 6
walkForwardPassedRatio >= 0.6
parameterSensitivityStatus != insufficient
groupStabilityStatus != insufficient
tradeConstraintsComplete=true
totalReturnBenchmarkAvailable=true or validationStatus=insufficient
```

任一门槛不满足，`formalValidationStatus` 必须是 `insufficient` 或 `failed`，不得写成 `passed`。

非产品对象不适用上述 release gate 时必须输出 `formalGateStatus=not_applicable` 和明确的 `exclusionReason`；它们既不帮助也不阻止 `allReleaseCandidatesPassed`，但其真实研究/诊断结果仍须保留。

`releaseEffectivePathCount` 的汇总值只用于展示；每个候选必须独立达到 30，不能用其他候选的路径数量抵消。参数组、walk-forward 窗口、行业/市场/流动性分组必须有独立输入快照和输出哈希。

即使 `formalValidationPassed=true`，仍必须保持：

```text
releaseApprovalStatus=pending_human_approval
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```
