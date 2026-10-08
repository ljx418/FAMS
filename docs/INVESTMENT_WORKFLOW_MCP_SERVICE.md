# FAMS 三段投资工作流 MCP

状态：`v2.2 已实现；作为 mcp/financial-mcp.json 的默认对外入口`

## 1. 对外体验

外部 AI 宿主不再从数十个技术域工具中自行拼装流程。默认 `workflow` profile 固定按以下顺序工作：

```text
基本信息确认 -> 仓位策略 -> 回测复盘
```

每次任务先调用 `investment_workflow.get_readiness`。返回结果决定当前可执行步骤、数据缺口、确认要求和下一步；Agent 不得跳过阻断项。

账户与策略路由：

| 账户 | 资产 | 策略入口 | 目标输出 |
| --- | --- | --- | --- |
| 同花顺 | 行业 ETF、波动个股 | `run_rotation_volatility_strategy` | RRG + MACD + 均线 + 成交量、已有网格复核、人工计划网格 |
| 同花顺 | 红利低波股票/ETF | `get_dividend_low_vol_plan` | 候选结论、买卖观察区间、证据质量和失效条件 |
| 支付宝 | 现金、黄金、债券、权益组合 | `get_portfolio_state` + 固定复盘 | 年度配置偏差、风险、人工计划草案 |

## 2. 三段调用顺序

### 2.1 基本信息确认

1. `investment_workflow.get_readiness`
2. 有截图时调用 `capture.upload_screenshot`
3. 宿主自行看图后调用 `capture.apply_extraction`
4. 调用 `capture.get_preview`，向用户展示逐行差异
5. 用户明确确认后调用 `capture.confirm_rows`
6. 按需调用 `market_data.get_asset_trend`
7. 再次调用 `investment_workflow.get_readiness`

无视觉能力时不得猜测截图。历史成交已体现在最新持仓快照时，确认必须使用 `included_in_latest_snapshot`，避免重复扣加。

### 2.2 仓位策略

1. `investment_workflow.list_strategy_assignments`
2. 未归属时调用 `investment_workflow.suggest_strategy_assignments`
3. 展示账户来源、建议策略和理由；用户确认后调用 `investment_workflow.confirm_strategy_assignment`
4. 根据策略归属调用轮动波动、红利低波或投资组合工具
5. 红利低波需要刷新时，用户确认后调用 `investment_workflow.refresh_dividend_low_vol_research`，再用 `operation.get` 跟踪
6. 支付宝需要完整复盘时，先调用 `investment_workflow.preflight_portfolio_review`；用户确认后调用 `investment_workflow.start_portfolio_review`，再用 `investment_workflow.get_portfolio_review` 跟踪

### 2.3 回测复盘

使用 `investment_workflow.compare_saved_advice_scenarios` 比较：

- `follow_advice`：按已保存建议执行
- `hold_without_action`：不执行建议
- `actual_transactions`：按真实流水回放

默认只使用 `saved_advice_replay`。`point_in_time_simulation` 的冻结策略逐日动态重算尚未完成，调用时必须返回 `insufficient` 和明确 blocker，不能用静态建议冒充。

波动网格另有一组 v3 专用接口：

1. `backtest.grid_replay.list_sources`：列出有持仓或历史网格的资产与真实行情覆盖。
2. `backtest.grid_replay.run`：创建可审计回放 Operation，返回 `operationId`。
3. `backtest.grid_replay.get_result`：读取曲线、质量评价、输入哈希和证据状态，不重新运行。

固定规则见 `fams://backtest/grid-replay/rules`。关键口径如下：

- 开盘前计划可使用当日日 K；盘中计划必须有生成时刻之后的分钟线；收盘后计划从下一交易时段开始。
- 缺少分钟线时返回 `insufficient_intraday_evidence`，不得用全天高低价倒推成“命中”或“未命中”。
- 订单有效窗口取订单、计划和新计划替代时刻的交集；子单只能在父单成交后生效。
- 日线不能证明同日双向或父子先后时返回 `ambiguous`，不计入收益。
- A 股默认执行 T+1、整手、方向性滑点、最低佣金、印花税和适用过户费；基金/ETF不计印花税。
- 起始现金优先来自指定输入或复盘账户快照；缺失时按 0 并显式警告，不再虚构 10 万元本金。
- 质量结论至少包含相对持有增量收益、回撤差、完成周期、利润因子、换手、费用、敞口和证据置信度。证据覆盖低于 80% 时整体为 `insufficient`。
- v3 同时返回“计划触发模拟 / 不执行建议 / 已确认归因的实际成交”三种口径。只有用户确认过 `PlanExecutionLink` 的成交才进入实际执行收益；未匹配或未确认成交单独列示。

