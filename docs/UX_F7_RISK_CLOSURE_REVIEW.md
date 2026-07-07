# UX-F7 风险闭环审查

审查日期：2026-07-07

## 结论

```text
stage=UX-F7 文档开发与风险闭环
documentationOnlyStage=true
businessCodeChangeAllowed=false
documentationProblemsFromPreviousReviewResolved=true
documentationFullyPersistedToMarkdownAndDrawio=true
documentationSupportsNextImplementationStage=true
documentationSupportsExitAcceptance=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate_and_doc_contract
canProceedToImplementationAfterHumanApproval=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

当前文档已经能支撑下一阶段 UX-F7 自动化开发，但当前阶段仍然只是文档开发和风险闭环，不代表 UX-F7 代码已经完成，也不代表正式交易可用。进入实际代码开发前仍需要人工明确批准。

## 1. 前序问题是否已闭环

| 前序问题 | 当前闭环方式 | 证据文件 | 状态 |
| --- | --- | --- | --- |
| 页面色块不均，视觉体系不统一 | 规定 light-first token、统一表面、边框、状态色、图标色、阴影、间距；要求核心页面共用视觉基线 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md`、`target-architecture-gap.drawio` 第 3 页 | 已闭环为开发目标与验收门槛 |
| 卡片缺少力感按压反馈 | 规定 default、hover、active pressed、focus-visible、disabled、loading、empty 状态；pressed 使用轻位移、阴影压低和边框强调 | `UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md`、`drawio-summary.txt`、`read-drawio-output.txt` | 已闭环为组件验收 |
| 资产管理缺少本地数据入口 | 规定 Excel 模板下载、上传解析、预览校验、确认导入、Dashboard 刷新、导出当前资产；明确导出接口和工作簿结构 | `UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md`、`target-architecture-gap.drawio` 第 5 页 | 已闭环为功能开发目标 |
| Dashboard 空白过多且缺少图标 | 规定 `@ant-design/icons` 免费图标、紧凑卡片、空状态引导和密度审计 | `UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md`、`target-architecture-gap.drawio` 第 2/3/7 页 | 已闭环为视觉与 E2E 验收 |
| 原型图像过于流程化，缺少目标页面样式 | v3 PNG 作为目标展示形态，v2 SVG 仅作为结构说明；后续实现必须截图对照 v3 PNG | `docs/prototypes/ux-f7-prototype-review.html`、`docs/prototypes/ux-f7-assets/v3/*.png`、`TARGET_ARCHITECTURE_GAP.md` | 已闭环为目标视觉基线 |
| ChatBox 是否替代专家多 Tab 不清楚 | 明确 ChatBox 是第一入口，不替代 `Assets / Backtest / DividendLowVol / Operations / Analysis` 专家页 | `TARGET_ARCHITECTURE_GAP.md`、`target-architecture-gap.drawio` 第 4 页 | 已闭环 |
| UX 优化是否误释放交易动作 | 写死 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`，并要求交易边界文案审计 | `UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md`、`STAGE_AUTOMATION_EXECUTION_PLAN.md`、`target-architecture-gap.drawio` 第 8 页 | 已闭环为硬边界 |

## 2. 是否已落盘到 Markdown 和 drawio

| 文件 | 用途 | 当前状态 |
| --- | --- | --- |
| `docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md` | UX-F0 到 UX-F7 总体目标、用户路径、普通话结果层级、数据健康、交易边界 | 已更新 |
| `docs/TARGET_ARCHITECTURE_GAP.md` | 目标架构、当前架构差异、实体状态、目标展示形态引用 | 已更新 |
| `docs/STAGE_AUTOMATION_EXECUTION_PLAN.md` | 后续实现顺序、每阶段验收标准、失败打回规则 | 已更新 |
| `docs/UX_F7_VISUAL_ASSET_EXCEL_DOC_AUDIT.md` | UX-F7 视觉质感、卡片反馈、Excel、本地账本和 Dashboard 图标密度专项审计 | 已新增 |
| `docs/UX_F7_DOCUMENTATION_READINESS_REVIEW.md` | PRD、目标架构、drawio、执行计划和风险闭环的最终文档就绪度复核 | 已新增 |
| `docs/target-architecture-gap.drawio` | 8 页中文架构图，表达目标体验、实体状态、开发计划、验收门槛、硬边界 | 已重建 |
| `docs/read-drawio-output.txt` | drawio 解析输出，便于文本审计页数、节点和边 | 已生成 |
| `docs/drawio-summary.txt` | drawio 摘要、实体索引、出门条件和禁止事项 | 已更新 |
| `docs/prototypes/ux-f7-prototype-review.html` | 目标页面样式和用户路径审查入口 | 已存在 |
| `docs/prototypes/ux-f7-assets/v3/*.png` | Dashboard、ChatBox、资产 Excel、回测、红利低波、任务、移动端、组件样式板目标截图 | 已存在 |

判断：当前文档不是只存在于对话框，已经落盘到 Markdown、drawio、drawio 解析输出和原型审查页。

补充审查 2026-07-07：`target-architecture-gap.drawio` 第 2 页已经从“当前基础 -> 修改目标 -> 新增能力 -> 目标架构”的单链路摘要，重排为四层架构映射：

```text
存量前端入口
  -> 存量 API / 服务 / 数据证据
  -> UX-F7 改造层
  -> 目标体验与验收产物
```

该页现在明确展示存量 `AppLayout.tsx / Dashboard.tsx / FamsChatBox.tsx / Assets.tsx / Backtest.tsx / DividendLowVol.tsx / Operations.tsx / Analysis.tsx` 与目标 `UserTaskWorkbench / WelcomeTaskBoard / StructuredResultRenderer / Excel 导出 / ExpertPageChatExplain / 专项审计产物` 的关联关系，并保留交易硬边界对所有目标体验的约束。

## 3. 当前文档能否支撑本阶段后续开发

结论：能支撑，但仅限 UX-F7 范围。

后续代码实现可以按以下顺序推进：

1. 视觉系统基础：统一 `index.css` token、表面、边框、状态色、卡片和按钮状态。
2. Dashboard + ChatBox：按 `dashboard-visual.png` 和 `chatbox-visual.png` 实现任务入口、研究摘要、数据健康和交易边界。
3. 资产 Excel 闭环：补齐模板、上传、预览、确认导入、导出当前资产和工作簿结构。
4. 专家页目标展示：优化 `Backtest / DividendLowVol / Operations` 的普通摘要、专家详情和 ChatBox 解释入口。
5. 移动端与组件样式板：完成 390px Shell、卡片 pressed、focus、disabled、loading、empty 状态。
6. 专项审计：生成 `frontend_visual_system_audit.json`、`asset_excel_flow_audit.json`、`dashboard_visual_density_audit.json`、`trade_boundary_wording_audit.json`。
7. E2E 出门：生成 1440 / 768 / 390 截图、`acceptance-report.html`、`SUMMARY_FOR_GPT.md`，并与 v3 目标图对照。

## 4. 出门验收是否可执行

可执行。UX-F7 出门必须全部满足：

```text
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
expertModuleTabsPreserved=true
targetVisualMockupMatched=true
frontend_visual_system_audit.generated=true
asset_excel_flow_audit.generated=true
dashboard_visual_density_audit.generated=true
trade_boundary_wording_audit.generated=true
desktopTabletMobileScreenshotsPassed=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

失败打回规则：

- 目标页面截图与 `docs/prototypes/ux-f7-assets/v3/*.png` 在信息层级、目标入口、视觉统一性、卡片状态、Excel 路径或交易边界上明显不一致：打回 UX-F7。
- 专家页入口被删除、弱化或被 ChatBox 单入口替代：打回 UX-F7。
- Excel 导入导出未形成“下载模板 -> 上传预览 -> 校验错误 -> 确认导入 -> Dashboard 刷新 -> 导出当前资产”闭环：打回 UX-F7。
- 交易边界文案误导，把草案、quick-run、Excel 导入、观察区间写成下单或正式交易能力：重大规格偏差，暂停下一阶段。
- 真实数据或证据缺口被隐藏：不得声明出门。

## 5. 高风险词上下文审计

文档中允许出现以下词，但只能出现在禁止、阻断、硬边界、审计扫描规则或失败打回规则语境：

```text
formalTradingUnlocked=true
autoTradeUnlocked=true
canCreateOrder=true
orderCreateAllowed=true
ORDER_CREATE allowed
AUTO_TRADE allowed
ChatBox can trade
正式交易可用
可下单
```

当前检索结果中存在这些词的文档位置，主要用于描述“禁止出现 / 如果出现则 hard fail / 不得声明”。这不是交易放行，但后续验收不能只做简单 grep；必须做上下文判断。

后续 `trade_boundary_wording_audit.json` 应区分：

| 类型 | 判定 |
| --- | --- |
| `formalTradingUnlocked=true` 出现在 API 示例、前端状态、ChatBox 回复、验收结论中 | hard fail |
| `formalTradingUnlocked=true` 出现在“禁止出现 / hard fail if found”规则中 | allowed mention |
| “可下单 / 正式交易可用”出现在产品文案、按钮、ChatBox 回复中 | hard fail |
| “不得声明可下单 / 不能解释为正式交易可用” | allowed mention |

## 6. 当前仍不能声明的内容

即使文档审查通过，当前也不能声明：

```text
UX-F7 已代码实现
ChatBox 体验已经最终达标
资产 Excel 导出接口已存在
正式交易可用
正式 ADD / REDUCE 已解锁
ORDER_CREATE 可用
AUTO_TRADE 可用
真实数据和计算准确性已被正式交易级验证
```

## 7. 是否需要继续文档修订

当前不需要继续打回大范围文档修订。已闭环内容足以支撑人工批准后的 UX-F7 自动化开发。

剩余风险都可以通过下一阶段代码实现和验收产物控制：

| 风险 | 等级 | 控制方式 |
| --- | --- | --- |
| 实现只换色，没有达到 v3 目标展示形态 | 高 | 截图对照 v3 PNG；不一致打回 |
| Excel 导出接口或工作簿结构缺失 | 高 | `asset_excel_flow_audit.json` 和 E2E 导出文件检查 |
| ChatBox 弱化专家页 | 高 | `dual_track_ux_audit.json` 检查专家页入口保留 |
| 交易文案误导 | 高 | `trade_boundary_wording_audit.json` hard fail |
| 真实数据缺口被视觉优化掩盖 | 高 | `DataHealthNotice` 和 E2E 报告必须展示缺口，不得隐藏 |

## 8. 最终判断

```text
docRiskClosurePassed=true
drawioAlignedWithDocs=true
markdownAlignedWithDrawio=true
prototypeVisualBaselineAvailable=true
nextStageCanStartAfterHumanApproval=true
implementationWithoutHumanApproval=false
```

建议：打开 `docs/target-architecture-gap.drawio` 人工检查方向是否有偏移或过度承诺。若人工认可，即可进入 UX-F7 实际代码开发；若不认可，应只修订文档和原型，不进入代码实现。
