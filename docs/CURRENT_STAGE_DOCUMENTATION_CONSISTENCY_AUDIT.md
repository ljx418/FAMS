# 当前阶段文档一致性审计

更新时间：2026-07-09

## 1. 审计结论

```text
documentationConsistencyReady=true
documentationSupportsNextStageDevelopment=true
documentationSupportsControlledNextStageDevelopment=true
documentationSupportsSubstageAcceptance=true
documentationSupportsFormalTradingRelease=false
reviewStatus=PASS_FOR_CONTROLLED_DEVELOPMENT
drawioCurrentTargetRelationReady=true
drawioPageCountLimit=8
uxF7Accepted=true
chatBoxFirstClassReady=true
ordinaryUserExperienceReady=true
assetExcelImportExportReady=true
expertModuleTabsPreserved=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

当前文档可以支撑下一阶段受控自动化开发、分阶段验收和审计驱动实现，但不支撑无人值守全流程自动出门，也不支撑正式交易 release。正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 仍然锁定。

## 2. 本轮审计输入

| 文档 | 审计重点 | 结论 |
| --- | --- | --- |
| `docs/DIVIDEND_LOW_VOL_PRD.md` | 当前有效状态、红利低波边界、ChatBox 同步、正式交易锁定 | 已补 2026-07-09 当前有效状态 |
| `docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md` | UX-F7、ChatBox 体验、双轨工作台、资产 Excel | 已把历史 false 状态改为基线说明 |
| `docs/CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md` | ChatBox 第一入口、结构化结果、数据健康、交易边界 | 已同步当前 ready 状态；SSE streaming 基线已完成，完整多轮 agent loop 仍是增强项 |
| `docs/TARGET_ARCHITECTURE_GAP.md` | 当前/目标架构、实体状态、下一阶段 FTR 缺口 | 已新增 2026-07-09 文档状态收口 |
| `docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md` | 下一阶段子阶段计划、验收标准、审计产物和出门门槛 | 已新增，可支撑后续自动化开发 |
| `docs/target-architecture-gap.drawio` | <=8 页、中文、实体状态、出门条件 | 已同步第 2、7、8 页为当前阶段表达 |
| `docs/drawio-summary.txt` | 人类可读摘要 | 已同步当前阶段表达 |

## 3. 当前有效状态

唯一机器可读状态源：

```text
machineReadableStateSource=docs/current-stage-state.json
```

自动化开发必须优先读取 `docs/current-stage-state.json`。Markdown 中更早日期的 `false`、`pending` 或 `passed` 状态只能作为历史基线，不得覆盖该机器可读状态源。

当前可以声明：

```text
researchWorkflowReady=true
manualTradeDraftReady=true
ordinaryUserExperienceReady=true
frontendComplexityReduced=true
chatBoxFirstClassReady=true
chatBoxExperienceOptimized=true
chatBoxPlainLanguageReady=true
chatBoxDataHealthUxReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
ordinaryUserWorkbenchReady=true
expertModuleTabsPreserved=true
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
fullSystemE2EAcceptance=passed
FAMS_NEXT_STAGE_DOCUMENTATION_STATUS=APPROVED_FOR_CONTROLLED_IMPLEMENTATION
```

当前不能声明：

```text
formalTradingReleaseReady 的 true 状态
formalTradingUnlocked 的 true 状态
autoTradeUnlocked 的 true 状态
canCreateOrder 的 true 状态
orderCreateAllowed 的 true 状态
officialBenchmarkCertified 的 true 状态
formalValidationPassed 的 true 状态
manualSignoffCompleted 的 true 状态
unattendedEndToEndAutomation 的 true 状态
```

## 4. 已闭环问题

1. **ChatBox 去哪里了**：当前文档明确 ChatBox 是普通用户第一入口，但不是唯一入口。
2. **多 Tab 是否被砍掉**：当前文档明确 `DividendLowVol / Backtest / Operations / Analysis / Assets` 等专家页保留。
3. **UX-F7 是否只改色**：当前文档明确包含视觉 token、卡片按压、Dashboard 图标密度、资产 Excel 导入导出和截图验收。
4. **历史 false 状态是否误导后续开发**：当前 PRD、UX、ChatBox 文档已新增当前有效状态，并把旧 false 状态标成历史基线。
5. **正式交易是否被误放行**：所有当前有效状态仍保持 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。

## 5. 下一阶段仍未完成内容

| 编号 | 未完成内容 | 需要实现的实体 | 出门门槛 |
| --- | --- | --- | --- |
| FTR-1 | 正式 provider 与数据治理 | `FormalDataProviderService`、字段级 `sourceProvider / asOfDate / freshness / coverage / crossCheckStatus` | 关键字段不再依赖 research fallback |
| FTR-2 | 官方或可信 total-return benchmark | `BenchmarkQualificationService`、benchmark audit | proxy benchmark 不再被当作 formal |
| FTR-3 | formal validation | `FormalValidationService`、OOS / walk-forward / 参数敏感性 / 分组稳定性 | 任一 insufficient 不得升级 |
| FTR-4 | 人工签核 | `ManualSignoffService`、manual signoff artifact | 人工未签核时仍 locked |
| FTR-5 | 执行隔离 | paper/sandbox adapter、order isolation audit | 不创建实盘订单 |
| FTR-6 | release gate | `ReleaseGateService`、13-18 审计产物 | release gate 全绿后才可进入正式评审 |
| CBE-1 | ChatBox 多轮 tool-calling 增强 | multi-turn context、连续工具调用、agent loop audit；SSE streaming 基线已通过 | 不影响当前 ChatBox 第一入口和流式响应出门 |
| DATA-1 | 真实用户导入资产样本复跑 | Excel import/export + portfolio summary/backtest；审计用户基线样本已通过 | 每个真实用户导入后重新跑资产和回测验收 |

## 6. 验收命令

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio > docs/read-drawio-output.txt
node -e "const fs=require('fs'); const s=fs.readFileSync('docs/target-architecture-gap.drawio','utf8'); console.log((s.match(/<diagram /g)||[]).length)"
rg -n "formalTradingUnlocked 不得为 true|autoTradeUnlocked 不得为 true|canCreateOrder 不得为 true|orderCreateAllowed 不得为 true|ChatBox 被描述为可交易|ORDER_CREATE 被允许|AUTO_TRADE 被允许" docs
# 命中项必须人工判定上下文：禁止/硬失败规则中的负面示例允许存在；
# API 示例、验收结论、前端文案、ChatBox 回复或 SUMMARY 中的正向放行必须失败。
git diff --check
```

