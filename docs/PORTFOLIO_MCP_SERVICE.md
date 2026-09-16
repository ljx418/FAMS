# 仓位管理 MCP 服务

状态：`1.0 已实现；本地 stdio 与受保护 Streamable HTTP 自动验收通过；远程公网地址未默认启用`

## 用户得到什么

外部 AI 宿主可以读取当前仓位与目标配置、检查复盘条件、启动固定支付宝复盘、读取结果、保存人工计划决定，以及保存并确认用户提供的支付宝持仓截图。宿主不需要再依赖当前 Codex 终端会话保存工作流上下文。

本服务不会创建 `Transaction`、不会调用券商下单、不会把人工计划标记为已成交。以下值是硬边界，而不是提示词约定：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

公开合同见 `mcp/portfolio-management-mcp.json`。旧 `/api/v1/mcp` REST bridge 和轮动研究 MCP 保留，仓位管理公开档位不会把它们的交易记录或策略激活工具带进来。

## 本地接入

先构建：

```bash
cd backend
npm run build
```

项目已提供 `mcp/financial-mcp.json`。手工运行 stdio 时使用：

```bash
cd backend
DATABASE_URL=file:./prisma/dev.db \
FAMS_MCP_USER_ID=default \
npm run mcp:portfolio-stdio
```

`FAMS_MCP_USER_ID` 必填，工具参数里没有 `userId`，因此模型不能切换或猜测其他用户。

## 受保护的 HTTP 接入

HTTP 默认关闭。先创建只显示一次明文的访问令牌：

```bash
cd backend
npm run mcp:portfolio-token -- create \
  --user default \
  --name local-agent \
  --expires-days 30 \
  --scopes portfolio:read,review:run,capture:write,plan:write
```

再设置环境变量并启动主后端：

```bash
FAMS_MCP_HTTP_ENABLED=true \
FAMS_MCP_ALLOWED_ORIGINS=https://chatgpt.com \
FAMS_MCP_RATE_LIMIT_PER_MINUTE=60 \
npm start
```

本机端点为 `http://127.0.0.1:4000/mcp`（端口以项目实际 `PORT` 为准），请求必须携带 `Authorization: Bearer fams_mcp_...`。令牌只保存 SHA-256 哈希，可列出和撤销：

```bash
npm run mcp:portfolio-token -- list --user default
npm run mcp:portfolio-token -- revoke --user default --id <token-id>
```

若需要互联网 MCP 客户端访问，必须把该端点放在 HTTPS 反向代理或安全隧道之后，并保留 Bearer 校验、Origin 白名单和限流。当前版本没有内建 OAuth 授权服务器；因此不能把“通用远程 MCP 已实现”误写成“ChatGPT OAuth 连接器已经发布”。

## 推荐调用顺序

1. 调用 `portfolio_get_current_state`，读取持仓、目标比例、证据时间和数据健康度。
2. 用户明确回答最近截图后仓位是否变化，再调用 `portfolio_review_preflight`。
3. 预检阻断时停止，不得用旧结果冒充本轮分析。
4. 预检通过后用稳定幂等键调用 `portfolio_review_start`。
5. 用返回的 `operationId` 调用 `portfolio_review_get`，直到完成或明确失败。
6. 只向用户展示人工计划；用户明确确认后才调用 `portfolio_plan_save_decision`。
7. 用户仍需在支付宝或券商客户端自行核对费用、可卖份额并手工交易。

截图路径是“宿主看图、服务端保存和验证”：先上传原图，再提交仅含 `account_summary` / `holding` 的结构化行，向用户展示差异，最后由用户明确确认。交易和委托行会被拒绝。

## 自动验收

```bash
cd backend
npm run test:portfolio-mcp-contract
npm run test:portfolio-mcp-http
```

验收覆盖官方 SDK 握手、真实数据库仓位读取、精确工具白名单、resources/prompt、stdio 子进程、Bearer 必填、Origin 白名单、scope 隔离、令牌撤销以及 `Transaction` 零变化。
