# FAMS Formal Validation Profile 合同

更新时间：2026-09-14

## 1. 决策与适用范围

项目所有者已批准采用“路线 A 为主、路线 C 按候选选择”的 FTR-3 重入方案。本合同取代“七个对象使用同一行业门槛并全部进入 release gate”的旧口径。

七个对象必须全部保留在冻结清单和审计报告中，但只有明确标记为 `product_release_candidate` 且 `formalGateApplicable=true` 的对象参与：

```text
allReleaseCandidatesPassed
formalValidationPassed
```

不参与 release gate 不等于删除、通过或豁免。工程样本、研究参照和当前持仓仍需显示真实回测结果、角色、排除原因和 evidenceRefs。

## 2. 冻结候选分类

| candidateId | candidateRole | validationProfileId | formalGateApplicable | benchmarkId | 原因 |
| --- | --- | --- | --- | --- | --- |
| `dividend_low_vol_basket` | `product_release_candidate` | `equity_selection_release_v1` | true | `csi300_total_return_h00300` | 红利低波 PRD 明确要求候选级 formal validation |
| `permanent_portfolio` | `research_reference_strategy` | `strategic_allocation_reference_v1` | false | null | PRD 只要求研究比较，未批准其进入正式 release gate |
| `all_weather` | `research_reference_strategy` | `strategic_allocation_reference_v1` | false | null | PRD 只要求研究比较，未批准其进入正式 release gate |
| `current_holdings_buy_and_hold` | `diagnostic_snapshot` | `current_holdings_diagnostic_v1` | false | null | 用户当前事实快照，不是可发布策略 |
| `local_real_data_sample_60_40` | `engineering_path_fixture` | `engineering_path_only_v1` | false | null | 仅验证真实数据计算路径 |
| `local_real_data_equal_weight_5` | `engineering_path_fixture` | `engineering_path_only_v1` | false | null | 仅验证真实数据计算路径 |
| `local_real_data_concentrated_3` | `engineering_path_fixture` | `engineering_path_only_v1` | false | null | 仅验证真实数据计算路径 |

若永久组合、全天候或其他策略未来要升级为产品 release candidate，必须重新打开 A0，冻结新的候选版本、匹配的 total-return benchmark 和 validation profile，不能沿用本次非适用状态直接判绿。

## 3. `equity_selection_release_v1` 门槛

红利低波产品候选必须同时满足：

```text
configuredMinSampleSize=60
walkForwardWindows>=6
walkForwardPassedRatio>=0.6
configuredMaxDrawdown=-35%
maxAnnualizedTurnoverPercent=200
releaseEffectivePathCount>=30
tradeabilityCoveragePercent>=80
industryGroupCount>=3
marketRegimeGroupCount>=3
liquidityGroupCount>=3
testedParameterSets>=5
stableParameterSetRatio>=0.6
bestWorstReturnSpreadPercentPoints<=15
maxDrawdownSpreadPercentPoints<=10
benchmarkType in official_total_return/trusted_total_return
benchmarkQualificationPassed=true
```

计算口径：

- walk-forward 使用预先冻结的六个等距结束点，每个验证窗口 60 个共同交易日；窗口可以重叠，但必须披露，不能按结果挑选。
- 每个窗口通过必须同时满足相对冻结 benchmark 的超额收益不低于 0、最大回撤不低于 -35%、年化换手不高于 200%、数据质量可用。
- `releaseEffectivePath` 是“候选成分 × 有效验证窗口”；价格、benchmark、成本、交易约束和 artifact replay 任一不完整均不得计入。
- 行业组来自 FTR-1 冻结行业证据；每组至少 3 条有效 component-window path 且覆盖率不低于 80%。
- 市场状态组按六个冻结 benchmark 窗口收益的确定性三分位标记 `down / neutral / up`，不得在看到候选收益后调整边界。
- 流动性组按 FTR-1 冻结价格/成交量序列的中位成交量确定性三分位标记 `low / medium / high`。
- 参数敏感性必须运行五个真实重放：baseline、monthly rebalance、fee +20bp、slippage +20bp、cash dividend；不能用主曲线长度代理。

## 4. 其他 profile 的状态语义

```text
strategic_allocation_reference_v1 -> research_result_only
current_holdings_diagnostic_v1    -> diagnostic_result_only
engineering_path_only_v1          -> engineering_result_only
```

这些 profile：

- 必须生成真实结果并显示失败/不足信息；
- 不要求 `industryGroupCount>=3`；
- 不计入 `allReleaseCandidatesPassed`；
- 不得输出 `status=passed` 冒充正式产品验证，只能输出 `formalGateStatus=not_applicable`；
- 不得因不参与 gate 而从 candidate inventory、HTML 或 failure taxonomy 消失。

## 5. Benchmark 路线 C 约束

本阶段只冻结：

```text
dividend_low_vol_basket -> csi300_total_return_h00300@已验收版本
```

这是候选级映射能力的首个实例，不表示 H00300 对所有策略都适用。未来将固定配置策略升级为产品候选时，必须先在 FTR-2 新增与策略使命相匹配的可信 total-return benchmark；未取得合格 benchmark 时保持 `insufficient`。

## 6. A0 重入和证据失效

A0 必须新增不可变 `validation_profile_set.json`，至少包括：

```text
candidate inventory
candidate versions
candidate roles
validationProfileId
formalGateApplicable
benchmarkId
componentIds
definitionHash
profileSetHash
ownerDecisionRef
```

新 profile set 生成后：

- 原 A0/FTR-1/FTR-2 产物作为历史证据保留；
- 依赖旧七候选统一 gate 语义的结论失效；
- 原始真实行情、H00300 响应和来源条款可按哈希复用；
- 必须重新生成候选绑定后的 A0、FTR-1、FTR-2 provisional artifact；
- 只有新的 profile set、FTR-1、FTR-2 哈希完全对应时才可进入 FTR-3。

## 7. 反假绿门槛

以下任一情况 hard fail：

- 从七对象 inventory 删除失败对象；
- 非产品对象被计入 `allReleaseCandidatesPassed`；
- `not_applicable` 被转换成正式 `passed`；
- 未冻结 profile 或 benchmark 的对象进入 release gate；
- 调整窗口、分组或候选成分以迎合结果；
- FTR-1 tradeability 与 FTR-3 使用不同成分、日期或分母却声明一致；
- 研究参照策略没有结果或排除原因；
- 任何交易权限被置为 true。

即使 FTR-3 自动验收通过，仍必须保持：

```text
humanAcceptanceStatus=pending_batch_review
releaseApprovalStatus=pending_human_approval
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```