## 7. 人类审计路径

建议人工审计少于 20 个文件：

```text
docs/CURRENT_STAGE_DOCUMENTATION_CONSISTENCY_AUDIT.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
docs/UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md
backend/data/full-system-e2e/latest/acceptance-report.html
```

## 8. 最终判断

```text
pass_current_stage_documentation_consistency_audit=true
canProceedToNextImplementationPlanning=true
externalReviewRequiredBeforeStageExit=true
formalTradingStillLocked=true
```

文档阶段不需要继续打回；后续每个代码子阶段退出时仍必须生成审计包、截图证据、E2E 报告和交易边界复核。

## 9. 2026-07-09 风险闭环复检

复检问题：

```text
previousProblemsFullyResolved=true
changesPersistedToMarkdown=true
changesPersistedToDrawio=true
docsSupportCurrentStageDevelopment=true
docsSupportExitAcceptance=true
highRiskDevelopmentFailureAfterDocs=false
alternativeRouteSelectionRequired=false
formalTradingStillLocked=true
```

复检证据：

```text
drawioPageCount=8
staleCurrentFalseStatusMatches=0
drawioReadOutputRegenerated=true
gitDiffCheckPassed=true
businessCodeChanged=false
```

本轮复检确认：

1. 前序问题已经落盘到 PRD、UX 计划、ChatBox 验收计划、目标架构、drawio、drawio 摘要和本审计文档。
2. 当前 drawio 能表达存量架构、目标架构、实体状态、开发及验收计划、里程碑、出门条件和硬边界。
3. 当前文档可以支撑下一阶段自动化开发计划制定与代码实现，但只能支撑文档中明确列出的范围。
4. 当前文档不能支撑正式交易 release；正式数据源、官方 benchmark、formal validation、人工签核、release gate 仍是后续阶段。
5. 当前没有需要用户选择的技术路线分叉；推荐路线是继续按 FTR-1 到 FTR-6 与 ChatBox 增强拆解推进。
6. 下一阶段详细开发及验收计划已经落盘到 `docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md`，包括 S0-S8 子阶段、每阶段实现实体、验收标准、打回条件和审计产物。

