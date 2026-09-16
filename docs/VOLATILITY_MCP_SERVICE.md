# 波动仓管理 MCP 服务

## 实现状态

本项目已使用 `@modelcontextprotocol/sdk` 提供正式 MCP 服务，默认运行 `volatility` 能力档位。现有 `/api/v1/mcp` 自定义 REST bridge 保留为兼容层，不是新 MCP 宿主的首选入口。

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

`volatility` 档位不暴露 `transaction.create_manual_record`、`grid_strategy.activate`、服务端视觉或其他与当前工作流无关的写入工具。`full` 档位只用于兼容旧 Registry，不建议作为日常宿主配置。

## 截图与宿主视觉合同

定义的主路径是“宿主看图，服务端验证”：

1. 宿主使用自身视觉能力读取用户附件。
2. 调用 `capture.upload_screenshot` 保存原始证据。
3. 调用 `capture.apply_extraction` 提交持仓、资金、成交或委托的结构化行。
4. 调用 `capture.get_preview`，向用户显示识别值、置信度与差异。
5. 只有用户明确确认后，才调用 `capture.confirm_rows`。已反映在最新持仓快照里的历史成交必须传 `tradePositionEffectPolicy=included_in_latest_snapshot`。

服务不会在 `volatility` 档位调用OCR或视觉大模型。宿主无视觉能力且没有已确认的新鲜截图时，对账结果返回 `HOST_VISION_REQUIRED`；此时允许继续研究，但拟单会被阻断或标记为需人工查重。如未来确需服务端视觉补全，应单独设计授权、隐私、成本和可追溯契约，不会默认降级。

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

## 验收

执行：

```bash
cd backend
npm run test:volatility-mcp
```

自动验收包含：

- 官方 SDK 内存客户端的 tools/resources/templates/prompt/call 契约。
- 真实子进程 stdio 握手和调用。
- Streamable HTTP 握手、工具发现、健康检查和非回环拒绝。
- 默认用户注入与 `USER_CONTEXT_MISMATCH` 阻断。
- `HOST_VISION_REQUIRED`、历史成交不重放和交易权限全为 `false`。
- 默认工具列表不包含交易写入、策略激活和服务端视觉工具。
