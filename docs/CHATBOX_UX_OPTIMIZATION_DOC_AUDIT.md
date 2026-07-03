# ChatBox UX 深度优化文档审计

更新时间：2026-07-03

2026-07-03 补充审计：

```text
drawioEntityStatusExplicit=true
implementationEntityStateIndexRequired=true
chatBoxDoesNotReplaceExpertTabs=true
expertModuleTabsPreserved=true
documentationOnlyStage=true
businessCodeChangeAllowed=false
blockingChatGptDocAuditRequired=false
external_review_required_before_each_stage_exit=true
```

本轮只进行文档开发，不进入业务代码实现。已要求 `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、`drawio-summary.txt` 和 `target-architecture-gap.drawio` 显式标注实体状态：

- 已开发基础：现有页面、API、服务、数据和审计产物。
- 开发中 / 需修改：已有入口但普通话结果、数据健康、结构化图表、视觉层级或移动端可读性不足的能力。
- 未开发 / 待新增：下一阶段需要新增的 Chat UX 展示组件、普通用户工作台组件和审计产物。
- 硬边界：正式交易、下单、自动交易和非白名单工具均不得开放。

审计结论：文档可以支撑下一阶段自动化 UX / ChatBox 开发，但不得解释为“原多 Tab 专家模块被裁剪”，也不得解释为正式交易可用。

ChatGPT / 外部审计口径：

```text
不需要继续阻断在文档审计上，可以进入下一阶段代码实现；
但每个子阶段退出时仍必须生成审计包、执行 E2E、复核 PRD 规格和交易边界；
必要时可将子阶段审计包提交外部 / ChatGPT 复核。
```

因此，`blockingChatGptDocAuditRequired=false` 只表示“文档阶段不再因为等待外部审计而阻断”；它不表示后续子阶段可以跳过审计包复核。

## 0. 2026-07-03 文档落盘复核结论

本轮复核目标是确认上一轮提出的问题是否已经完整落盘到相关 `.md` 和 `.drawio` 文件，并判断这些文档能否支撑下一阶段自动化开发。

| 待闭环问题 | 落盘位置 | 当前结论 |
| --- | --- | --- |
| ChatBox 是普通用户第一业务入口，但不能替代专家多 Tab | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、`target-architecture-gap.drawio` 第 1/2/8 页 | 已闭环。文档明确 `ChatBox + 工作台` 是普通用户默认路径，`DividendLowVol / Backtest / Operations / Analysis` 等专家页继续保留。 |
| drawio 必须展示当前架构与目标架构关系，并标注实体状态 | `drawio-summary.txt`、`target-architecture-gap.drawio` 第 2/6/8 页、`read-drawio-output.txt` | 已闭环。图中使用灰/黄/橘/红表示已开发、需修改、待新增和硬边界，并绑定真实代码实体。 |
| 架构图不能只写抽象层，必须写具体代码实体和交互链路 | `TARGET_ARCHITECTURE_GAP.md` 实体状态索引、`read-drawio-output.txt` 第 2/3/8 页 | 已闭环。前端页面、API、服务、数据、审计、Gate、ChatBox 组件均有实体索引和链路说明。 |
| UX 开发计划必须体现完成后的目标体验 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md` UX-1 到 UX-8、`target-architecture-gap.drawio` 第 6/7 页 | 已闭环。每个 UX 项均包含目标、实现实体、用户效果和验收标准。 |
| 验收门槛必须体现用户能体验到的功能和项目能达成的体验 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md` 第 5/6 节、`drawio-summary.txt` 每页验收重点、`read-drawio-output.txt` 第 7 页 | 已闭环。普通用户、专业用户、ChatBox、双轨体验、视觉系统和交易边界均有出门条件。 |
| 不得把 UX 优化、ChatBox 或人工计划草案误写为正式交易可用 | 本文件第 6/7 节、`TARGET_ARCHITECTURE_GAP.md`、`drawio-summary.txt`、`read-drawio-output.txt` | 已闭环。`formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false` 持续作为硬边界。 |

复核结论：

```text
documentationProblemsFromPreviousReviewResolved=true
changesLandedInMarkdownDocs=true
changesLandedInDrawio=true
readDrawioOutputRegenerated=true
docsSupportNextStageAutomation=true
docsSupportExitAcceptance=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate_and_doc_contract
businessCodeChangeAllowed=false
blockingChatGptDocAuditRequired=false
external_review_required_before_each_stage_exit=true
```

限制说明：上述结论只表示文档规格可以支撑后续自动化开发，不表示 UX、ChatBox、双轨工作台或视觉系统已经实现完成。

## 1. 审计结论

```text
chatBoxUxOptimizationDocumented=true
canProceedToChatBoxUxImplementation=true
chatBoxFirstClassFunctionalReady=true
chatBoxFirstClassReady=false
chatBoxExperienceOptimized=false
plainLanguageChatResultReady=false
dataHealthExplanationReady=false
dualTrackExperienceDocumented=true
ordinaryUserWorkbenchReady=false
expertModuleTabsPreserved=true
productVisualRefreshReady=false
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

