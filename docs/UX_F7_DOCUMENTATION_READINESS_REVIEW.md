# UX-F7 文档就绪度复核与后续开发验收大纲

审查日期：2026-07-07

## 1. 复核结论

```text
stage=UX-F7 文档审查
documentationOnlyStage=true
businessCodeChangeAllowed=false
prdReviewed=true
targetArchitectureReviewed=true
drawioReviewed=true
prototypeVisualBaselineReviewed=true
documentationSupportsCurrentStageDevelopment=true
documentationSupportsExitAcceptance=true
docsSupportNextStageAutomation=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate_and_doc_contract
blockingChatGptAuditRequired=false
externalReviewRecommendedAtStageExit=true
canProceedToImplementationAfterHumanApproval=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

当前文档可以完整支撑 UX-F7 后续自动化开发与出门验收。该结论仅表示文档足够进入实现阶段，不表示 UX-F7 已完成，也不表示正式交易可用。实际代码开发仍需人工明确批准。

## 2. 审查范围

本轮审查读取并核对以下文档：

| 文件 | 审查重点 | 结论 |
| --- | --- | --- |
| `docs/fams_analysis_advice_core_docs/01_PRD_FAMS_Analysis_Advice_Core.md` | FIVD-R 统一入口、结构化输出、证据 gate、禁止正式交易动作 | UX-F7 不冲突 |
| `docs/DIVIDEND_LOW_VOL_PRD.md` | 红利低波研究策略、普通模式/专业模式、ChatBox 入口、禁止正式交易 | UX-F7 延续该边界 |
| `docs/TARGET_ARCHITECTURE_GAP.md` | 目标架构、实体状态、ChatBox 双轨、UX-F7 视觉与资产 Excel 目标 | 支撑开发 |
| `docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md` | UX-F0 到 UX-F7 开发目标、用户路径、验收标准 | 支撑开发 |
| `docs/STAGE_AUTOMATION_EXECUTION_PLAN.md` | 自动化开发顺序、质量门、失败打回规则 | 支撑开发 |
| `docs/UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md` | UX-F7 四类问题、开发大纲、审计产物 | 支撑开发 |
| `docs/UX_F7_RISK_CLOSURE_REVIEW.md` | 风险闭环、前序问题是否落盘、是否需要继续文档修订 | 支撑开发 |
| `docs/target-architecture-gap.drawio` | 8 页中文架构图、实体关系、出门条件、硬边界 | 支撑开发 |
| `docs/read-drawio-output.txt` | drawio 文本解析，便于审计节点和边 | 支撑开发 |
| `docs/drawio-summary.txt` | drawio 摘要、关键实体绑定、出门条件 | 支撑开发 |

## 3. 多轮独立文档审计

### 第一轮：PRD 一致性

结论：通过。

PRD 要求：

- 普通用户能看懂当前结论、原因、可信度和下一步。
- 专业用户仍能展开完整指标、证据、validation 和审计 artifact。
- ChatBox 可以作为自然语言入口，但不能绕过 Operation、audit artifact 或 trade gate。
- 未通过 validation 和人工 gate 前禁止 `ADD / REDUCE / AUTO_TRADE`。

UX-F7 文档与上述要求一致。UX-F7 只解决视觉质感、卡片反馈、Dashboard 密度、资产 Excel 本地账本和目标截图对照，不改变策略计算或交易 gate。

### 第二轮：目标架构一致性

结论：通过。

`TARGET_ARCHITECTURE_GAP.md` 与 drawio 均明确：

```text
普通用户默认路径 = ChatBox + 普通用户工作台
资深用户深度路径 = 左侧菜单 + 多 Tab / 多模块专家页面
ChatBox 是第一入口，但不是唯一入口
专家模块页继续保留
```

drawio 第 2 页已从摘要式关系重排为四层架构映射：

```text
存量前端入口
  -> 存量 API / 服务 / 数据证据
  -> UX-F7 改造层
  -> 目标体验与验收产物
