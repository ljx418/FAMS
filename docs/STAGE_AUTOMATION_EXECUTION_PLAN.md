# 本阶段自动化开发执行计划

生成日期：2026-07-03

## 阶段目标

完成已经被 PRD、目标架构和 UX/ChatBox 文档完整支撑的自动化开发项：

1. UX 出门证据闭环。
2. ChatBox/AgentCore 会话审计、确认卡、任务联动和交易阻断。
3. ChatBox 对话体验深度优化：任务式入口、普通话结果、数据健康提示、移动端可读性。
4. 双轨体验架构：普通用户优先使用 ChatBox + 工作台，资深用户保留多 Tab / 多模块深度入口。
5. 阶段性 E2E 验收报告、PRD 规格检视和审计包归档。

2026-07-03 UX 检视后，本阶段新增优先目标：

6. 修复移动端侧栏挤压主内容的问题。
7. 建立 light-first、低噪音、通透的视觉系统基线，减少深蓝/深紫监控台观感。
8. 把 ChatBox 从“解释浮层”提升为普通用户默认任务入口。
9. 保留左侧菜单和专家页，但让普通用户不必先理解复杂表格和内部枚举。
10. 将硬编码深色、低对比度、小按钮、文字溢出和移动端截图作为自动化验收指标。

本阶段不是正式交易 release。必须保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
blockingChatGptDocAuditRequired=false
external_review_required_before_each_stage_exit=true
```

解释：`blockingChatGptDocAuditRequired=false` 只表示“当前文档阶段不再因为等待外部 / ChatGPT 审计而阻断代码实现”。它不表示子阶段可以跳过审计。S2.5、S2.6、S3、S4 退出时仍必须生成审计包、执行 E2E、复核 PRD 规格和交易边界；必要时可将审计包提交外部 / ChatGPT 复核。

## 阶段质量门

每个子阶段进入下一个子阶段前必须满足：

```text
subStageExitRequiresAuditPackage=true
subStageExitRequiresE2E=true
subStageExitRequiresPrdSpecReview=true
subStageExitRequiresTradeBoundaryReview=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

若任一子阶段出现以下情况，不能进入下一阶段：

- ChatBox、工作台或专家页文案把人工计划草案、quick-run、formal-review-ready 解释为可下单或正式交易可用。
- E2E 截图无法证明普通用户路径可理解，或专家模块入口被删除/弱化。
- 审计包缺失 `blockedReasons`、数据可信、PRD 对照或交易边界复核。
- 出现 formalTradingUnlocked、autoTradeUnlocked、canCreateOrder、orderCreateAllowed 任一字段被置为 true 的正向放行状态。

## 子阶段与验收

| 子阶段 | 开发内容 | 出门验收 |
| --- | --- | --- |
| S0 基线审计 | 落盘执行计划与 preflight audit，冻结边界 | 文档明确 dirty worktree、交易锁定、不可自动化项 |
| S1 UX 证据闭环 | 保持普通/专家模式、红利低波、回测、任务中心可读性 | `npm run test:frontend-ux-consistency`、前端 build |
| S2 ChatBox 完整业务入口 v1 | 会话审计、确认卡、operationId、交易阻断、审计 JSON | `npm run test:chat-agent-core` 生成 `chatbox_agentcore_audit.json` |
| S2.5 ChatBox UX 深度优化 | 任务卡欢迎页、普通话回复层级、数据健康提示、消息操作、技术细节折叠 | 生成 `chatbox_ux_optimization_audit.json`，截图覆盖欢迎页、策略对比、数据异常、交易阻断和移动端 |
| S2.6 双轨工作台与视觉系统 | ChatBox + 工作台作为普通用户主路径；多 Tab / 多模块页面作为专家深度入口；建立 light-first、通透、低噪音视觉方向 | 文档和 drawio 证明双轨关系；后续截图覆盖 ChatBox->工作台、工作台->专家页、专家页->ChatBox 解释 |
| S3 E2E 报告 | 生成全系统验收报告，包含截图和 PRD 对照 | `npm run run:full-system-e2e-acceptance-report` |
| S4 最终验证 | 后端 tsc、核心合同测试、前端 build | 所有命令通过；失败则打回对应子阶段 |

