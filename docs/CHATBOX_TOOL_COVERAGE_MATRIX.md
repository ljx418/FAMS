# ChatBox 全业务工具覆盖矩阵

更新时间：2026-07-01

## 1. 目的

本矩阵用于约束“ChatBox 是第一业务入口”的实现范围。任何 FAMS 核心功能若不能在 ChatBox 中被查询、运行、解释或跳转，必须在本文件中标记为缺口。

当前阶段仍不释放正式交易：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

实现阶段判定（2026-07-01 阶段验收后）：

```text
canProceedToImplementation=true
chatBoxFirstClassFunctionalReady=true
chatBoxFirstClassReady=false
chatBoxExperienceOptimized=false
external_review_required_before_each_stage_exit=true
```

解释：本矩阵已用于生成 ChatBox tool manifest 和权限协议实现。当前核心工具覆盖审计已通过；但 ChatBox 体验仍需 CB-F / UX-7 优化。后续新增业务能力仍必须先更新本矩阵，再补 manifest 和验收脚本。

## 2. 权限类型

| 权限类型 | 含义 | 是否需要确认 |
| --- | --- | --- |
| `read_only_direct` | 读取现有数据、解释状态、返回页面跳转或审计链接。 | 否 |
| `compute_quick_run` | 使用现有缓存或轻量计算直接返回研究结果，不创建持久化任务。 | 否 |
| `confirm_before_operation` | 会刷新数据、生成 artifact、创建 Operation 或生成草案。 | 是 |
| `permanently_blocked` | 交易、下单、自动交易、绕过 gate、任意 shell/filesystem/network。 | 不允许执行 |

## 3. 核心工具覆盖

| 业务功能 | 当前页面 | 当前 API / Service | ChatBox intent | 权限类型 | 返回形态 | 审计证据 | 当前状态 | 验收标准 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ChatBox 能力说明 | 全局 | `/api/v1/chat/capabilities` / `famsChatService` | `capability_help` | `read_only_direct` | `text_summary`、`action_suggestions` | `chatbox_agentcore_audit.json` | 已有基础 | 能说明可做、不可做、需要确认的动作。 |
| 红利低波前三候选 | `DividendLowVol.tsx` | `strategy.ts` / `dividendLowVolStrategyService` | `dividend_low_vol_top_candidates` | `read_only_direct` | `metric_cards`、`comparison_table`、`evidence_refs`、`blocked_reasons` | 候选池 artifact | 已有基础，需强化结果协议 | 返回候选、入选原因、数据可信、观察区间和禁止动作。 |
| 红利低波单票区间 | `DividendLowVol.tsx` | `dividendLowVolTradingZoneService` | `dividend_low_vol_trading_zone` | `read_only_direct` | `metric_cards`、`text_summary`、`evidence_refs` | `priceAudit` | 已有基础 | 价格过期或错配时显示“需刷新后重算”。 |
| 红利低波扫描 | `DividendLowVol.tsx` / `Operations.tsx` | `operationService` | `dividend_low_vol_scan` | `confirm_before_operation` | `operation_status`、`action_suggestions` | Operation artifact | 已有确认基础 | 未确认不得启动；确认后返回 operationId。 |
| 红利低波人工计划草案 | `DividendLowVol.tsx` | `portfolioBacktestReviewService` | `dividend_low_vol_plan_draft` | `confirm_before_operation` | `text_summary`、`blocked_reasons`、`evidence_refs` | `11_manual_plan_draft_audit.json` | 已有基础 | 返回 PLAN_DRAFT，不创建订单，`formalTargetWeight=0`。 |
| 当前持仓摘要 | `Dashboard.tsx` / `Assets.tsx` | portfolio holdings snapshot | `portfolio_summary` | `read_only_direct` | `metric_cards`、`comparison_table` | holdings snapshot audit | 已接入 | 返回市值、行业暴露、风险摘要和更新时间。 |
| 持仓风险解释 | `Assets.tsx` / `Analysis.tsx` | Position advice / risk service | `portfolio_risk_explain` | `read_only_direct` | `text_summary`、`metric_cards`、`blocked_reasons` | risk artifact | 已接入基础解释 | 解释最大风险来源和需复核数据。 |
| 组合策略 quick-run 对比 | `Backtest.tsx` | `PortfolioBacktestEngine` | `portfolio_backtest_compare` | `compute_quick_run` | `line_chart`、`drawdown_chart`、`comparison_table`、`metric_cards` | quick-run result artifact | 已接入 | 可比较永久组合与全天候组合最近三年收益和最大回撤。 |
| 持久化组合回测 | `Backtest.tsx` / `Operations.tsx` | `portfolioBacktest.ts` / `operationService` | `portfolio_backtest_operation` | `confirm_before_operation` | `operation_status`、`artifactRefs` | backtest artifact | 已接入确认闭环 | 未确认不得创建 Operation；确认后可追踪任务。 |
| 回测结果解释 | `Backtest.tsx` | `PortfolioBacktestEngine` | `portfolio_backtest_explain` | `read_only_direct` | `text_summary`、`metric_cards`、`blocked_reasons` | `10_model_effectiveness_audit.json` | 已接入 | 解释收益、回撤、benchmark、数据等级和不能交易原因。 |
| 任务状态查询 | `Operations.tsx` | `/api/v1/operations/*` / `operationService` | `operation_status` | `read_only_direct` | `operation_status`、`action_suggestions` | Operation artifact | 已有基础 | 返回成功/失败/进行中、失败原因、artifactRefs。 |
| 审计报告查询 | `Operations.tsx` / HTML report | audit package services | `audit_report_explain` | `read_only_direct` | `text_summary`、`evidence_refs` | `acceptance-report.html` | 已接入 | 能解释当前验收结论、证据路径、未完成项。 |
| 数据可信解释 | 多页面 | data readiness services | `data_trust_explain` | `read_only_direct` | `metric_cards`、`blocked_reasons` | `09_data_grade_audit.json` | 已接入 | 说明来源、新鲜度、覆盖率、缺口和是否可用于研究。 |
| 页面跳转 | 全局 | frontend route action card | `navigate_to_page` | `read_only_direct` | `action_suggestions` | Chat session audit | 已有基础 | 可跳转红利低波、回测、任务、审计页面。 |
| 为什么不能下单 | 全局 | `famsChatService` / trade gate | `trade_gate_explain` | `read_only_direct` | `text_summary`、`blocked_reasons` | trade gate audit | 已有基础 | 必须说明 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 禁止。 |
| 正式 ADD | 无 | trade gate | `formal_add` | `permanently_blocked` | `blocked_reasons` | blocked action audit | 已阻断 | 永远不得执行，返回 blocked response。 |
| 正式 REDUCE | 无 | trade gate | `formal_reduce` | `permanently_blocked` | `blocked_reasons` | blocked action audit | 已阻断 | 永远不得执行，返回 blocked response。 |
| 创建订单 | 无 | trade gate | `order_create` | `permanently_blocked` | `blocked_reasons` | blocked action audit | 已阻断 | 永远不得执行，返回 blocked response。 |
| 自动交易 | 无 | trade gate | `auto_trade` | `permanently_blocked` | `blocked_reasons` | blocked action audit | 已阻断 | 永远不得执行，返回 blocked response。 |
| shell / filesystem / 任意网络 | 无 | 不暴露 | `unsafe_system_tool` | `permanently_blocked` | `blocked_reasons` | security audit | 必须不注册 | 工具 manifest 中不得出现。 |