复检验收命令：

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio > docs/read-drawio-output.txt
node -e "const fs=require('fs'); const s=fs.readFileSync('docs/target-architecture-gap.drawio','utf8'); console.log((s.match(/<diagram /g)||[]).length)"
rg -n "chatBoxFirstClassReady=false|chatBoxExperienceOptimized=false|chatBoxPlainLanguageReady=false|chatBoxDataHealthUxReady=false|fullBusinessToolCoverageReady=false|inlineChartResultReady=false|ordinaryUserWorkbenchReady=false|ordinaryUserExperienceReady=false|frontendComplexityReduced=false" docs/DIVIDEND_LOW_VOL_PRD.md docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md docs/CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md docs/TARGET_ARCHITECTURE_GAP.md
git diff --check
```

风险结论：

```text
canEnterImplementationAfterHumanApproval=true
mustNotEnterImplementationBeforeHumanApproval=true
```

当前仍处于风险闭环 / 文档审查阶段。在用户明确批准前，不应进入实际代码开发。

## 2026-07-14 文档开发阶段：架构风险闭环与 drawio 重构

更新时间：2026-07-14 15:24:06+08:00

本轮仍处于文档开发阶段，不进入业务代码实现。目标是把当前已认可的开发主线固化为可审查、可执行、可验收的架构文档，避免 drawio 相比前序文档出现信息退化。

### 当前文档修订目标

```text
documentationOnlyStage=true
businessCodeChangeAllowed=false
drawioPageCountLimit=8
drawioCurrentTargetRelationReady=true
implementationEntityStateIndexReady=true
nextStagePlanActionable=true
prdSpecDeviation=none
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### drawio 第 2 页重构要求

`docs/target-architecture-gap.drawio` 的「当前架构与目标架构差异」页必须采用四列映射，而不是抽象流程图：

| 列 | 必须回答的问题 | 示例实体 |
| --- | --- | --- |
| 当前存量实体 | 当前项目已经有哪些可复用代码、页面、服务、数据或审计产物 | `Dashboard.tsx`、`Assets.tsx`、`FamsChatBox.tsx`、`Backtest.tsx`、`DividendLowVol.tsx`、`chat.ts`、`asset.ts`、`portfolioBacktest.ts` |
| 当前风险 | 为什么当前实现还不能支撑正式交易前置出门 | 市场数据新鲜度 unknown、proxy benchmark、formal validation 不足、普通用户路径复杂、状态词漂移 |
| 目标架构实体 | 下一阶段需要新增或强化的明确代码实体 | `FormalDataProviderService`、`ProviderFreshnessService`、`BenchmarkQualificationService`、`FormalValidationService`、`ManualSignoffService`、`ExecutionIsolationService`、`ReleaseGateService` |
| 验收证据 | 开发完成后如何证明没有规格偏移和虚假验收 | `15_data_governance_audit.json`、`16_benchmark_qualification_audit.json`、`17_formal_validation_audit.json`、`18_manual_signoff_audit.json`、`acceptance-report.html` |

### 不允许出现的文档退化

以下任一情况出现，则不得声明文档阶段出门：

```text
无法从 drawio 判断当前架构与目标架构关系
无法从文档判断 PRD 规格偏移风险
无法从验收章节判断用户如何操作、如何验收、失败如何打回
待开发项被写成已完成
专家多 Tab 被删除或弱化
真实数据缺口、benchmark 缺口、formal validation 缺口被 UX 文案隐藏
出现 formalTradingUnlocked 不得为 true / autoTradeUnlocked 不得为 true / canCreateOrder 不得为 true / orderCreateAllowed 不得为 true
```

### 下一阶段开发仍未完成的明确范围

当前阶段完成后只能说明文档可以支撑下一阶段开发，不能说明正式交易可用。仍未完成：

```text
S2 正式 provider 与字段级数据治理
S3 官方或可信 total-return benchmark
S4 formal validation 与模型有效性验证
S5 人工签核与 release blocker
S6 执行隔离与订单防线
S7 release gate 总验收
S8 完整多轮 tool-calling Agent loop 增强
```

