# ChatBox 第一公民 + PI AgentCore 集成开发与验收计划

更新时间：2026-07-01

## 1. 阶段定位

ChatBox 是 FAMS 的第一业务入口。用户应能先通过对话框完成“查询、比较、运行、解释、追踪、生成草案”，再按需跳转到红利低波、组合回测、任务中心或审计报告页面查看完整证据。

页面不被废弃。页面继续作为深度工作台；ChatBox 负责统一入口、意图解析、工具编排、结果摘要、图表展示、任务追踪和审计链接。

当前边界：

```text
chatBoxFirstClassTargetDocumented=true
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
agentToolWhitelistEnabled=true
deterministicPlannerFallback=true
piLlmAgentLoopEnabled=partial_controlled_intent_router
chatSessionPersistenceReady=true
chatStreamingReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
chatOperationLinkageReady=true
chatSessionAuditReady=true
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=false
chatBoxPlainLanguageReady=false
chatBoxDataHealthUxReady=false
ordinaryUserWorkbenchReady=false
expertModuleTabsPreserved=true
dualTrackExperienceReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

阶段判定：

```text
canProceedToImplementation=true
chatBoxFirstClassFunctionalReady=true
chatBoxFirstClassReady=false
external_review_required_before_each_stage_exit=true
```

解释：`chatBoxFirstClassFunctionalReady=true` 表示 CB-1 到 CB-5 在本阶段文档支撑范围内已经完成实现与验收；它不等于体验足够好，也不等于正式交易放行。`chatBoxFirstClassReady=false` 会保持到 CB-F / UX-7 的任务式入口、普通话结果、数据健康提示和可视化验收全部通过。后续如果新增 ChatBox 业务工具、流式输出或开放式 agent loop，仍必须重新走文档、manifest、E2E 和交易边界审计。

解释：

- 已接入 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`，并通过 `piAgentCoreAdapter` 暴露受控 runtime 状态和 PI-compatible 工具 manifest。
- 当前 ChatBox v1 默认使用 deterministic planner，能稳定识别核心意图并调用 FAMS 白名单工具。
- 已补充 dotenv 驱动的受控 LLM planner：配置 `FAMS_CHAT_LLM_ENABLED=1` 且存在 LLM key 时，LLM 只负责把自然语言映射到 FAMS 已允许 intent；实际工具执行仍走白名单、二次确认和交易 gate。
- 已完成本地 JSON 会话审计存储，可恢复最近会话、工具确认和阻断原因。
- 已完成当前矩阵内全业务工具覆盖、对话框内结构化图表渲染、Operation 确认闭环和交易边界审计。
- 尚未完成 SSE/WebSocket 流式事件和开放式多轮 tool-calling agent loop；这两项是后续增强，不属于本阶段出门阻断。
- ChatBox 不暴露 shell、文件系统或任意网络工具；所有能力必须经过 FAMS 工具白名单、二次确认和交易 gate。

## 2. 目标体验

普通用户可以直接输入：

```text
帮我看红利低波前三只候选
600887 现在处于合适建仓区间吗
对比永久投资组合和全天候投资组合最近三年的收益率和最大回撤，并画图
当前组合里风险最大的持仓是什么
最近任务失败原因是什么
生成红利低波人工计划草案
为什么现在不能下单
```

ChatBox 必须在对话框内返回：

1. 结论摘要。
2. 数据来源、新鲜度和缺口。
3. 指标卡、比较表或图表。
4. 如果有任务，返回 `operationId` 和 artifactRefs。
5. 如果有阻断，说明阻断原因。
6. 如果需要人工确认，显示确认卡。
7. 明确“这不是交易指令”。
8. 把证据、provider、planner mode、key 状态等技术细节默认折叠。

专业用户可以从 ChatBox 跳转到：

- `DividendLowVol.tsx`：候选、观察区间、数据可信、人工计划草案。
- `Backtest.tsx`：策略比较、收益曲线、数据等级、模型有效性。
- `Operations.tsx`：任务状态、artifactRefs、审计包。
- `acceptance-report.html`：阶段性验收报告。

## 2.1 ChatBox 与专家模块的双轨关系

ChatBox 是普通用户默认入口，不是唯一入口。FAMS 前端继续保留多 Tab / 多模块系统，给资深用户直接使用某个模块的深度能力。

```text
普通用户：
ChatBox -> 普通用户工作台 -> 摘要结果 / 图表 / 数据健康 / 下一步 -> 必要时进入专家页

资深用户：
左侧菜单 -> 专家模块页 -> 筛选 / 参数 / 完整指标 / 审计 artifact -> 必要时调用 ChatBox 解释
```

双轨约束：

