# ChatBox 第一公民文档审计结论

更新时间：2026-07-01

## 1. 审计结论

```text
pass_current_stage_doc_audit=true
documentationSupportsCurrentStageDevelopment=true
documentationSupportsExitAcceptance=true
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_contract_tests
proceed_to_code_implementation=true
external_review_required_before_each_stage_exit=true
chatBoxFirstClassTargetDocumented=true
chatBoxToolCoverageMatrixDocumented=true
drawioPageCount=8
drawioPageLimit=8
chatBoxFirstClassReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

结论：当前文档可以支撑下一阶段 ChatBox 第一业务入口 / PI AgentCore 集成的自动化代码实现。该结论不表示 ChatBox 第一公民能力已经完成，也不表示正式交易可用。

## 2. 允许进入实现的范围

后续代码实现可以进入以下子阶段：

```text
CB-A 文档与状态闭环
CB-B 工具覆盖与权限协议
CB-C 结构化结果与图表
CB-D Operation 与审计联动
CB-E 全路径 E2E 验收
```

每个子阶段开始前必须根据 PRD 和本计划落盘开发及验收计划；每个子阶段结束后必须完成端到端验收、PRD 规格检视和交易边界复核。

## 3. 不允许声明的内容

当前阶段不得声明：

```text
chatBoxFirstClassReady 被写成 true
formalTradingUnlocked 被写成 true
autoTradeUnlocked 被写成 true
canCreateOrder 被写成 true
orderCreateAllowed 被写成 true
formal ADD 被写成 unlocked
formal REDUCE 被写成 unlocked
ORDER_CREATE 被写成 allowed
AUTO_TRADE 被写成 allowed
ChatBox 被写成具备下单能力
ChatBox 被写成具备自动交易能力
```

`manualDraftReady`、`manualTradePlanDraftReviewReady`、`tradeActionReadiness passed`、`quickRun completed`、`portfolioBacktestFormalReviewReady` 只能表示研究、比较、人工计划草案或正式交易前置评审材料 ready，不能解释成策略可交易。

## 4. 新增硬性验收

### 4.1 Tool manifest 覆盖率

后续实现必须生成 `chatbox_tool_manifest_audit.json`：

```json
{
  "registeredToolCount": 0,
  "matrixToolCount": 0,
  "coveragePercent": 100,
  "missingTools": [],
  "extraToolsNotInMatrix": [],
  "unsafeTools": []
}
```

通过标准：

```text
coveragePercent=100
missingTools=[]
extraToolsNotInMatrix=[]
unsafeTools=[]
```

### 4.2 结构化结果合同

`portfolio_backtest_compare` 必须返回：

```text
resultType=strategy_comparison
quickRun=true 或 operationId 存在
notTradingAdvice=true
metricCards 非空
comparisonTable 非空或有明确 insufficient reason
line_chart
drawdown_chart
dataQualitySummary
evidenceRefs
prohibitedActions 包含 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

### 4.3 副作用确认合同

以下 intent 未确认不得执行：

```text
dividend_low_vol_scan
portfolio_backtest_operation
dividend_low_vol_plan_draft
refresh_data
```

未确认时不得创建 Operation、不得写 artifact、不得生成草案。确认后必须返回 `operationId`、`artifactRefs` 或草案审计引用。

### 4.4 LLM planner 权限漂移合同

以下输入或 planner 输出必须 blocked：

```text
unknown intent
formal_add
formal_reduce
order_create
auto_trade
shell
filesystem
任意网络
未登记 tool
```

LLM planner 只负责把自然语言映射到白名单 intent，不能直接执行工具。

### 4.5 交易边界文案合同

验收必须检查高风险误写上下文，防止把研究、草案、quick-run 或 formal review 写成交易可用。

硬失败示例：

```text
formalTradingUnlocked 被写成 true
autoTradeUnlocked 被写成 true
orderCreateAllowed 被写成 true
canCreateOrder 被写成 true
正式 ADD / REDUCE 被写成已解锁
ORDER_CREATE 被写成 allowed
AUTO_TRADE 被写成 allowed
```

允许出现 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 的场景仅限 `prohibitedActions`、`blocked`、`不能声明`、`非目标` 或 `交易锁定` 上下文。

## 5. 每个 CB 子阶段退出必须提交的审计材料

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

## 6. 待复审文档路径

```text
docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md
docs/CHATBOX_TOOL_COVERAGE_MATRIX.md
docs/CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md
docs/CHATBOX_FIRST_CLASS_DOC_AUDIT.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/drawio-summary.txt
docs/USER_EXPERIENCE_OPTIMIZATION_PLAN.md
```

## 7. 是否需要继续外部审计

文档阶段不需要继续打回；可以进入代码实现。实现阶段每个 CB 子阶段退出前仍建议执行外部或 ChatGPT 审计，重点复核：

```text
工具 manifest 覆盖率是否真实
结构化图表是否来自同一份数据
副作用确认是否真的阻断未确认操作
LLM planner 是否只路由白名单 intent
交易边界是否被前端文案或 API 示例误写
```