结论：当前文档已经把 ChatBox UX 深度优化纳入主线开发计划。下一阶段可以优先实现 CB-F / UX-7，但文档阶段不能声明 ChatBox 体验已经优化完成，也不能声明正式交易可用。

2026-07-02 补充结论：用户确认现有多 Tab / 多模块专家系统仍需保留，普通用户优先使用 ChatBox 和对应工作台完成业务交互。因此本轮文档新增 UX-8“双轨体验与视觉系统”目标：ChatBox + 工作台作为普通用户默认路径，专家模块页继续作为资深用户深度入口。UX-8 必须晚于 CB-F / UX-7 实现，不得在 ChatBox 体验仍未优化时提前进入代码阶段。

## 2. 本轮纳入主线的开发目标

CB-F / UX-7 目标是把当前偏技术化的 ChatBox 改成普通用户能理解的第一业务入口：

```text
任务式入口
普通话结果层级
数据健康提示
技术细节默认折叠
消息级操作
桌面与移动端可读性
```

该目标只改变体验表达层，不改变策略计算、数据可信判断、工具权限或交易 gate。

## 3. 已更新文档

| 文档 | 更新内容 | 审计结论 |
| --- | --- | --- |
| `USER_EXPERIENCE_OPTIMIZATION_PLAN.md` | 新增 `UX-7 / CB-F ChatBox 对话体验深度优化`。 | 通过 |
| `CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md` | 拆分 `chatBoxFirstClassFunctionalReady` 与 `chatBoxExperienceOptimized`，新增 CB-F。 | 通过 |
| `CHATBOX_AGENTCORE_INTEGRATION_PLAN.md` | 增加 Chat UX 展示层、普通话结果协议和 CB-F 验收。 | 通过 |
| `CHATBOX_TOOL_COVERAGE_MATRIX.md` | 增加用户体验返回合同和 ChatBox UX 合同测试。 | 通过 |
| `STAGE_AUTOMATION_EXECUTION_PLAN.md` | 新增 S2.5 ChatBox UX 深度优化子阶段，并补充 S2.6 双轨工作台与视觉系统。 | 通过 |
| `TARGET_ARCHITECTURE_GAP.md` | 将 CB-F / UX-7 与 UX-8 写入目标架构、当前差异、审计产物和出门条件。 | 通过 |
| `target-architecture-gap.drawio` | 在 8 页内补充 Chat UX Presentation Layer、CB-F 和双轨体验口径。 | 通过，`read-drawio-output.txt` 已重新生成 |
| `drawio-summary.txt` | 同步 ChatBox UX 主线、双轨 UX 主线和新增状态词。 | 通过 |

## 3.1 外部审计与阶段质量门

当前文档阶段的审计结论是：不需要继续打回文档开发，也不需要把进入代码实现阻断在外部 ChatGPT 审计上。但下一阶段的每个子阶段退出时，仍必须保留审计包复核作为质量门。

执行规则：

```text
blockingChatGptDocAuditRequired=false
external_review_required_before_each_stage_exit=true
subStageExitRequiresAuditPackage=true
subStageExitRequiresE2E=true
subStageExitRequiresPrdSpecReview=true
subStageExitRequiresTradeBoundaryReview=true
```

适用范围：

- CB-F / UX-7 退出时必须复核 ChatBox UX、数据健康、普通话结果、确认卡和交易边界。
- UX-8 退出时必须复核双轨工作台、专家模块保留、视觉系统和三条跳转路径。
- 阶段 E2E 退出时必须复核 HTML 验收报告、截图证据、PRD 对照和禁止动作。

复核结果若发现 `formalTradingUnlocked=true`、`autoTradeUnlocked=true`、`canCreateOrder=true`、`orderCreateAllowed=true`、`ChatBox can trade` 或类似正向放行表述，应直接判定为重大规格偏差。