### 2.4 事实、计划与执行闭环

截图确认或交易文件导入后，宿主应保留响应中的 `ingestionBatchId`，再按以下顺序调用：

1. `trade_ledger.get_ingestion_batch`：检查逐行状态、覆盖区间和 `positionEffectPolicy`。已体现在最新持仓中的历史成交必须为 `record_only`。
2. `trade_ledger.run_reconciliation`：保存一份不可变对账。若声明“无新成交/无委托”，必须同时传入单次人工确认；仅传布尔值不会成为覆盖证据。
3. `investment_workflow.run_rotation_volatility_strategy`：使用新鲜对账运行研究；返回 `strategyRunId`、`gridPlanId` 和草案 ID。计划只是人工计划，不是券商委托。
4. `investment_workflow.get_strategy_run` / `trade_ledger.get_plan_lifecycle`：按 ID 读取同一不可变结果和追加式生命周期。
5. 新成交或委托观察写入后，调用 `trade_ledger.list_pending_matches`；自动规则只产生 `suggested` 或 `unmatched`。
6. 用户核对标的、方向、数量、价格和时间后，才可调用 `trade_ledger.confirm_execution_match`。该调用只确认审计关系，不会向券商下单。

同一 `idempotencyKey` 携带不同内容会返回冲突；宿主不得通过更换 key 来掩盖输入变化。没有 15 分钟内 `ready/warning` 对账时，策略只能给观察结论，不能生成或复用精确拟单。

## 3. 对外白名单

默认 `workflow` profile 在原有三段工作流工具之外暴露 3 个只用于研究的网格回放工具。不会暴露：

```text
create_transaction
transaction.create_manual_record
grid_strategy.activate
relative_rotation.delete_*
任意 shell / filesystem / 通用网络工具
```

专家入口继续兼容：

- `financial-asset-manager-portfolio`：支付宝组合专家流程
- `financial-asset-manager-volatility`：波动仓专家流程
- `financial-asset-manager-research`：旧 `full` 研究 Registry，仅兼容旧客户端，不是推荐入口

## 4. Resources 与 Prompts

Resources：

- `fams://investment-workflow/contract`
- `fams://investment-workflow/readiness`
- `fams://investment-workflow/assignments`
- `fams://investment-workflow/portfolio/current`
- `fams://backtest/grid-replay/rules`

Prompts：

- `basic-information-confirmation`
- `position-strategy`
- `backtest-review`

## 5. 启动

```bash
cd backend
npm run build
FAMS_MCP_PROFILE=workflow \
FAMS_MCP_DEFAULT_USER_ID=default \
npm run start:mcp:stdio
```

本机 Streamable HTTP：

```bash
FAMS_MCP_PROFILE=workflow \
FAMS_MCP_DEFAULT_USER_ID=default \
FAMS_MCP_HTTP_HOST=127.0.0.1 \
FAMS_MCP_HTTP_PORT=4010 \
npm run start:mcp:http
```

未配置认证时只允许回环地址。旧 `/api/v1/mcp` 是兼容 REST bridge，会暴露完整 Registry，不是默认对外工作流入口。

## 6. 安全边界

所有 profile 固定：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

以下动作缺少人工确认时返回 `status=blocked`：

- 确认策略归属
- 确认截图事实
- 保存对账运行（仅当包含明确零事实时要求单次人工确认）
- 确认或拒绝计划与成交的匹配关系
- 提交红利低波刷新任务
- 提交支付宝固定复盘

策略结果只包含研究、观察、比较和人工计划；用户必须在同花顺或支付宝中自行查重和执行。

## 7. 验收

```bash
cd backend
npm run test:investment-workflow-mcp
npm run test:volatility-mcp
npm run test:portfolio-mcp-contract
```

验收覆盖官方 MCP SDK 内存连接、真实 stdio 子进程、Streamable HTTP、真实本地账户状态读取、工具精确白名单、Resource/Prompt、用户上下文冲突、三项确认阻断和四项交易锁。
