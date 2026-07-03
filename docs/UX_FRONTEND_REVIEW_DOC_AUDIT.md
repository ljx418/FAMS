# FAMS 前端 UX / ChatBox 双轨体验文档自审

生成日期：2026-07-03

## 审计结论

```text
documentationSupportsUxNextStageDevelopment=true
documentationSupportsExitAcceptance=true
docsSupportNextStageAutomation=true
drawioPageCount=8
drawioPageLimit=8
drawioPageLimitPassed=true
uxBaselineFindingsDocumented=true
mobileShellFixRequired=true
visualTokenRefreshRequired=true
chatBoxTaskEntryRequired=true
chatBoxDoesNotReplaceExpertTabs=true
expertModuleTabsPreserved=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_trade_gate_and_doc_contract
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

当前文档已经足以支撑下一阶段 UX 自动化开发。下一阶段应按 `UX-F0 -> UX-F6` 顺序推进：先固化截图和可访问性基线，再优化 ChatBox 任务入口、普通话结构化回复、数据健康提示、响应式外壳、双轨工作台和视觉系统。

该结论不表示当前前端体验已经达标，也不表示可以进入正式交易阶段。

更准确的阶段判断是：

```text
canProceedToImplementation=true
chatBoxExperienceOptimized=false
ordinaryUserExperienceReady=false
formalTradingReleaseReady=false
blockingChatGptDocAuditRequired=false
external_review_required_before_each_stage_exit=true
```

解释：当前不需要继续阻断在文档审计上，可以进入下一阶段实现；但每个 UX 子阶段退出时仍必须生成审计包、桌面/平板/移动截图、E2E 报告和交易边界复核。必要时可提交外部 / ChatGPT 复核。

## 已闭环的问题

| 问题 | 文档闭环位置 | 结论 |
| --- | --- | --- |
| 移动端左侧导航挤压主内容 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`STAGE_AUTOMATION_EXECUTION_PLAN.md`、drawio 第 2/6 页 | 已纳入 UX-F4 响应式外壳验收 |
| 深蓝/深紫视觉过重 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、drawio 第 6 页 | 已纳入 UX-F6 视觉 token 收口 |
| 普通模式仍暴露技术术语 | `USER_EXPERIENCE_OPTIMIZATION_PLAN.md`、drawio 第 3/8 页 | 已纳入 UX-F2 普通话结构化回复 |
| ChatBox 主入口不够强 | `STAGE_AUTOMATION_EXECUTION_PLAN.md`、drawio 第 8 页 | 已纳入 UX-F1 和 CB-F |
| 专家页不能被删除 | `TARGET_ARCHITECTURE_GAP.md`、drawio 第 1/2/8 页 | 已明确 ChatBox 不替代专家 Tab |
| UX 简化不能弱化交易边界 | 所有主文档和 drawio 红色硬边界 | 已保持锁定状态 |

## 下一阶段开发验收大纲

1. **UX-F0 基线证据**
   - 生成桌面、平板、移动端截图。
   - 固定截图尺寸：桌面 1440px、平板 768px、移动端 390px。
   - 统计移动端侧栏、硬编码深色、低对比度、小按钮、文字溢出。
   - 输出 `frontend_ux_consistency_audit.json`。

2. **UX-F1 ChatBox 任务入口**
   - 首屏展示至少 3 个任务卡。
   - 普通用户不输入也能看到红利低波、组合回测、任务审计和交易阻断入口。

3. **UX-F2 普通话结构化回复**
   - 回复主视图固定为：结论、关键数字、下一步、数据可信、证据详情。
   - provider、raw blocker、artifactRefs、内部状态码默认折叠。
   - 核心业务回复必须有结构化 payload：`answerLevel / summary / keyNumbers / nextActions / dataHealth / evidenceRefs / technicalDetailsCollapsed / prohibitedActions`。

4. **UX-F3 数据健康与交易边界**
   - 数据异常必须显示用户可读恢复路径。
   - `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false` 必须始终可见。
   - `DataHealthNotice` 必须覆盖 provider unavailable、SQLite risk、data insufficient、artifact missing、operation failed、validation blocker。
   - 不得只显示 HTTP 400、HTTP 500、Unknown error 或 raw provider / SQLite 异常。

5. **UX-F4 响应式外壳**
   - 移动端折叠左侧菜单。
   - Dashboard、红利低波、回测、任务中心在 390px 宽度下主内容完整可读。

6. **UX-F5 双轨工作台**
   - ChatBox 到工作台、工作台到专家页、专家页回到 ChatBox 解释三条路径通过。
   - 左侧菜单和多模块专家页保留。
   - `dual_track_ux_audit.json` 必须证明 `DividendLowVol / Backtest / Operations / Analysis` 专家页仍可访问。

7. **UX-F6 视觉系统收口**
   - 建立 light-first 设计 token。
   - 状态色受控，卡片不嵌套卡片，按钮文本不溢出。

8. **交易边界文案审计**
   - `trade_boundary_wording_audit.json` 必须扫描 ChatBox 回复、按钮文案、确认卡、工作台卡片、专家页入口、审计报告 SUMMARY 和 E2E HTML 报告。
   - 人工计划草案、quick-run、formal-review-ready、tradeActionReadiness passed 不得被解释为可下单、正式交易可用或自动交易可用。

## 出门条件

完成下一阶段代码开发后，才允许声明：

```text
ordinaryUserExperienceReady=true
frontendComplexityReduced=true
chatBoxExperienceOptimized=true
productVisualRefreshReady=true
ordinaryUserWorkbenchReady=true
expertModuleTabsPreserved=true
```

即使 UX 出门通过，仍必须保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

## 待外部复核重点

如需要交给 ChatGPT 或人工审计，重点复核以下文件：

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/STAGE_AUTOMATION_EXECUTION_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
docs/UX_FRONTEND_REVIEW_DOC_AUDIT.md
```

复核问题：

1. 文档是否仍保留专家页和多 Tab 深度入口。
2. ChatBox 是否被定义为第一入口，而不是唯一入口。
3. 移动端、视觉 token、普通话回复和数据健康是否有可执行验收标准。
4. UX 优化是否误写成正式交易解锁。
5. drawio 是否不超过 8 页，并且每页绑定真实代码实体、服务、数据或审计产物。

## 是否需要继续阻断式 ChatGPT 审计

本轮自审结论：

```text
blockingExternalChatGptAuditRequired=false
optionalExternalReviewAtSubstageExit=true
```

理由：

- 当前文档已经明确下一阶段只覆盖 UX / ChatBox / 双轨工作台 / 前端可读性 / 审计闭环。
- drawio 页数、实体绑定、专家页保留和交易硬边界均有文档证据。
- 仍需在代码阶段每个 UX 子阶段退出时生成专项审计包和 E2E 截图证据；这些产物比继续打磨文档更能发现真实体验偏差。
