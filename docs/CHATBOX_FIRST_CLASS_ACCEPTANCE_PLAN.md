# ChatBox 第一公民开发与验收计划

更新时间：2026-07-01

## 1. 目标

把 ChatBox 从“辅助入口”升级为“FAMS 第一业务入口”。完成后，用户能在对话框内完成核心研究路径：问问题、运行查询或 quick-run、查看图表、理解数据可信度、追踪任务、生成草案、确认阻断原因。

本计划只定义后续开发和验收标准，不表示当前已经实现完整 ChatBox 第一公民能力。

当前实现状态（2026-07-01 阶段验收后）：

```text
chatBoxFirstClassTargetDocumented=true
chatBoxV1Integrated=true
chatSessionPersistenceReady=true
piLlmAgentLoopEnabled=partial_controlled_intent_router
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
chatOperationLinkageReady=true
chatSessionAuditReady=true
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=false
chatBoxPlainLanguageReady=false
chatBoxDataHealthUxReady=false
chatStreamingReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本轮文档审计结论：

```text
pass_current_stage_doc_audit=true
proceed_to_code_implementation=true
external_review_required_before_each_stage_exit=true
canProceedToImplementation=true
chatBoxFirstClassFunctionalReady=true
chatBoxFirstClassReady=false
```

解释：`chatBoxFirstClassFunctionalReady=true` 表示本阶段文档支撑范围内的工具覆盖、结构化结果、Operation 确认闭环、E2E 审计和交易边界合同已经通过；它不表示体验已经足够好，也不表示正式交易放行。`chatBoxFirstClassReady=false` 会保持到 CB-F ChatBox 对话体验深度优化完成并通过可视化验收。`chatStreamingReady=false` 是后续增强项，不阻断 CB-F 体验优化出门。

## 2. 非目标

- 不释放正式 `ADD / REDUCE`。
- 不创建订单。
- 不开放自动交易。
- 不让 LLM 调用任意工具。
- 不允许 ChatBox 访问 shell、文件系统或任意网络。
- 不把 quick-run research backtest 写成 formal validation。

## 3. 子阶段计划

### CB-A 文档与状态闭环

开发内容：

- 更新 `CHATBOX_AGENTCORE_INTEGRATION_PLAN.md`。
- 新增 `CHATBOX_TOOL_COVERAGE_MATRIX.md`。
- 更新 `TARGET_ARCHITECTURE_GAP.md`、`target-architecture-gap.drawio`、`drawio-summary.txt`。
- 修复旧状态漂移：会话持久化和受控 LLM intent router 不再被写成完全缺失。

验收标准：

- 文档能独立解释 ChatBox 第一公民目标。
- drawio 第 8 页展示 ChatBox-first 架构。
- 所有状态词一致。
- `formalTradingUnlocked=false` 和 `autoTradeUnlocked=false` 保持显眼。

### CB-B 工具覆盖与权限协议

开发内容：

- 后续代码阶段将所有核心工具登记到 ChatBox tool manifest。
- 每个工具有权限类型：`read_only_direct`、`compute_quick_run`、`confirm_before_operation`、`permanently_blocked`。
- 每个工具定义输入、输出、确认策略和审计字段。

验收标准：

- 工具覆盖矩阵中的核心功能均有 ChatBox intent。
- 所有副作用工具必须二次确认。
- 所有交易工具永久阻断。
- 工具 manifest 覆盖审计必须输出 `coveragePercent=100`、`missingTools=[]`、`extraToolsNotInMatrix=[]`、`unsafeTools=[]`。
- manifest 中不得出现 shell、filesystem、任意网络或矩阵外工具。

### CB-C 结构化结果与图表

开发内容：

- 后续代码阶段为 ChatBox 增加结构化结果渲染。
- 支持指标卡、比较表、收益曲线、回撤曲线、证据链接和阻断原因。
- 复用现有 ECharts 能力或新增 Chat inline chart renderer。

验收标准：

- “永久组合 vs 全天候组合最近三年”能返回收益曲线和回撤曲线 payload。
- 图表、表格和文字摘要来自同一份结果。
- 数据缺口与研究边界在图表旁可见。
- `portfolio_backtest_compare` 的结构化结果必须包含 `resultType=strategy_comparison`、`quickRun` 或 `operationId`、`metricCards`、`comparisonTable`、`line_chart`、`drawdown_chart`、`dataQualitySummary`、`evidenceRefs`、`notTradingAdvice=true` 和 `prohibitedActions`。

### CB-D Operation 与审计联动

开发内容：

- 后续代码阶段把扫描、持久化回测、刷新、草案生成接入确认卡。
- 确认后返回 operationId、artifactRefs 和下一步行动卡。
- 失败时返回用户可读原因。

验收标准：

- 未确认不得启动副作用动作。
- 确认后可在 ChatBox 和 Operations 页面追踪。
- 每次工具调用都有审计记录。
- 未确认时不得创建 Operation、不得写 artifact、不得生成人工计划草案。
- 确认、拒绝、阻断都要落入 chat session audit。

### CB-E 全路径 E2E

开发内容：

- 后续代码阶段增加自动化验收脚本和截图。
- 覆盖普通用户和专业用户两类路径。

验收标准：

- 红利低波前三候选查询。
- 单票买卖观察区间解释。
- 永久组合 vs 全天候组合三年策略对比并画图。
- 任务状态查询。
- 审计报告解释。
- 草案生成确认。
- 正式交易动作阻断。
- LLM planner 权限漂移测试：unknown intent、formal add/reduce、order_create、shell/filesystem/network、未登记 tool 都必须 blocked。
- 交易边界文案检查：不得把 `manualDraftReady`、`tradeActionReadiness passed` 或 quick-run 写成策略可交易。

### CB-F ChatBox 可理解性与任务式体验优化

开发内容：

- 后续代码阶段把 ChatBox 首屏从长文本快捷问题改为任务卡：今天先看什么、对比组合策略、分析红利低波、解释不能交易、查看任务审计。
- 助手回复统一为“结论 / 关键数字 / 下一步 / 数据可信 / 证据详情”。
- `evidenceRefs`、`blockedReasons`、provider、planner mode、key 状态等技术信息默认折叠。
- 数据异常、SQLite 损坏、provider 不可用、数据不足时，返回用户可读的数据健康提示和安全下一步。
- 需要确认的扫描、刷新、持久化回测、草案生成继续使用确认卡；确认卡必须说明不会创建订单。
- 消息级操作提供重试、复制、打开页面、查看证据、继续追问。

验收标准：

- 未输入时能看到清晰任务卡。
- 每条助手回复主视图都有一句话结论和下一步动作。
- 主视图不得只展示 raw 技术字段。
- 图表、表格、指标卡旁有普通话解释。
- 数据异常不得只显示 `HTTP 400/500` 或原始异常。
- “为什么不能下单”必须明确 `canCreateOrder=false`、`orderCreateAllowed=false`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`。
- 所有副作用动作仍需确认，所有交易动作仍 blocked。
- 桌面和移动端截图不得出现文字溢出、图表遮挡或按钮挤压。