## 3.1 用户体验返回合同

每个 ChatBox 核心 intent 除了满足工具权限合同，还必须满足用户体验返回合同：

| 合同项 | 要求 |
| --- | --- |
| 用户任务描述 | 每个 intent 必须有普通话说明，解释“这个问题能帮你完成什么”。 |
| 主视图摘要 | 结果主视图必须包含一句话结论，不能只展示 raw JSON、技术字段或内部枚举。 |
| 下一步动作 | 每个成功、失败或阻断结果都必须给出安全下一步，例如打开页面、查看证据、重试、刷新数据、查看任务或继续追问。 |
| 数据健康提示 | 数据不足、数据库损坏、provider 不可用、价格过期时，必须返回用户可读原因和影响范围。 |
| 技术细节折叠 | `evidenceRefs`、`blockedReasons`、provider、planner mode、key 状态、artifactRefs 默认折叠，专业用户可展开。 |
| 交易边界 | 涉及交易的问题必须显示 `canCreateOrder=false`、`orderCreateAllowed=false`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`。 |

新增或修改工具时，如果无法满足上述合同，只能标记为体验缺口，不得声明 `chatBoxExperienceOptimized=true`。

## 4. 组合策略对比返回协议

用户问题：

```text
对比永久投资组合和全天候投资组合最近三年的实际收益率和最大回撤，并在对话框内画图。
```

目标响应：

```json
{
  "intent": "portfolio_backtest_compare",
  "resultType": "strategy_comparison",
  "quickRun": true,
  "notTradingAdvice": true,
  "metricCards": [
    { "label": "永久组合累计收益", "value": "..." },
    { "label": "全天候组合累计收益", "value": "..." },
    { "label": "永久组合最大回撤", "value": "..." },
    { "label": "全天候组合最大回撤", "value": "..." }
  ],
  "charts": [
    { "type": "line_chart", "title": "三年收益曲线", "series": [] },
    { "type": "drawdown_chart", "title": "三年回撤曲线", "series": [] }
  ],
  "comparisonTable": [],
  "dataQualitySummary": {
    "dataGrade": "research_or_insufficient",
    "freshnessStatus": "known",
    "coverageStatus": "known"
  },
  "artifactRefs": [],
  "prohibitedActions": ["ADD", "REDUCE", "ORDER_CREATE", "AUTO_TRADE"]
}
```

验收重点：

- 对话框内有图表 payload。
- 指标和图表使用同一组回测结果。
- 数据缺口不能隐藏。
- 不能出现正式买卖建议。

## 5. Tool Manifest 覆盖审计

后续实现阶段必须生成 `chatbox_tool_manifest_audit.json`。最低结构：

```json
{
  "registeredToolCount": 0,
  "matrixToolCount": 0,
  "coveragePercent": 100,
  "missingTools": [],
  "extraToolsNotInMatrix": [],
  "unsafeTools": [],
  "formalTradingUnlocked": false,
  "autoTradeUnlocked": false
}
```

验收标准：

- `coveragePercent=100`。
- `missingTools=[]`。
- `extraToolsNotInMatrix=[]`。
- `unsafeTools=[]`。
- 所有 `confirm_before_operation` 工具在未确认时不得创建 Operation 或 artifact。
- 所有 `permanently_blocked` 工具必须返回 blocked response，并写审计。

## 6. 合同测试要求

### 6.1 结构化结果合同

`portfolio_backtest_compare` 必须断言：

```text
resultType=strategy_comparison
quickRun=true 或 operationId 存在
notTradingAdvice=true
charts 包含 line_chart 和 drawdown_chart
metricCards 非空
comparisonTable 非空或存在明确 insufficient reason
dataQualitySummary 存在
prohibitedActions 包含 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

