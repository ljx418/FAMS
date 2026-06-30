# 用户体验优化阶段开发前 Readiness Review

更新时间：2026-06-30

## 结论

```text
reviewStatus=pass_ready_for_ux_automation
documentationSupportsFullUxStage=true
expectedExitAcceptanceAchievable=true
majorSpecificationGap=none_found
highRiskRequiringUserChoice=none_found
externalChatGptAuditRequired=false
chatBoxAgentCorePlanDocumented=true
chatBoxV1Integrated=true
chatBoxBusinessEntryReady=false
piLlmAgentLoopEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

当前文档水平可以完整支撑本阶段 UX-1 到 UX-6 的自动化开发。本阶段开发完成后，可以达成预设目标：普通用户更容易理解红利低波、组合回测、人工计划草案和任务审计路径；专业用户仍能查看完整证据链；系统继续保持正式交易锁定。

该结论不表示正式交易 release ready。

## 审查输入

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/USER_EXPERIENCE_OPTIMIZATION_DOC_AUDIT.md
docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/drawio-summary.txt
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
```

## 覆盖度评估

| 领域 | 文档是否足够 | 依据 | 结论 |
| --- | --- | --- | --- |
| 目标体验 | 是 | 30 秒内理解结论、可信度、下一步和禁止动作。 | 可开发 |
| 信息架构 | 是 | UX-1 定义 Dashboard、DividendLowVol、Backtest、Operations 的首屏路径。 | 可开发 |
| 普通/专业模式 | 是 | UX-2 定义模式切换、localStorage、专业证据保留和结果不变。 | 可开发 |
| 红利低波可读性 | 是 | UX-3 定义结论卡、原因、区间、数据可信和下一步按钮。 | 可开发 |
| 组合回测可读性 | 是 | UX-4 定义收益、回撤、数据可信、策略解释和 blocker 摘要。 | 可开发 |
| 任务审计可读性 | 是 | UX-5 定义任务做了什么、产物在哪里、能否用于交易。 | 可开发 |
| ChatBox/AgentCore 业务入口 | 是 | ChatBox 当前 v1、PI AgentCore runtime、白名单工具、二次确认、交易阻断和后续缺口均已落盘。 | 可分阶段开发 |
| 可访问性与视觉降噪 | 是 | UX-6 定义统一状态色、低频列折叠、文字不溢出和多端截图。 | 可开发 |
| 出门验收 | 是 | 要求 frontend build、runtime tests、acceptance-report、截图、`frontend_ux_consistency_audit.json` 和 `chatbox_agentcore_audit.json`。 | 可验收 |
| 交易边界 | 是 | 所有文档保持 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。 | 风险受控 |

## 本阶段出门验收标准

完成代码阶段后，必须同时满足：

1. 普通模式默认可见，用户进入红利低波或回测页面后能先看到结论、可信度、下一步和禁止动作。
2. 专业模式可切换，完整指标、字段级证据、validation、artifact 路径仍可访问。
3. 红利低波候选能用自然语言解释“为什么入选、现在处于什么区间、为什么不能交易”。
4. 组合回测能用自然语言解释“哪条策略收益高、哪条回撤低、哪条数据不足、为什么仍被阻断”。
5. 任务中心和验收报告能让非开发者理解任务状态和审计产物用途。
6. 桌面、平板、移动端截图无明显文字溢出、标签堆叠或首屏信息过载。
7. `frontend_ux_consistency_audit.json` 明确列出普通模式、专业模式、交易边界、截图证据和未完成项。
8. ChatBox 能解释候选、组合、任务、阻断原因和页面跳转；当前阶段不得声明完整 PI LLM agent loop、会话持久化或流式任务 ready。
9. 不出现正式买入、正式卖出、下单、自动再平衡或正式交易已解锁文案。

## 风险评估

| 风险 | 等级 | 当前控制措施 | 是否需要用户选择 |
| --- | --- | --- | --- |
| UX 简化隐藏数据缺口 | 中 | 文档要求 `dataTrustGrade`、`calculationAuditStatus`、blockers 和交易锁定始终可见。 | 否 |
| 普通话结论被误读为交易建议 | 中 | 文档禁用“买入建议 / 卖出建议 / 可下单”，统一使用“观察 / 草案 / 待复核”。 | 否 |
| 专业审计能力被折叠后难找 | 中 | 文档要求专业模式保留完整证据链，任务中心显示 artifact 用途。 | 否 |
| 自动化截图只证明可见，不证明真实数据准确 | 中 | 本阶段目标是 UX 可读性；数据真实性仍由既有 data trust 和 calculation audit 约束。 | 否 |
| 正式交易边界被误写 | 高 | 已设置硬边界字段和 grep 检查；代码阶段仍需 contract test。 | 否 |
| ChatBox 被误解为可执行交易智能体 | 高 | 文档要求 ChatBox 只走白名单工具、二次确认、Operation 和交易 gate；完整 AgentCore 仍需后续验收。 | 否 |

未发现需要用户在多条技术路线之间选择的高风险阻塞点。推荐按文档指定路线执行：

```text
普通模式默认摘要
+ 专业模式保留完整证据
+ blocker 和交易锁定永久可见
+ 多端截图与审计 JSON 双验收
```

## 外部审计判断

```text
externalChatGptAuditRequired=false
reason=当前文档已具备可执行实体、用户路径、验收标准、出门条件和交易边界；主要剩余风险发生在后续代码实现与截图验收阶段，而不是文档规格阶段。
```

如果后续代码阶段出现以下情况，再建议外部审计：

- 普通模式隐藏了 blocker 或交易锁定。
- `ordinaryUserExperienceReady=true` 缺少截图和 JSON 证据。
- 页面文案出现正式交易、买入、卖出、下单、自动再平衡等误导性表达。
- 专业模式无法查看完整证据链。

## 下一步

可以进入 UX-1 到 UX-6 自动化开发。进入代码阶段前，开发者必须先读取：

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md
docs/USER_EXPERIENCE_OPTIMIZATION_DOC_AUDIT.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/read-drawio-output.txt
```

代码阶段完成后必须生成：

```text
frontend_ux_consistency_audit.json
acceptance-report.html
桌面/平板/移动端截图
prd_spec_review.json
trade_gate_contract.json
chatbox_agentcore_audit.json
```