- ChatBox 负责“提问、编排、解释、下一步”，工作台负责“承接任务结果和低认知操作”，专家页负责“深度配置、完整证据和审计追踪”。
- ChatBox 返回的行动卡必须优先跳转到普通用户工作台状态；只有用户选择查看完整证据时，才进入专家模块页。
- 专家模块页不得因为 ChatBox 第一入口而被删除或降级；筛选、排序、参数配置、完整指标、字段级 evidence 和 artifactRefs 必须保留。
- 专家模块页应提供“用 ChatBox 解释当前结果”的入口，帮助用户从复杂表格回到普通话解释。
- 两条路径共享同一后端工具权限、Operation、审计包和交易 gate，任何入口都不能释放正式交易动作。

## 3. 目标架构

目标调用链：

```text
用户自然语言
  -> FamsChatBox.tsx
  -> /api/v1/chat/*
  -> Chat Intent Router
  -> PI AgentCore Adapter
  -> Tool Registry / Permission Gate
  -> Domain Service / Operation Service
  -> Structured Result Composer
  -> Chat Inline UI Renderer
  -> Audit Package / ArtifactRefs
```

实现实体：

| 层级 | 实体 | 职责 |
| --- | --- | --- |
| 前端入口 | `FamsChatBox.tsx` | 全局 ChatBox、快捷问题、确认卡、结构化结果渲染、页面跳转。 |
| 前端挂载 | `AppLayout.tsx` | 在所有页面提供 ChatBox 第一入口。 |
| 普通用户工作台 | 后续 `UserTaskWorkbench` / Dashboard 工作台区 | 承接 ChatBox 结果，展示摘要、图表、数据健康、下一步和审计链接。 |
| 专家模块页 | `DividendLowVol.tsx` / `Backtest.tsx` / `Operations.tsx` | 保留多 Tab / 多模块深度使用能力，支持筛选、排序、参数配置和完整证据。 |
| 图表组件 | `EquityCurveChart` / `YieldCurveChart` / 后续 Chat inline chart renderer | 渲染收益曲线、回撤曲线、策略比较图。 |
| Chat UX 展示层 | `WelcomeTaskBoard` / `AssistantMessage` / `StructuredResultRenderer` / `ActionCardList` / `DataHealthNotice` / `AgentStatusDetails` | 把技术结果组织成任务入口、普通话结论、下一步、数据健康提示和折叠技术详情。 |
| API 路由 | `backend/src/routes/chat.ts` | capabilities、messages、sessions、tool-confirmations。 |
| 编排服务 | `famsChatService` | 意图识别、工具选择、确认流、交易阻断、结构化结果包装。 |
| LLM planner | `chatLlmPlannerService` | 使用 dotenv LLM key 做 intent router；不直接执行工具。 |
| AgentCore 适配 | `piAgentCoreAdapter` | PI runtime 检测、PI-compatible tool manifest、before/after tool gate。 |
| 工具注册 | MCP registry / FAMS tool manifest | 统一描述工具权限、输入、输出、风险等级、确认策略。 |
| 长任务 | `operationService` | 扫描、回测、刷新、审计包生成等任务状态和 artifactRefs。 |
| 业务服务 | 红利低波、组合回测、持仓、任务、审计服务 | 执行真实业务逻辑。 |
| 审计 | `chatbox_agentcore_audit.json` / `acceptance-report.html` | 记录工具调用、确认、阻断、数据证据和用户路径。 |

## 4. 结果展示协议

ChatBox 不能只返回自然语言。后续实现必须支持结构化结果：

```text
text_summary
plain_language_conclusion
metric_cards
comparison_table
line_chart
drawdown_chart
evidence_refs
recommended_next_actions
data_health_status
evidence_refs_collapsed
technical_details_collapsed
operation_status
action_suggestions
blocked_reasons
notTradingAdvice=true
prohibitedActions includes ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

图表必须来自结构化 payload，不允许只返回截图或不可复算文本。

组合策略对比示例：

```text
intent=portfolio_backtest_compare
input:
  strategies=["permanent_portfolio", "all_weather"]
  period="last_3_years"
  metrics=["total_return", "annualized_return", "max_drawdown", "volatility", "sharpe", "calmar"]
output:
  text_summary
  metric_cards
  comparison_table
  line_chart.equity_curve
  drawdown_chart
  data_quality_summary
  artifactRefs
  notTradingAdvice=true