```

这足以让开发者看清存量实体如何复用、修改或补齐到目标架构。

### 第三轮：实现可执行性

结论：通过。

开发计划已经拆到具体实体：

- `index.css`
- `Dashboard.tsx`
- `Assets.tsx`
- `FamsChatBox.tsx`
- `Backtest.tsx`
- `DividendLowVol.tsx`
- `Operations.tsx`
- `AppLayout.tsx`
- `backend/src/routes/asset.ts`
- `backend/src/routes/template.ts`
- `GET /api/v1/assets/export?userId=default`
- `frontend_visual_system_audit.json`
- `asset_excel_flow_audit.json`
- `dashboard_visual_density_audit.json`
- `trade_boundary_wording_audit.json`

开发目标不是抽象愿景，已经可转成任务、代码变更、测试和验收报告。

### 第四轮：出门验收可复现性

结论：通过。

出门验收要求同时包含：

- 1440 / 768 / 390 截图。
- v3 目标页面 PNG 对照。
- 专项审计 JSON。
- `acceptance-report.html`。
- `SUMMARY_FOR_GPT.md`。
- PRD 规格检视。
- 交易边界文案审计。

这足以防止“只换颜色”“只做流程图”“隐藏数据缺口”或“误删专家页”的虚假验收。

### 第五轮：交易边界与过度承诺风险

结论：通过，但需要阶段退出时继续复核。

所有核心文档都保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
prohibitedActions includes ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

文档中允许出现高风险词，但只能出现在“禁止出现 / hard fail / 不得声明 / 阻断解释”的上下文中。后续 `trade_boundary_wording_audit.json` 必须做上下文审计，不能只做简单 grep。

## 4. 当前文档能否完整支撑本阶段开发

结论：能。

UX-F7 开发结束后，若实现和验收均通过，可以声明：

```text
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
expertModuleTabsPreserved=true
targetVisualMockupMatched=true
ordinaryUserExperienceImprovedForUxF7=true
frontendVisualQualityReadyForCurrentStage=true
```

仍不能声明：

- 正式交易已经解锁。
- 自动交易已经解锁。
- 系统可以创建订单。
- 订单创建已经允许。
- 当前阶段已经达到正式交易 release。
- ChatBox 可以执行交易。
- 官方 benchmark 已认证。
- formal validation 已通过。

## 5. 剩余开发计划大纲

### UX-F7.1 视觉系统基础

开发范围：

- 建立 light-first 视觉 token。
- 收敛背景、表面、边框、文字、状态色、图标色、阴影、间距。
- 核心页面共用卡片、按钮、标签、表格和 DataHealthNotice 样式。

验收标准：

```text
visualStyleUnified=true
corePagesUseSharedSurfaceToken=true
hardcodedColorBlocksDecreased=true
statusColorCountControlled=true
wcagAaContrastSpotCheckPassed=true
```

### UX-F7.2 卡片力感与可访问状态

开发范围：

- 可点击卡片补齐 default / hover / active pressed / focus-visible / disabled / loading / empty 状态。
- pressed 使用轻位移、阴影压低和边框强调。
- 移动端触摸反馈可见。

验收标准：

```text
cardPressFeedbackReady=true
clickableCardsHaveFocusVisible=true
touchFeedbackVisibleOnMobile=true
buttonTextOverflowFound=false
prefersReducedMotionRespected=true
```

### UX-F7.3 Dashboard 图标与信息密度

开发范围：

- 使用 `@ant-design/icons` 免费图标。
- 减少无意义空白。
- 无资产空状态引导下载模板、导入资产、询问 ChatBox。

验收标准：

```text
dashboardIconAndDensityReady=true
dashboardCoreCardsHaveSemanticIcons=true
dashboardWhitespaceReduced=true
dashboardEmptyStatePointsToAssetImport=true
desktopTabletMobileScreenshotsPassed=true
```

### UX-F7.4 资产 Excel 本地账本闭环

开发范围：

- 保留模板下载、上传解析、确认导入。
- 补齐导出当前资产。
- 导出工作簿至少包含“当前持仓 / 交易记录 / 字段说明”。
- Excel 导入导出只维护本地资产账本。

验收标准：

```text
assetExcelImportExportReady=true
assetTemplateDownloadPassed=true
assetUploadPreviewPassed=true
assetImportValidationErrorReadable=true
assetImportConfirmPassed=true
assetExportWorkbookSheets=current_positions/trade_records/field_guide
assetImportDoesNotCreateOrder=true
```

### UX-F7.5 专家页目标展示与双轨保留

开发范围：

- 优化 Backtest、DividendLowVol、Operations 的普通摘要与专家详情分层。
- 保留 Assets、Backtest、DividendLowVol、Operations、Analysis 专家入口。
- 提供专家页反向 ChatBox 解释入口。

验收标准：

```text
expertModuleTabsPreserved=true
dividendLowVolPageStillAvailable=true
backtestPageStillAvailable=true
operationsPageStillAvailable=true
analysisPageStillAvailable=true
expertPageToChatExplainPathPassed=true
```

### UX-F7.6 截图、审计与出门报告

开发范围：

- 生成专项审计 JSON。
- 生成 1440 / 768 / 390 截图。
- 生成 HTML 验收报告。
- 对照 v3 目标图。

验收标准：

```text
frontend_visual_system_audit.generated=true
asset_excel_flow_audit.generated=true
dashboard_visual_density_audit.generated=true
trade_boundary_wording_audit.generated=true
acceptanceReportGenerated=true
targetVisualMockupMatched=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 6. 待验收审查结论