## 2026-07-14 风险闭环复核结论

本轮复核对象：

```text
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
docs/TARGET_ARCHITECTURE_GAP.md
docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/DIVIDEND_LOW_VOL_PRD.md
```

复核结论：

```text
documentationRiskClosureReady=true
drawioNextStageGoalReadable=true
drawioCurrentTargetRelationReady=true
drawioPageCount=8
drawioPageLimitPassed=true
noThreeNoAcceptance=true
nextStagePlanActionable=true
prdSpecDeviation=none_found_in_document_review
majorOverPromiseRisk=controlled_by_trade_gate_and_release_gate_wording
fatalDocumentationGap=none_found
businessCodeChangeAllowed=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

本轮已经解决的上一轮问题：

| 问题 | 当前处理 |
| --- | --- |
| 看不懂下一阶段目标 | drawio 第 1 页已改为“从研究级可用推进到正式交易前置评审 ready”的路线图。 |
| 当前架构与目标架构关系不清 | drawio 第 2 页已按“当前基础 -> 当前风险 -> 目标能力 -> 验收结果”重构。 |
| 验收章节可能三无 | drawio 第 6 页和第 7 页已列出用户场景、操作路径、验收结果、审计产物和打回规则。 |
| 待开发项可能被误写成已完成 | drawio 第 1、2、7、8 页均明确 S2-S8 仍是下一阶段待开发或增强项。 |
| 正式交易边界可能被 UX 或 ChatBox 弱化 | drawio 第 5、8 页和当前审计继续锁定四个交易字段，并禁止正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE。 |

当前文档可以支撑的开发范围：

```text
S0 文档基线复核
S1 真实资产样本复验
S2 数据可信与字段级治理
S3 benchmark 资格与 total-return 回测可信
S4 formal validation 与模型有效性验证
S5 人工签核与 release blocker
S6 执行隔离与订单防线
S7 release gate 总验收
S8 ChatBox 多轮 tool-calling 增强
```

当前文档不能支撑的范围：

```text
正式交易 release 自动通过
正式 ADD / REDUCE 放行
ORDER_CREATE 放行
AUTO_TRADE 放行
把免费源或 proxy benchmark 包装成 formal
把 validation insufficient 写成策略可交易
```

剩余风险判断：

| 风险 | 等级 | 当前处置 | 是否阻断进入代码开发 |
| --- | --- | --- | --- |
| 正式 provider 授权与数据许可仍未确定 | 中 | 下一阶段 S2 以 providerMode 分层处理，formal 缺失时保持 research_fallback / unavailable | 不阻断文档出门，阻断 formal release |
| 官方 benchmark 可能仍不可获得 | 中 | 下一阶段 S3 允许 trusted/proxy 分层，但 proxy 必须 insufficient | 不阻断文档出门，阻断 formal validation passed |
| 长周期真实数据 validation 可能不达标 | 高 | 下一阶段 S4 必须输出失败 taxonomy，不允许升级交易 | 不阻断文档出门，阻断 formal trading |
| ChatBox 多轮 tool-calling 可能产生权限漂移 | 中 | 下一阶段 S8 增加 unsafe intent 和 tool progress 验收 | 不阻断文档出门，阻断任何交易动作 |

推荐技术路线：

```text
继续采用“模块化单体 + 审计产物 + release gate”的路线。
不建议此阶段拆微服务；当前主要风险是数据可信和验证口径，不是部署扩展性。
不建议绕过免费源直接承诺正式 provider；应先完成 providerMode / evidenceRefs / freshness 分层。
不建议将 ChatBox 作为唯一入口；继续保持 ChatBox 第一入口 + 专家多 Tab 双轨。
```

人工审核建议：

```text
1. 优先看 drawio 第 1 页，确认下一阶段目标是否符合预期。
2. 再看 drawio 第 2 页，确认当前架构、当前风险、目标能力、验收证据是否能支撑风险判断。
3. 再看 drawio 第 6 页，确认用户路径是否覆盖真实资产、组合对比、红利低波、人工计划草案和审计复核。
4. 最后看 drawio 第 8 页，确认出门条件没有过度承诺正式交易。
```