## S2.4 UX 基线证据与视觉风险门槛

S2.4 是 S2.5 / S2.6 的前置质量门，目标是把当前“看起来复杂、配色差、移动端拥挤”的主观反馈转成可验收证据。

必须先产出固定尺寸截图，作为后续 UX 优化是否真实改善的对照基线：

```text
desktopViewport=1440px
tabletViewport=768px
mobileViewport=390px
```

必须记录：

```text
mobileSidebarConsumesContentWidth=true/false
hardcodedDarkSurfaceCount
lowContrastSampleCount
smallButtonSampleCount
textOverflowFound=true/false
ordinaryModeRawTechnicalNoiseFound=true/false
chatBoxPrimaryTaskEntryVisible=true/false
expertModuleTabsPreserved=true/false
```

出门验收：

- Dashboard、红利低波、策略回测、任务中心必须各有 1440px、768px、390px 截图。
- 移动端不得将左侧导航常驻显示为主内容同级宽栏。
- 普通模式不得只展示 `validation_evidence`、provider、raw blocker、artifactRefs 或内部状态码。
- 深色硬编码可以作为遗留基线存在，但 UX-F6 完成前必须有收敛计划和审计指标。
- 任何截图或审计若发现专家页入口被删除，应打回，不进入下一阶段。

## 不自动化项

- 正式数据授权接入。
- 官方 total-return benchmark 授权。
- 真实人工签核。
- 正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。
- 自动交易和自动再平衡。

## S2.5 ChatBox UX 深度优化验收细则

S2.5 只优化体验表达，不扩大 ChatBox 工具权限。通过标准：

```text
welcomeTaskCards.length >= 3
assistantPrimaryView.includesConclusion=true
assistantPrimaryView.includesNextAction=true
dataHealthNoticeShownOnToolFailure=true
technicalDetailsCollapsedByDefault=true
desktopAndMobileScreenshotsPassed=true
misleadingTradingCopyFound=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

ChatBox 核心回复不得只做自然语言润色，必须有结构化结果协议。组合回测、红利低波候选、数据异常和交易阻断类回复至少包含：

```json
{
  "answerLevel": "plain_language",
  "summary": "一句话结论",
  "keyNumbers": [],
  "nextActions": [],
  "dataHealth": {},
  "evidenceRefs": [],
  "technicalDetailsCollapsed": true,
  "prohibitedActions": ["ADD", "REDUCE", "ORDER_CREATE", "AUTO_TRADE"]
}
```

`DataHealthNotice` 必须覆盖真实异常和阻断场景：

```text
provider unavailable
SQLite risk / DB health issue
data insufficient
artifact missing
operation failed
validation blocker
```

不得只显示 `HTTP 400`、`HTTP 500`、`Unknown error` 或 raw provider / SQLite 异常。

最小 E2E 用户路径：

1. 打开 ChatBox，看到“今天先看什么 / 对比组合策略 / 分析红利低波 / 解释不能交易 / 查看任务审计”任务卡。
2. 输入“对比永久组合和全天候组合最近三年的收益和最大回撤”，对话框内返回结论、指标卡、收益曲线、回撤曲线、数据可信和下一步。
3. 输入“帮我看红利低波前三只候选”，若数据异常，展示数据健康提示和恢复路径；若数据可用，展示候选结论和观察区间。
4. 输入“为什么不能下单”，明确展示交易锁定和禁止动作。
5. 触发扫描或草案，必须先出现确认卡，未确认不得创建 Operation 或 artifact。

## S2.6 双轨工作台与视觉系统验收细则

S2.6 必须晚于 S2.5。它不替代专家模块页，只定义普通用户和资深用户的入口分层。

通过标准：

```text
dualTrackExperienceReady=true
ordinaryUserWorkbenchReady=true
expertModuleTabsPreserved=true
productVisualRefreshReady=true
chatBoxToWorkbenchPathPassed=true
workbenchToExpertPagePathPassed=true
expertPageToChatExplainPathPassed=true
misleadingTradingCopyFound=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

