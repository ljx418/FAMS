# 波动仓管理 MCP 服务

## 实现状态

本项目已使用 `@modelcontextprotocol/sdk` 提供正式 MCP 服务。自 v2.2 起，对外默认档位是按用户流程组织的 `workflow`；本文件描述的 `volatility` 是同花顺波动仓专家档位。现有 `/api/v1/mcp` 自定义 REST bridge 保留为兼容层，不是新 MCP 宿主的首选入口。

运行边界是硬约束：

- `formalTradingUnlocked=false`
- `autoTradeUnlocked=false`
- `canCreateOrder=false`
- `orderCreateAllowed=false`
- 只生成研究、提醒和人工拟单，用户必须在同花顺查重并手工执行。

## 启动

先在 `backend` 目录构建：

```bash
npm run build
```

stdio（Codex/Claude Desktop 等本地宿主）：

```bash
FAMS_MCP_PROFILE=volatility \
FAMS_MCP_DEFAULT_USER_ID=default \
npm run start:mcp:stdio
```

Streamable HTTP（仅本机回环）：

```bash
FAMS_MCP_PROFILE=volatility \
FAMS_MCP_DEFAULT_USER_ID=default \
FAMS_MCP_HTTP_HOST=127.0.0.1 \
FAMS_MCP_HTTP_PORT=4010 \
npm run start:mcp:http
```

端点为 `http://127.0.0.1:4010/mcp`。当未配置认证时，任何非回环绑定（如 `0.0.0.0`）都会在启动时失败。

## 默认能力

一键工作流：

- `volatility_workflow.reconcile`：先对账，输出“已确认事实、对账差异、待确认规则、拟保留/撤销/新增订单、执行权限”。
- `volatility_workflow.run`：异步运行对账、真实行情、最近30个完整交易日、MA5/10/30、日频RRG、基本面/消息变化、策略差异、人工拟单、现金/风险门槛与JSON/HTML报告。
- `volatility_workflow.get_result`：按 `operationId` 或 `reviewId` 读取结果，不重跑分析。
- `volatility_workflow.decide_reanchor`：逐标的确认或拒绝固定网格重锚候选。它只写入策略版本与审计状态，不会创建券商订单。

宿主视觉与细粒度辅助工具：

- `capture.upload_screenshot`
- `capture.apply_extraction`
- `capture.get_preview`
- `capture.update_row`
- `capture.confirm_rows`
- `market_data.get_asset_trend`
- `operation.get`
- `daily_review.get` / `daily_review.get_latest` / `daily_review.export_html`
- `grid_strategy.list_templates`
- `backtest.grid_replay.list_sources`
- `backtest.grid_replay.run`
- `backtest.grid_replay.get_result`
- `trade_ledger.get_ingestion_batch`
- `trade_ledger.run_reconciliation`
- `trade_ledger.get_reconciliation`
- `trade_ledger.list_pending_matches`
- `trade_ledger.confirm_execution_match`
- `trade_ledger.get_plan_lifecycle`
- `investment_workflow.get_strategy_run`

`volatility` 档位不暴露 `transaction.create_manual_record`、`grid_strategy.activate`、服务端视觉或其他与当前工作流无关的写入工具。`full` 档位只用于兼容旧 Registry，不建议作为日常宿主配置。

## 截图与宿主视觉合同

定义的主路径是“宿主看图，服务端验证”：

1. 宿主使用自身视觉能力读取用户附件。
2. 调用 `capture.upload_screenshot` 保存原始证据。
3. 调用 `capture.apply_extraction` 提交持仓、资金、成交或委托的结构化行。
4. 调用 `capture.get_preview`，向用户显示识别值、置信度与差异。
5. 只有用户明确确认后，才调用 `capture.confirm_rows`。已反映在最新持仓快照里的历史成交必须传 `tradePositionEffectPolicy=included_in_latest_snapshot`。

服务不会在 `volatility` 档位调用OCR或视觉大模型。宿主无视觉能力且没有已确认的新鲜截图时，对账结果返回 `HOST_VISION_REQUIRED`；此时允许继续研究，但拟单会被阻断或标记为需人工查重。如未来确需服务端视觉补全，应单独设计授权、隐私、成本和可追溯契约，不会默认降级。

截图确认响应会返回 `ingestionBatchId` 与 `positionEffectPolicy`。宿主应使用 `trade_ledger.get_ingestion_batch` 展示“事实来自哪里、是否改变仓位”；之后用 `trade_ledger.run_reconciliation` 保存覆盖证明。明确零成交/零委托只有在同一请求携带确认人和确认时间时才有效，不能仅凭 Agent 推测。

策略返回的 `strategyRunId`、`gridPlanId`、`GridOrderDraft` 都是本地审计对象，不是券商订单。实际成交进入系统后，自动匹配只会产生候选；使用 `trade_ledger.confirm_execution_match` 人工确认后，该成交才会进入回放的“实际执行”口径。`trade_ledger.get_plan_lifecycle` 可查看 proposed、accepted、submitted、partially_filled、filled、cancelled、expired、superseded 的追加式历史。

## Resources 与 Prompt

- `fams://volatility/strategy/active`
- `fams://volatility/portfolio/latest-reconciled`
- `fams://volatility/rules`
- `fams://volatility/reviews/{reviewId}`
- Prompt：`volatility-review`

## 数据与决策约束