```

默认执行策略：

- 已缓存、只读、轻量计算：可直接返回结果。
- 非持久化 quick-run 回测：可直接执行，但必须标记 `quickRun=true` 和数据等级。
- 创建持久化 Operation、刷新全量数据、生成人工计划草案：必须二次确认。
- 正式交易动作：永久阻断。
- 工具异常、数据损坏、provider 不可用：必须归一化成用户可读的数据健康提示，不能只返回 HTTP 状态码或原始异常。

## 5. 工具权限策略

| 类型 | 例子 | ChatBox 行为 |
| --- | --- | --- |
| `read_only_direct` | 查询候选、持仓摘要、任务状态、审计报告 | 直接执行并返回结构化结果。 |
| `compute_quick_run` | 最近三年组合策略对比、轻量指标计算 | 直接执行，返回 `quickRun` 标记和数据来源。 |
| `confirm_before_operation` | 全量扫描、持久化回测、刷新数据、生成人工草案 | 先显示确认卡，再创建 Operation 或 artifact。 |
| `permanently_blocked` | ADD、REDUCE、ORDER_CREATE、AUTO_TRADE、shell、filesystem、任意网络 | 直接返回 blocked response，并写审计。 |

所有工具必须在 `docs/CHATBOX_TOOL_COVERAGE_MATRIX.md` 中登记。

## 6. 典型用户路径

### 路径 A：组合策略对比并画图

```text
用户：对比永久投资组合和全天候投资组合最近三年的收益率和最大回撤，并画图。
系统：识别 portfolio_backtest_compare。
系统：读取真实数据、检查 dataGrade、生成 quick-run 或请求持久化确认。
系统：返回收益曲线、回撤曲线、指标表、数据缺口和 artifactRefs。
系统：提示这只是研究比较，不是交易建议。
```

### 路径 B：红利低波候选解释

```text
用户：帮我看红利低波前三只候选。
系统：读取候选池。
系统：返回前三只、为什么入选、当前区间、数据可信度、阻断原因。
系统：提供“查看页面”“刷新扫描”“生成观察草案”行动卡。
```

### 路径 C：买卖观察区间

```text
用户：600887 现在处于合适建仓区间吗？
系统：读取 priceAudit、观察区间、数据新鲜度和红利低波状态。
系统：若价格过期或错配，提示“需刷新后重算”。
系统：若数据可用，返回低位/中性/高位观察解释和证据。
```

### 路径 D：任务失败解释

```text
用户：最近任务为什么失败？
系统：读取 Operations。
系统：返回失败任务、失败分类、影响范围、下一步建议和 artifactRefs。
```

### 路径 E：人工计划草案

```text
用户：给我生成红利低波人工计划草案。
系统：识别副作用动作，要求确认。
系统：确认后生成 PLAN_DRAFT / MANUAL_TRADE_DRAFT。
系统：formalTargetWeight=0，canCreateOrder=false。
```

## 7. 开发计划

### CB-1 文档与状态词典

目标：把 ChatBox 第一公民写入 PRD、目标架构、drawio、工具矩阵和验收计划。

验收标准：

- `chatBoxFirstClassTargetDocumented=true`。
- drawio 第 8 页明确 ChatBox 是第一入口。
- 文档状态不得把会话持久化写成未完成状态。
- 交易锁定状态保持一致。

### CB-2 全业务工具覆盖矩阵

目标：所有 FAMS 核心功能都有 ChatBox intent、权限、结果形态和验收标准。

验收标准：

- `docs/CHATBOX_TOOL_COVERAGE_MATRIX.md` 至少覆盖红利低波、组合回测、持仓、任务、审计、人工计划草案、交易阻断。
- 每个工具有权限类型和确认策略。
- 所有正式交易动作进入 `permanently_blocked`。
- 工具 manifest 审计必须输出 `coveragePercent=100`、`missingTools=[]`、`extraToolsNotInMatrix=[]`、`unsafeTools=[]`。
- 不允许注册 shell、filesystem、任意网络、未在矩阵登记的外部工具。

### CB-3 结构化结果与对话内图表

目标：文档定义 ChatBox 返回图表、表格、指标卡和证据的标准 payload。

验收标准：

- 组合策略对比路径包含 `line_chart` 与 `drawdown_chart`。
- 红利低波路径包含 `metric_cards`、`evidence_refs`、`blocked_reasons`。
- 结果协议能映射到现有 ECharts 组件或后续 inline renderer。
- `portfolio_backtest_compare` 必须返回 `resultType=strategy_comparison`、`notTradingAdvice=true`、`metric_cards`、`comparison_table`、`line_chart`、`drawdown_chart`、`data_quality_summary`、`evidence_refs` 和 `prohibitedActions`。
- 图表、表格和摘要必须来自同一份回测结果，不允许用截图或静态 mock 替代。

### CB-4 Operation 与确认闭环

目标：所有副作用动作从 ChatBox 发起时都有确认、operationId、artifactRefs 和审计。

验收标准：

- 扫描、持久化回测、数据刷新、人工计划草案均需确认。
- 操作失败时返回用户可读失败原因。
- ChatBox 可跳转任务中心。
- 未确认时不得创建 Operation、不得写 artifact、不得生成草案。
- 确认、拒绝、阻断都必须写入 chat session audit，并返回可追溯 `operationId` 或 `artifactRefs`。

### CB-5 全路径端到端验收

目标：用自动化验收覆盖 ChatBox 第一入口的核心路径。

验收标准：

- 红利低波前三候选查询通过。
- 组合策略三年对比并返回图表 payload 通过。
- 任务状态查询通过。
- 副作用确认通过。
- 正式交易动作阻断通过。
- LLM planner 权限漂移测试通过：unknown intent、formal add/reduce、order_create、shell/filesystem/network、未登记 tool 均返回 blocked。
- 交易边界文案检查通过：不得把 `manualDraftReady`、`tradeActionReadiness passed` 或 quick-run 解释成策略可交易。

### CB-F ChatBox 对话体验深度优化

目标：把功能已接通的 ChatBox 优化为普通用户能理解的任务式助手。

验收标准：

- 欢迎页展示任务卡，而不是只展示长文本快捷 prompt。
- 助手回复按“结论 / 关键数字 / 下一步 / 数据可信 / 证据详情”组织。
- `evidenceRefs`、`blockedReasons`、provider、planner mode 和 key 状态默认折叠。
- 数据异常、SQLite 损坏、provider 不可用和数据不足返回 `DataHealthNotice` 风格提示。
- 扫描、刷新、持久化回测、人工计划草案继续二次确认，确认文案必须说明不会创建订单。
- 每条结果至少提供一个安全下一步，例如打开页面、查看证据、重试、继续追问或查看阻断。
- 桌面和移动端截图证明文字、图表和按钮不溢出。
- `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false` 在阻断回复中保持显眼。

### CB-G / UX-8 双轨工作台与视觉系统

目标：在 CB-F 通过后，把 ChatBox 结果承接到普通用户工作台，同时保留专家模块页的深度操作能力。

验收标准：

- ChatBox 行动卡能跳转到普通用户工作台的对应状态，而不是只跳到复杂原始表格。
- 普通用户可通过 ChatBox + 工作台完成候选查询、组合对比、观察区间解释、任务状态和交易阻断理解。
- 专家用户仍可通过左侧菜单直接进入 `DividendLowVol.tsx`、`Backtest.tsx`、`Operations.tsx` 等模块完成深度操作。
- 专家页面提供“用 ChatBox 解释当前结果”入口。
- 视觉系统遵循 light-first、低噪音、通透、专业金融工作台方向；状态色受控，技术字段默认折叠。
- 该阶段不得扩大工具权限，不得改变 `formalTradingUnlocked=false / autoTradeUnlocked=false`。

每个 CB 子阶段退出必须生成：

```text
chatbox_first_class_audit.json
chatbox_tool_manifest_audit.json
chatbox_structured_result_audit.json
chat_operation_linkage_audit.json
chat_llm_permission_drift_audit.json
trade_boundary_wording_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