进入代码实现后，每个子阶段需要复核以下结论：

1. 实现是否严格基于 v3 目标图，而不是只换颜色。
2. Dashboard 是否真正降低空白、增加图标、改善空状态。
3. Assets 是否形成 Excel 导入导出闭环。
4. ChatBox 是否仍是普通用户入口，但没有替代专家页。
5. 专家页是否保留完整筛选、参数、表格、证据和 artifact。
6. 数据缺口、provider 缺口、validation blocker 是否仍可见。
7. 所有交易相关状态是否仍 locked。
8. E2E 报告是否包含截图证据、PRD 对照和失败打回规则。

## 7. 是否需要 ChatGPT 审计

判断：不需要继续阻断在 ChatGPT 文档审计上；可以在人工批准后进入代码实现。

但建议保留阶段退出审计：

```text
blockingChatGptAuditRequired=false
externalReviewRecommendedAtStageExit=true
```

原因：

- 文档本身已经足够支撑开发。
- 代码实现阶段仍可能出现视觉只换色、专家页弱化、Excel 路径不闭环或交易文案误导。
- 阶段退出时应提交审计包和 E2E HTML 报告供人工或 ChatGPT 复核。

## 8. 建议提交给 ChatGPT / 人工审计的文件

如需外部审计，建议只提交以下文件，数量少于 20：

```text
docs/UX_F7_DOCUMENTATION_READINESS_REVIEW.md
docs/UX_F7_RISK_CLOSURE_REVIEW.md
docs/UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/STAGE_AUTOMATION_EXECUTION_PLAN.md
docs/drawio-summary.txt
docs/read-drawio-output.txt
docs/target-architecture-gap.drawio
docs/prototypes/ux-f7-prototype-review.html
docs/prototypes/ux-f7-assets/v3/visual-mockup-manifest.json
docs/DIVIDEND_LOW_VOL_PRD.md
docs/fams_analysis_advice_core_docs/01_PRD_FAMS_Analysis_Advice_Core.md
```

## 9. 最终结论

```text
docAuditResult=pass
canStopDocumentRevision=true
canProceedToImplementationAfterHumanApproval=true
mustNotProceedWithoutHumanApproval=true
```

当前文档已经可以指导 UX-F7 自动化开发，并能支撑开发结束后的出门验收。若后续人工仍认为 drawio 或原型图偏离目标体验，应只回到文档和原型修订，不应在未批准前进入产品代码开发。