专家页保留必须单独落审计，不允许只靠人工观察判断。`dual_track_ux_audit.json` 至少包含：

```json
{
  "expertModuleTabsPreserved": true,
  "dividendLowVolPageStillAvailable": true,
  "backtestPageStillAvailable": true,
  "operationsPageStillAvailable": true,
  "analysisPageStillAvailable": true
}
```

最小 E2E 用户路径：

1. 普通用户打开系统，先看到 ChatBox 和普通用户工作台，而不是被迫理解复杂模块。
2. 用户在 ChatBox 中发起组合对比，结果进入工作台，工作台展示摘要、图表、数据可信和下一步。
3. 用户从工作台进入 Backtest 专家页，继续查看完整指标、参数和 artifactRefs。
4. 用户在专家页点击“用 ChatBox 解释当前结果”，ChatBox 用普通话解释当前页面状态和阻断原因。
5. 资深用户仍可绕过 ChatBox，直接通过左侧菜单进入红利低波、回测、任务和审计模块。
6. 视觉截图证明页面使用统一设计 token、低噪音状态色、足够留白、无文字溢出；不得只换颜色但保留原有认知负担。

## UX-F0 到 UX-F6 自动化开发顺序

后续代码开发必须按以下顺序执行，不得先做大范围视觉重构再补 ChatBox 主路径：

1. **UX-F0 基线证据**：生成 `frontend_ux_consistency_audit.json`，记录移动端侧栏、深色硬编码、低对比度、小按钮和文字溢出基线。
2. **UX-F1 ChatBox 任务入口**：实现欢迎任务卡和行动卡，让普通用户不输入也知道先做什么。
3. **UX-F2 普通话结构化回复**：统一结论、关键数字、下一步、数据可信和证据详情，技术细节默认折叠。
4. **UX-F3 数据健康与交易边界**：用用户可读方式解释数据异常、provider 不可用、SQLite 风险、正式交易锁定和禁止动作。
5. **UX-F4 响应式外壳**：移动端折叠导航，主内容完整宽度展示；桌面端保留左侧专家菜单。
6. **UX-F5 双轨工作台**：普通用户路径为 ChatBox + 工作台，资深用户路径为左侧菜单 + 专家页；两条路径可互相跳转解释。
7. **UX-F6 视觉系统收口**：建立 token 化浅色优先视觉系统，统一卡片、按钮、标签、表格和状态色。

每个 UX-F 子阶段都必须落盘：

```text
substage_plan.md
prd_spec_review.json
frontend_ux_consistency_audit.json 或对应专项 audit
1440px/768px/390px screenshot evidence
trade_boundary_wording_audit.json
```

`trade_boundary_wording_audit.json` 必须扫描以下范围：

```text
ChatBox 回复
按钮文案
确认卡
普通用户工作台卡片
专家页入口
审计报告 SUMMARY
E2E HTML 报告
```

若发现人工计划草案、quick-run、formal-review-ready 或 tradeActionReadiness passed 被解释为可下单、正式交易可用或自动交易可用，应按重大规格偏差处理。

若验收失败：

- UI/布局/文案问题：打回当前 UX-F 子阶段修复。
- 真实数据或 provider 问题：记录 blocker，不伪造通过。
- 交易边界误写：视为重大规格偏差，暂停进入下一阶段。

## 失败处理

若任何验收失败：

1. 不进入下一子阶段。
2. 先记录失败命令、失败原因和是否属于规格偏差。
3. 若失败来自真实数据或授权缺口，写入 blocker，不伪造通过。
4. 若失败来自 UI/接口/测试实现，修复后重新验收。