CB-F 必须生成：

```text
chatbox_ux_optimization_audit.json
chatbox_plain_language_result_audit.json
chatbox_data_health_ux_audit.json
trade_boundary_wording_audit.json
acceptance-report.html
```

CB-E 必须生成：

```text
chatbox_first_class_audit.json
chatbox_tool_manifest_audit.json
chatbox_structured_result_audit.json
chat_operation_linkage_audit.json
chat_llm_permission_drift_audit.json
trade_boundary_wording_audit.json
chatbox_ux_optimization_audit.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

## 4. PRD 规格检视清单

每个子阶段结束后必须检查：

| 检查项 | 通过标准 |
| --- | --- |
| ChatBox 第一入口 | 用户不需要先找菜单，也能完成核心研究路径。 |
| 页面仍可用 | ChatBox 返回结果后能跳转到详细页面。 |
| 数据可信可见 | 数据来源、新鲜度、覆盖率和缺口不被隐藏。 |
| 图表可复核 | 图表来自结构化 payload，能追溯到数据和 artifact。 |
| 副作用确认 | 扫描、刷新、持久化回测、草案均需确认。 |
| 交易阻断 | ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 永远 blocked。 |
| 审计闭环 | Chat 消息、工具调用、确认、阻断、artifactRefs 可追溯。 |
| ChatBox 可理解性 | 用户不用理解内部字段，也能看懂结论、下一步、数据可信和不能交易原因。 |

## 5. 自动化验收命令

文档阶段：

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
rg -n "chatBoxFirstClassTargetDocumented|CHATBOX_TOOL_COVERAGE_MATRIX|inlineChartResultReady" docs
rg -n "formalTradingUnlocked=false|autoTradeUnlocked=false|canCreateOrder=false|orderCreateAllowed=false" docs
```

代码阶段：

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

E2E 阶段：

```text
打开 Dashboard -> 用 ChatBox 查询红利低波候选
用 ChatBox 比较永久组合和全天候组合最近三年
确认图表、表格、数据缺口和禁止动作同时出现
启动需要确认的扫描或草案
确认交易动作被阻断
生成 HTML 验收报告
验证 ChatBox 欢迎任务卡、数据健康提示、主视图普通话解释和移动端可读性
```

## 6. 出门结论模板

只有代码实现和全部验收通过后才能写：

```text
chatBoxFirstClassReady=true
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=true
chatBoxPlainLanguageReady=true
chatBoxDataHealthUxReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
chatOperationLinkageReady=true
chatSessionAuditReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

不得写：

```text
formalTradingReady 被写成 true
orderCreateAllowed 被写成 true
autoTradeReady 被写成 true
ChatBox 被写成 can trade
```

当前文档阶段只能写：

```text
pass_current_stage_doc_audit=true
proceed_to_code_implementation=true
external_review_required_before_each_stage_exit=true
chatBoxFirstClassReady=false
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=false
chatBoxPlainLanguageReady=false
chatBoxDataHealthUxReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段代码、E2E 和审计通过后已经可以写：

```text
chatBoxFirstClassReady=true
chatBoxFirstClassFunctionalReady=true
chatBoxExperienceOptimized=true
chatBoxPlainLanguageReady=true
chatBoxDataHealthUxReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
chatOperationLinkageReady=true
chatSessionAuditReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```