### 6.2 副作用确认合同

以下 intent 未确认不得执行：

```text
dividend_low_vol_scan
portfolio_backtest_operation
dividend_low_vol_plan_draft
refresh_data
```

确认后必须返回 `operationId`、`artifactRefs` 或草案审计引用。

### 6.3 LLM Planner 权限漂移合同

以下情况必须返回 blocked：

```text
unknown intent
formal_add
formal_reduce
order_create
auto_trade
shell / filesystem / 任意网络
未登记 tool
```

LLM planner 只能把自然语言映射到本矩阵登记的白名单 intent，不能直接执行工具。

### 6.4 交易边界文案合同

禁止把以下状态解释成策略可交易：

```text
manualDraftReady
manualTradePlanDraftReviewReady
tradeActionReadiness passed
quickRun completed
portfolioBacktestFormalReviewReady
```

这些状态最多表示研究、比较、人工计划草案或正式交易前置评审材料 ready。正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 仍保持 blocked。

### 6.5 ChatBox UX 合同

后续 CB-F / UX-7 实现必须断言：

```text
welcomeTaskCards.length >= 3
assistantPrimaryView.includesConclusion=true
assistantPrimaryView.includesNextAction=true
assistantPrimaryView.rawTechnicalOnly=false
dataHealthNoticeShownOnToolFailure=true
technicalDetailsCollapsedByDefault=true
mobileLayoutReadable=true
misleadingTradingCopyFound=false
```

禁止把 raw `blockedReasons`、raw `evidenceRefs`、HTTP 状态码或 provider/mode 信息作为普通用户主视图的唯一解释。

## 7. 原始缺口与验收后状态

```text
fullBusinessToolCoverageReady=false
inlineChartResultReady=false
chatStreamingReady=false
portfolioBacktestCompareIntentReady=planned
chatResultStructuredPayloadReady=planned
```

本阶段验收后状态：

```text
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
portfolioBacktestCompareIntentReady=implemented
chatResultStructuredPayloadReady=implemented
chatBoxExperienceOptimized=false
plainLanguageChatResultReady=false
guidedTaskEntryReady=false
dataHealthExplanationReady=false
chatStreamingReady=false
```

`chatStreamingReady=false` 是后续体验增强项；当前请求/响应式结构化结果已满足本阶段 ChatBox 第一业务入口出门条件。

## 8. 出门条件

```text
chatBoxFirstClassReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
chatOperationLinkageReady=true
chatSessionAuditReady=true
chatBoxExperienceOptimized=true
plainLanguageChatResultReady=true
guidedTaskEntryReady=true
dataHealthExplanationReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

出门前必须通过：

```text
红利低波查询
单票区间解释
组合策略三年对比并画图
任务状态查询
审计报告解释
副作用确认
交易动作阻断
```