- 事实优先级：15分钟内已人工确认截图 > 本地数据库 > `strategy_state.json` 历史快照。
- 历史成交已体现在持仓快照中，不得重复扣加。
- 普通委托和条件单截图不完整时，新增候选必须标记人工查重。
- 父单未确认成交时，配对单不得激活；可卖数量、T+1、硬上限与现金底线由现有对账/网格服务执行。
- 策略参数只在周期或基本面发生实质变化、或一轮网格完成时建议调整；不因日内红绿重写全部网格。

## 波动网格回放

固定规则可由宿主读取 `fams://backtest/grid-replay/rules`。推荐调用顺序：

1. `backtest.grid_replay.list_sources`
2. 选定 `assetId` 和真实行情区间后调用 `backtest.grid_replay.run`
3. 使用返回的 `operationId` 调用 `backtest.grid_replay.get_result`

回放严格区分建议生成时段：开盘前计划可以用当日日 K；盘中计划必须有生成时刻之后的分钟线；收盘后计划从下一交易时段开始。盘中缺分钟线时返回 `insufficient_intraday_evidence`，不得把全天高低价反推成命中或未命中。引擎还会处理新计划替代、父子单、T+1、整手、最低佣金、印花税、过户费和滑点。

整体证据覆盖低于 80% 时，状态固定为 `insufficient`。此时曲线可以用于说明“现有证据能算什么”，但不得用增量收益或单次命中判断策略有效。页面和 MCP 都会返回输入哈希、逐档状态、相对持有增量收益、回撤差、完成周期、利润因子、换手、费用和平均敞口。v3 还会分别给出计划触发模拟与已确认归因的实际成交；未匹配成交不会被混入实际收益。

这是单资产网格回放。跨资产组合资金竞争应使用组合回测入口；不得把每个单资产都重复计入同一账户现金后再相加。

## 固定网格重锚机制

`downtrend_defensive` 固定网格不再把历史绝对价格无限沿用。每轮工作流都用最新完整日线检查锚点，不使用盘中红绿直接重写网格。

触发条件采用混合门槛，命中任一项就生成候选：

- 原配置声明的事件：完成一组可追溯卖出—回补周期、完整收盘触发暂停线、或连续两日收盘高于 MA5 且 MA5 不再下降。
- 锚点之后已过去至少 5 个完整交易日，且最新完整收盘相对旧锚偏移至少 2 ATR。
- 不等待锚龄，只要偏移达到 3 ATR 就立即生成候选。
- ATR 不可用时，老化偏移门槛回退为个股 5%、ETF/基金 3%；证据不足的事件保持 `unknown`，不会假定已触发。

候选生成是确定性的：

```text
new_anchor = latest_completed_daily_close
candidate_price = new_anchor * (old_level_price / old_anchor)
```

买价按市场最小价位向下取整，卖价向上取整。仓位角色、订单数量、父子关系、核心/卫星/反弹退出划分、现金规则和暂停线均保持不变。候选以未激活 `StrategyVersion` 保存，带有证据哈希和候选哈希；数据库中已激活版本优先于 `strategy_state.json`，后者只作为兼容回退。

组合门禁：

1. 任一标的触发重锚，就把本轮全部拟单标记为 `blocked_reanchor`。旧价格保留审计，但不可复制；截图中仍存在的匹配旧委托进入人工撤销/替换候选。
2. 宿主必须展示旧锚、新锚、锚龄、ATR/百分比偏移、逐项触发证据和每档新旧价格差异。
3. 用户必须对每个候选分别 `confirm` 或 `reject`，并传入 `acknowledgedNoBrokerExecution=true`。通用 `grid_strategy.activate` 不能激活此类候选。
4. 只有全部候选都已决定，确认项才激活为新的 `StrategyVersion`；拒绝项在随后的续跑复盘中仅观察。
5. 原复盘和旧拟单保持阻断，系统新建一次续跑复盘。只有续跑结果中 `actionability=actionable` 的订单才可复制到人工计划清单。

示例：

```json
{
  "userId": "default",
  "reviewId": "<awaiting review id>",
  "versionId": "<candidateStrategyVersionId>",
  "candidateHash": "<candidateHash>",
  "decision": "confirm",
  "confirmedBy": "human-user",
  "acknowledgedNoBrokerExecution": true,
  "reason": "已核对证据和档位差异"
}
```

返回 `awaiting_other_decisions` 时继续处理剩余候选；返回 `resolved` 时使用返回的续跑 `operationId` 调用 `volatility_workflow.get_result`。若出现新完整日线、更新的券商截图或活动策略版本改变，候选会标记为过期，必须用新证据重新运行。

## 验收

执行：

```bash
cd backend
npm run test:volatility-mcp
npm run test:grid-replay-v2
npm run test:trade-plan-ledger
```

自动验收包含：

- 官方 SDK 内存客户端的 tools/resources/templates/prompt/call 契约。
- 真实子进程 stdio 握手和调用。
- Streamable HTTP 握手、工具发现、健康检查和非回环拒绝。
- 默认用户注入与 `USER_CONTEXT_MISMATCH` 阻断。
- `HOST_VISION_REQUIRED`、历史成交不重放和交易权限全为 `false`。
- 默认工具列表不包含交易写入、策略激活和服务端视觉工具。
- 固定网格重锚触发、价格平移与买下/卖上取整、全组合暂停、逐标的确认/拒绝、防通用激活绕过、候选过期和续跑行为。
