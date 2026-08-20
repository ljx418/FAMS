# FTR-0 至 FTR-6 实施状态

更新时间：2026-08-20

## 当前结论

FTR-0 至 FTR-6 的计划内工程能力已经实现。系统能够生成完整、可哈希复核的正式发布人工评审包，但当前业务门禁仍阻塞，因此没有也不能解锁真实交易。

```text
nextStage.implementationStatus=engineering_complete_business_gates_blocked
formalDataGovernancePassed=false
benchmarkQualificationPassed=false
formalValidationPassed=false
manualSignoffPassed=false
executionIsolationPassed=true
formalTradingReleaseReviewReady=true
formalTradingReleaseReady=false
releaseApprovalStatus=pending_human_approval
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 已实现工程能力

| 阶段 | 实现结果 | 当前业务状态 |
| --- | --- | --- |
| FTR-0 | 权威状态、FTR manifest、JSON Schema、语义/负例校验 | 完成 |
| FTR-1 | Tushare 正式授权元数据、字段证据、新鲜度、候选级快照、追加式授权哈希链 | 缺真实授权和凭据，blocked |
| FTR-2 | official/trusted total-return 受控导入、版本/哈希/重放、组合回测 adapter | 尚无已认可并被候选回测使用的正式 benchmark，blocked |
| FTR-3 | 候选 ID/版本/排除原因冻结、精确阈值验证、失败候选不可静默移除 | 当前 0/7 passed，insufficient |
| FTR-4 | JWT + reviewer roster、五角色权限、追加式签核哈希链、artifact 变化失效、Operations 工作台 | 五角色真实签核缺失，blocked |
| FTR-5 | 集中式 paper/sandbox 隔离、真实持仓/订单动作阻断、无生产启用端点 | isolation passed；production disabled |
| FTR-6 | release gate service、标准编号 artifact、manifest/hash/HTML/SUMMARY 评审包、受保护 API | review package ready；人工 release decision pending |

## 下一步人工/外部动作

1. 数据负责人配置 `FAMS_TUSHARE_TOKEN`，并通过受保护 API 追加正式 provider 授权记录。
2. 数据负责人导入获得授权认可的 official/trusted total-return benchmark，并在 release candidate 回测中使用其版本化 ID。
3. 模型负责人补足正式有效路径、OOS、walk-forward、参数敏感性和分组稳定性证据，使全部冻结候选通过。
4. 数据、模型、风控、合规、final release 五角色分别对同一 manifest hash 签核。
5. 独立人工审批决定是否启动新的生产适配器项目；本阶段不提供启用端点。