## 8. 出门条件

完成 ChatBox 第一公民完整阶段后，才可以声明：

```text
chatBoxFirstClassReady=true
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=true
chatBoxPlainLanguageReady=true
chatBoxDataHealthUxReady=true
chatBoxBusinessEntryReady=true
piAgentCoreToolCallingReady=true
chatSessionAuditReady=true
chatOperationLinkageReady=true
inlineChartResultReady=true
fullBusinessToolCoverageReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

仍不能声明：

```text
ChatBox 具备下单能力
ChatBox 具备自动交易能力
ChatBox 可以绕过人工复核
ChatBox 输出等同正式投资建议
```

## 9. 验收命令

文档阶段：

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
rg -n "chatBoxFirstClassTargetDocumented|fullBusinessToolCoverageReady|inlineChartResultReady" docs
rg -n "formalTradingUnlocked=false|autoTradeUnlocked=false|canCreateOrder=false|orderCreateAllowed=false" docs
```

后续代码阶段：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:chat-agent-core
npm run test:chat-llm-planner
npm run test:fivd-r-trade-gate-contract
npm run test:trade-action-readiness

cd ../frontend
npm run build
```

E2E 验收必须覆盖：

```text
红利低波前三候选查询
组合策略三年对比并返回图表 payload
任务状态查询
红利低波扫描需确认
人工计划草案需确认
正式交易动作被阻断
欢迎任务卡、普通话结果层级、数据健康提示和移动端可读性
```
