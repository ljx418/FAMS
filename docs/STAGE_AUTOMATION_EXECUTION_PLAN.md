# 本阶段自动化开发执行计划

生成日期：2026-07-03

## 阶段目标

完成已经被 PRD、目标架构和 UX/ChatBox 文档完整支撑的自动化开发项：

1. UX 出门证据闭环。
2. ChatBox/AgentCore 会话审计、确认卡、任务联动和交易阻断。
3. ChatBox 对话体验深度优化：任务式入口、普通话结果、数据健康提示、移动端可读性。
4. 双轨体验架构：普通用户优先使用 ChatBox + 工作台，资深用户保留多 Tab / 多模块深度入口。
5. 阶段性 E2E 验收报告、PRD 规格检视和审计包归档。

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
- 出现 `formalTradingUnlocked=true`、`autoTradeUnlocked=true`、`canCreateOrder=true`、`orderCreateAllowed=true` 等正向放行状态。

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

最小 E2E 用户路径：

1. 普通用户打开系统，先看到 ChatBox 和普通用户工作台，而不是被迫理解复杂模块。
2. 用户在 ChatBox 中发起组合对比，结果进入工作台，工作台展示摘要、图表、数据可信和下一步。
3. 用户从工作台进入 Backtest 专家页，继续查看完整指标、参数和 artifactRefs。
4. 用户在专家页点击“用 ChatBox 解释当前结果”，ChatBox 用普通话解释当前页面状态和阻断原因。
5. 资深用户仍可绕过 ChatBox，直接通过左侧菜单进入红利低波、回测、任务和审计模块。
6. 视觉截图证明页面使用统一设计 token、低噪音状态色、足够留白、无文字溢出；不得只换颜色但保留原有认知负担。

## 失败处理

若任何验收失败：

1. 不进入下一子阶段。
2. 先记录失败命令、失败原因和是否属于规格偏差。
3. 若失败来自真实数据或授权缺口，写入 blocker，不伪造通过。
4. 若失败来自 UI/接口/测试实现，修复后重新验收。
