# UX-F7 视觉质感与资产 Excel 文档审计

审计日期：2026-07-07

## 结论

```text
documentationSupportsUxF7Development=true
documentationSupportsExitAcceptance=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate_and_doc_contract
documentationOnlyStage=true
businessCodeChangeAllowed=false
visualStyleUnified=false
cardPressFeedbackReady=false
assetExcelImportExportReady=false
dashboardIconAndDensityReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

当前文档已经把人工体验反馈中的四个问题纳入下一阶段自动化开发主线：

1. 前端页面色块不均，需要统一 light-first 视觉 token 和组件基线。
2. 卡片缺少力感按压反馈，需要补齐 hover、active pressed、focus-visible、disabled、loading、empty 状态。
3. 资产管理缺少本地数据入口，需要形成 Excel 模板下载、上传预览、确认导入和导出路径。
4. Dashboard 空白过多且缺少图标，需要用免费开源图标和更紧凑的信息密度改善首屏理解。

本轮只完成文档开发和 UX 检视，没有进入代码实现。下一阶段代码实现前，应以本文件、`USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md` 和 `target-architecture-gap.drawio` 作为规格依据。

## 已核查的现有实现基础

```text
frontend/src/index.css
frontend/src/pages/Dashboard.tsx
frontend/src/pages/Assets.tsx
backend/src/routes/asset.ts
backend/src/routes/template.ts
frontend package dependency: @ant-design/icons
frontend/backend package dependency: xlsx
```

核查结果：

- `Assets.tsx` 已有模板下载、Excel 解析预览和导入基础入口。
- `backend/src/routes/template.ts` 已提供 `/api/v1/assets/template`。
- `backend/src/routes/asset.ts` 已提供 `/api/v1/assets/parse` 和 `/api/v1/assets/import`。
- 当前未确认存在 `GET /api/v1/assets/export?userId=default`，应作为 UX-F7 待新增能力。
- 默认用户资产数据为空时，Dashboard 和资产页需要更明确的 Excel 导入空状态。
- 当前项目已具备 `@ant-design/icons`，下一阶段应优先复用，不新增商业图标依赖。

## UX-F7 开发及验收大纲

### UX-F7.1 统一视觉 token

开发目标：

- 统一背景、表面、边框、文字、阴影、状态色、图标色、间距和交互色。
- 收敛硬编码深色卡片和局部自定义色块。
- Dashboard、Assets、DividendLowVol、Backtest、Operations、ChatBox 共用视觉基线。

验收标准：

```text
visualStyleUnified=true
hardcodedColorBlocksDecreased=true
corePagesUseSharedSurfaceToken=true
statusColorCountControlled=true
wcagAaContrastSpotCheckPassed=true
```

### UX-F7.2 卡片力感与可访问交互

开发目标：

- 所有可点击卡片具备 default、hover、active pressed、focus-visible、disabled、loading、empty 状态。
- pressed 状态使用轻微位移、阴影压低和边框强调，不使用夸张动效。

验收标准：

```text
cardPressFeedbackReady=true
clickableCardsHaveFocusVisible=true
touchFeedbackVisibleOnMobile=true
buttonTextOverflowFound=false
prefersReducedMotionRespected=true
```

### UX-F7.3 资产 Excel 导入导出

开发目标：

- 保留 `/api/v1/assets/template`、`/api/v1/assets/parse`、`/api/v1/assets/import`。
- 新增或完善 `GET /api/v1/assets/export?userId=default`。
- 导出文件至少包含“当前持仓 / 交易记录 / 字段说明”。
- 页面路径为“下载模板 -> 上传预览 -> 校验错误 -> 确认导入 -> Dashboard 刷新 -> 导出当前资产”。

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

### UX-F7.4 Dashboard 图标与密度

开发目标：

- 使用 `@ant-design/icons` 为资产、收益、风险、任务、回测、红利低波和交易锁定卡片增加语义图标。
- 建立 12/16/24px 间距层级，减少无意义空白。
- 默认用户无资产时，首屏引导“下载模板 / 导入资产 / 询问 ChatBox”。

验收标准：

```text
dashboardIconAndDensityReady=true
dashboardCoreCardsHaveSemanticIcons=true
dashboardEmptyStatePointsToAssetImport=true
dashboardWhitespaceReduced=true
desktopTabletMobileScreenshotsPassed=true
```

## 必须生成的审计产物

下一阶段实现完成后必须生成：

```text
frontend_visual_system_audit.json
asset_excel_flow_audit.json
dashboard_visual_density_audit.json
trade_boundary_wording_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

## 交易边界

UX-F7 不允许改变任何交易边界：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

Excel 导入、资产导出、Dashboard 卡片操作、ChatBox 入口和专家页入口都只能用于本地账本维护、研究展示和人工复核，不得被写成交易动作、订单创建或自动再平衡。

## 文档路径

本阶段审计相关文档：

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
docs/UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md
docs/UX_F7_RISK_CLOSURE_REVIEW.md
```

## 最终判断

当前文档已经完整支撑 UX-F7 下一阶段自动化开发。可以在人工批准后进入代码实现阶段，但不能声明 UX-F7 已经实现，也不能声明正式交易可用。

风险闭环的最终口径以 `docs/UX_F7_RISK_CLOSURE_REVIEW.md` 为准。若该文件与其他 UX-F7 文档出现冲突，应优先打回文档修订，而不是进入代码实现。

<!-- UX_F7_V3_DOC_START -->
## 2026-07-07 v3 原型审查补充结论

本轮已将 UX-F7 原型从“交互流程图 / 结构说明图”升级为“目标页面展示形态”。新增审查基线：

```text
targetVisualMockupDocumented=true
pageDisplayShapeDocumented=true
moduleVisualDesignDocumented=true
v3TargetVisualPngCount=8
v2StructureSvgRetained=true
prototypeReviewHtmlUpdated=true
businessCodeChangeAllowed=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

v3 目标页面样式图：

- `docs/prototypes/ux-f7-assets/v3/dashboard-visual.png`
- `docs/prototypes/ux-f7-assets/v3/chatbox-visual.png`
- `docs/prototypes/ux-f7-assets/v3/assets-excel-visual.png`
- `docs/prototypes/ux-f7-assets/v3/backtest-visual.png`
- `docs/prototypes/ux-f7-assets/v3/dividend-low-vol-visual.png`
- `docs/prototypes/ux-f7-assets/v3/operations-visual.png`
- `docs/prototypes/ux-f7-assets/v3/mobile-visual.png`
- `docs/prototypes/ux-f7-assets/v3/component-kit-visual.png`

审计判断：当前文档已经能说明目标体验、目标页面展示形态、模块级视觉设计、用户路径和出门验收。下一阶段实现时，v3 PNG 应作为视觉和布局验收基线；如果后续实现只提交流程图式布局、只换颜色、或没有体现卡片反馈、Excel 闭环、Dashboard 图标密度和双轨路径，应判定 UX-F7 未通过。
<!-- UX_F7_V3_DOC_END -->
