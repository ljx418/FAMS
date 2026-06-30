# 用户体验优化阶段文档审计

更新时间：2026-06-30

## 审计结论

```text
status=pass_ux_docs_ready
documentationSupportsUxAutomation=true
ordinaryUserExperienceTargetDocumented=true
expertModeTargetDocumented=true
plainLanguageDecisionPathDocumented=true
drawioUxArchitectureUpdated=true
drawioRawFileReadable=true
drawioPageCount=8
drawioPageLimit=8
chatBoxAgentCoreDocumentationAligned=true
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
chatBoxBusinessEntryReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

结论：当前文档可以支撑下一阶段 UX-1 到 UX-6 的自动化开发。该结论只表示“用户体验优化开发规格 ready”，不表示正式交易 ready。

## 审计范围

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/drawio-summary.txt
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
```

## 规格核查

| 核查项 | 结论 | 说明 |
| --- | --- | --- |
| 普通用户目标 | passed | 文档要求默认展示状态摘要、普通话结论、下一步和禁止动作。 |
| 专业用户目标 | passed | 文档要求专业模式保留完整指标、validation、审计 artifact 和 blocker。 |
| 体验解释层实体 | passed | drawio 和目标架构绑定 `ExperienceModeToggle.tsx`、`PlainLanguageHelp.tsx`、`DividendLowVolDecisionCard.tsx`、`PortfolioBacktestSummaryCard.tsx`、`StrategyComparisonExplainer.tsx`。 |
| 红利低波用户路径 | passed | 文档覆盖候选筛选、观察区间、风险提示、数据可信、人工计划草案和专业证据展开。 |
| 组合回测用户路径 | passed | 文档覆盖策略选择、多时间段收益曲线、收益来源、数据等级、模型有效性、交易阻断和人工计划草案。 |
| ChatBox/AgentCore 业务入口 | passed_with_known_gaps | 文档覆盖 `FamsChatBox.tsx / chat.ts / famsChatService / piAgentCoreAdapter` 当前 v1、二次确认、白名单工具、交易阻断，以及后续会话持久化、流式事件和 PI LLM agent loop 缺口。 |
| 审计产物 | passed | 文档要求 `frontend_ux_consistency_audit.json`、`chatbox_agentcore_audit.json`、截图证据、`acceptance-report.html` 和 read-drawio 输出。 |
| 交易边界 | passed | 所有目标仍保持 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。 |
| 虚假验收风险 | controlled | 文档明确 UX 简化不得隐藏数据缺口、模型不足、proxy benchmark 或交易锁定。 |

## 后续代码阶段入口

下一阶段可按以下顺序进入实质开发：

1. **UX-1 全局体验模式**：实现普通模式/专业模式切换，默认普通模式展示摘要，专业模式保留完整审计。
2. **UX-2 红利低波结论卡**：实现 Top 候选、买卖观察区间、风险标签、数据可信和下一步操作的卡片化展示。
3. **UX-3 组合回测摘要卡**：实现不同时间段收益曲线、收益来源、benchmark 资格、模型有效性和交易阻断摘要。
4. **UX-4 术语解释与帮助**：实现术语说明、分数含义、数据等级含义和“为什么不能交易”的解释入口。
5. **UX-5 任务与审计可读化**：让 Operation 和 audit artifact 显示为普通用户可理解的任务状态、产物和复核入口。
6. **UX-6 端到端可读性验收**：生成桌面、平板、移动端截图和 `frontend_ux_consistency_audit.json`。
7. **ChatBox/AgentCore 后续集成**：在 UX 主路径通过后，按 `docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md` 补会话持久化、PI LLM agent loop、流式事件、全业务工具覆盖和 `chatbox_agentcore_audit.json`。

## 每项验收标准

| 阶段 | 验收标准 |
| --- | --- |
| UX-1 | 普通模式默认可见；专业模式可切换；交易锁定和数据可信摘要始终可见。 |
| UX-2 | 红利低波首屏能说明“为什么入选、现在处于什么区间、有什么风险、下一步做什么”。 |
| UX-3 | 组合回测首屏能说明“哪条策略更好、收益来自哪里、数据是否可信、为什么仍不能交易”。 |
| UX-4 | 关键术语有普通话解释；用户不需要财经背景也能理解分数和状态含义。 |
| UX-5 | 用户能从任务中心找到审计报告、截图证据和阻断原因。 |
| UX-6 | 自动化截图覆盖桌面、平板、移动端；验收报告明确列出通过项和未通过项，不做虚假验收。 |

## 仍未完成项

```text
ordinaryUserExperienceReady=false
frontendComplexityReduced=false
ExperienceModeToggle.tsx 未实现
PlainLanguageHelp.tsx 未实现
DividendLowVolDecisionCard.tsx 未实现
PortfolioBacktestSummaryCard.tsx 未实现
StrategyComparisonExplainer.tsx 未实现
frontend_ux_consistency_audit.json 未生成
UX 自动化截图验收未执行
piLlmAgentLoopEnabled=false
chatSessionPersistenceReady=false
chatStreamingReady=false
chatbox_agentcore_audit.json 未生成
```

这些未完成项是下一阶段代码开发任务，不是当前文档规格缺口。ChatBox 当前只能声明 v1 受控集成，不能声明完整 AgentCore 业务入口 ready。

## 交易边界审计

当前阶段只允许：

```text
RESEARCH
OBSERVE
COMPARE
PLAN_DRAFT
MANUAL_TRADE_DRAFT
```

当前阶段继续禁止：

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
auto rebalance
formal target weight > 0
```

UX 改造不得把以下状态改为 true：

```text
formalTradingUnlocked
autoTradeUnlocked
canCreateOrder
orderCreateAllowed
```

## 独立审计意见

```text
externalChatGptAuditRequired=false
reason=当前风险主要是后续代码实现是否按文档保留 blocker 和交易锁定，不是文档规格不足。进入代码阶段后，应在 UX-6 的截图验收、frontend_ux_consistency_audit.json 和 chatbox_agentcore_audit.json 中再次审计。
```

## 下一步

可以进入 UX-1 到 UX-6 的自动化开发。进入代码阶段前必须复核：

```text
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/drawio-summary.txt
docs/read-drawio-output.txt
```

若代码实现中出现隐藏 blocker、隐藏交易锁定、把普通模式写成交易建议或把 `ordinaryUserExperienceReady` 虚假置为 true，应立即打回开发计划阶段。