## 4. 开发及验收大纲

### CB-F-1 任务式入口

开发目标：

- ChatBox 欢迎页显示任务卡，而不是只展示长文本快捷 prompt。
- 任务卡至少覆盖：今天先看什么、对比组合策略、分析红利低波、解释不能交易、查看任务审计。

验收标准：

```text
welcomeTaskCards.length >= 3
welcomeTaskCards include portfolio compare / dividend low vol / trade blocker
researchOnlyBoundaryVisible=true
```

### CB-F-2 普通话结果层级

开发目标：

- 助手回复按“结论 / 关键数字 / 下一步 / 数据可信 / 证据详情”展示。
- 技术字段默认折叠。

验收标准：

```text
assistantPrimaryView.includesConclusion=true
assistantPrimaryView.includesNextAction=true
assistantPrimaryView.rawTechnicalOnly=false
technicalDetailsCollapsedByDefault=true
```

### CB-F-3 数据健康提示

开发目标：

- 数据异常、SQLite 损坏、provider 不可用、价格过期、数据不足时显示用户可读解释。
- 不把 HTTP 状态码或原始异常作为唯一提示。

验收标准：

```text
dataHealthNoticeShownOnToolFailure=true
rawHttpErrorOnly=false
safeRecoveryActionsVisible=true
```

### CB-F-4 确认卡与交易边界

开发目标：

- 扫描、刷新、持久化回测、人工计划草案继续二次确认。
- 正式交易动作继续阻断。

验收标准：

```text
sideEffectRequiresConfirmation=true
unconfirmedOperationCreated=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
misleadingTradingCopyFound=false
```

### CB-F-5 可视化与移动端验收

开发目标：

- 对桌面和移动端 ChatBox 做截图验收。
- 覆盖欢迎页、策略对比、数据异常、交易阻断。

验收标准：

```text
desktopScreenshotPassed=true
mobileScreenshotPassed=true
chartNotClipped=true
buttonTextNotOverflow=true
```

### UX-8-1 双轨入口与普通用户工作台

开发目标：

- ChatBox 和工作台作为普通用户默认主路径。
- 左侧菜单和多模块页面保留为专家深度入口。
- ChatBox 结果优先落到工作台摘要，用户选择查看完整证据时再进入专家模块页。

验收标准：

```text
chatBoxToWorkbenchPathPassed=true
workbenchToExpertPagePathPassed=true
expertPageToChatExplainPathPassed=true
expertModuleTabsPreserved=true
ordinaryUserCanCompleteMainFlowWithoutExpertPage=true
```

### UX-8-2 视觉系统与通透感

开发目标：

- 建立 light-first、低噪音、通透、专业财富管理工作台视觉方向。
- 统一设计 token、状态色、间距、字体层级、图表色和可访问性标准。
- 专家模块可保持高信息密度，但必须遵守同一视觉系统。

验收标准：

```text
productVisualRefreshReady=true
dominantDeepPurpleBlueThemeRemoved=true
semanticStatusColorCountControlled=true
textOverflowFound=false
wcagAaContrastSpotCheckPassed=true
```

## 5. 待生成的代码阶段审计产物

后续实现完成后必须生成：

```text
chatbox_ux_optimization_audit.json
chatbox_plain_language_result_audit.json
chatbox_data_health_ux_audit.json
trade_boundary_wording_audit.json
dual_track_ux_audit.json
product_visual_system_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

## 6. 交易边界复核

本轮文档开发没有释放任何交易动作。

允许：

```text
RESEARCH
OBSERVE
COMPARE
ALERT
PLAN_DRAFT
MANUAL_TRADE_DRAFT
```

禁止：

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
```

任何文档、前端文案、ChatBox 回复或审计报告中，如果把 `manualDraftReady`、`tradeActionReadiness passed`、quick-run、formal-review-ready 或 ChatBox 体验优化解释为“可下单”或“正式交易可用”，都应视为重大规格偏差。

## 7. 出门判断

当前文档阶段可以声明：

```text
chatBoxUxOptimizationDocumented=true
canProceedToChatBoxUxImplementation=true
```

当前仍不能声明：

```text
chatBoxUxOptimized=true
chatBoxFirstClassReady=true
dualTrackExperienceReady=true
ordinaryUserWorkbenchReady=true
productVisualRefreshReady=true
formalTradingReady=true
orderCreateAllowed=true
autoTradeReady=true
```
