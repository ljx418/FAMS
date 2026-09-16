# MCP 服务独立质量审计

> **审计者**: Claude (MiniMax-M3)，作为外部独立视角
> **审计时间**: 2026-09-12
> **审计对象**: 本项目已开放的 MCP（Model Context Protocol）服务实现
> **范围**: 实现质量、实现范围、技术路线、视觉部分冗余

---

## 一句话结论

```text
implementation_quality=HIGH（生产可接受，本地/受保护 HTTP 与 stdio 双轨）
implementation_scope=THREE_PROFILES（portfolio / volatility / full）plus 旧的 legacy HTTP bridge
technical_route=OFFICIAL_MCP_SDK + Streamable HTTP（符合 MCP 2025 规范）
visual_part=NO_HUMAN_UI（这是 AI 宿主协议，非给人用的 UI）
visual_redundancy=NO_HUMAN_UI_NO_REDUNDANCY（前端 0 个 MCP 组件）
major_redundancy_in_transport=YES（存在 4 个 transport 入口，但分属 3 套 profile，不算冗余）
minor_redundancy_in_scripts=YES（verify-public-portfolio-mcp* 3 个脚本有重叠；建议合并）
legacy_dual_stack=YES（旧的 /api/v1/mcp 与新的 /mcp 并存；需要标记 deprecated 时间表）
```

---

## 1. 实现盘点（不依赖 CLAUDE.md 描述）

> **检索声明**: 本节列出仓库实际创建的文件，不依赖自述。

### 1.1 入口与传输

| 文件 | 行数 | 角色 | 状态 |
| --- | ---: | --- | --- |
| `backend/src/mcp/stdio.ts` | 17 | stdio 入口 → `createFamsMcpServer`（legacy registry） | 实现且可用 |
| `backend/src/mcp/portfolioStdio.ts` | 26 | stdio 入口 → `createPublicPortfolioMcpServer`（新 portfolio server） | 实现且自动验收通过 |
| `backend/src/mcp/streamableHttp.ts` | 87 | loopback Streamable HTTP → `createFamsMcpServer`（4010） | 实现，loopbackOnly=true |
| `backend/src/mcp/portfolioHttp.ts` | 60 | Streamable HTTP → `createPublicPortfolioMcpServer`（Fastify 路由 `/mcp`） | 实现，默认关闭，环境变量 `FAMS_MCP_HTTP_ENABLED=true` |
| `backend/src/mcp/index.ts` | 63 | Fastify 路由 `/api/v1/mcp/*`（domain-pack/tools/call/batch） | 实现，legacy HTTP bridge |

### 1.2 服务注册表与门面

| 文件 | 行数 | 角色 |
| --- | ---: | --- |
| `backend/src/mcp/registry.ts` | **1859** | 完整注册表（price/position/analysis/portfolio/backtest/transaction/alert/operation/relative-rotation/volatility/capture/grid_strategy 多域） |
| `backend/src/mcp/server.ts` | 424 | legacy server 工厂，组合 `mcpTools` 与 zod 校验 |
| `backend/src/mcp/publicPortfolioServer.ts` | 357 | **新** portfolio 公开 server 工厂（10 个工具、5 个 resource、1 个 prompt） |
| `backend/src/services/mcp/portfolioWorkflowFacade.ts` | 407 | portfolio 业务门面，跨 `alipayOneClickReviewService` / `alipayResearchWorkflowService` / `dailyReviewService` / `screenshotCaptureService` 编排 |
| `backend/src/services/mcp/portfolioMcpAuthService.ts` | 181 | portfolio MCP 鉴权（Bearer、scope、限流、令牌哈希存储） |

### 1.3 配置清单（4 份）

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `mcp/financial-mcp.json` | 3 个 stdio 服务器入口（portfolio / research / volatility），MCP 标准 clients.json 格式 | 实现 |
| `mcp/portfolio-management-mcp.json` | 新 portfolio 公开 manifest，含 tools/scopes/executionBoundary | 实现 |
| `mcp/fams-domain-pack.json` | 旧 domain pack 描述（包含 50+ canonical tools 清单） | 实现 |
| `mcp/harnessos-connector.json` | harnessos 接入描述，3 个 connector（http/stdio/streamable_http） | 实现 |

### 1.4 验证脚本

| 路径 | 入口命令 | 范围 |
| --- | --- | --- |
| `verify-public-portfolio-mcp.ts` | `test:portfolio-mcp-contract` 第一步 | SDK InMemoryTransport + 真实 DB + 写边界验证（fixture cleanup） |
| `verify-public-portfolio-mcp-stdio.ts` | `test:portfolio-mcp-contract` 第二步 | 真实 stdio 子进程握手 + 真实 DB |
| `verify-public-portfolio-mcp-http.ts` | `test:portfolio-mcp-http` | 真实 Streamable HTTP + Bearer/Origin/限流 |
| `verify-volatility-mcp-protocol.ts` | `test:volatility-mcp` 第一步 | volatility profile 协议 |
| `verify-volatility-mcp-stdio.ts` | `test:volatility-mcp` 第二步 | volatility stdio |
| `verify-volatility-mcp-http.ts` | `test:volatility-mcp` 第三步 | volatility Streamable HTTP |
| `verify-relative-rotation-mcp.ts` | `test:relative-rotation-mcp` | RRG profile |

### 1.5 数据库迁移

- `backend/prisma/manual-migrations/20260912_public_portfolio_mcp.sql`：建 `McpAccessToken` 表（id, userId, name, tokenPrefix, tokenHash, scopesJson, expiresAt, revokedAt, lastUsedAt, createdAt, updatedAt + 3 个 index）。
- `portfolioMcpAuthService.ensureStorage()` 实际运行 `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX` + `CREATE INDEX`——这是 idempotent 启动兼容设计，但仍存在"Prisma schema 缺表 + 手工 CREATE TABLE"的**约定一致性问题**。

---

## 2. 实现范围

### 2.1 三套 Profile

| Profile | 入口 | 工具数 | 业务焦点 | 鉴权方式 |
| --- | --- | ---: | --- | --- |
| **portfolio**（新） | `portfolioStdio.ts` / `portfolioHttp.ts` | 10 | 当前仓位读取、复盘预检/启动/查询、计划保存、截图导入、快照授权/撤销 | Bearer 哈希令牌 + scope + Origin + 限流 |
| **volatility**（旧） | `stdio.ts` 配 `FAMS_MCP_PROFILE=volatility` | ~13 | 波动仓对账、运行、获取、截图、Daily Review、网格模板 | 仅 `FAMS_MCP_DEFAULT_USER_ID` 注入 userId |
| **full**（旧） | `stdio.ts` 配 `FAMS_MCP_PROFILE=full` | ~40+ | 价格/持仓/分析/组合/回测/交易/告警/Operation/RRG/捕获/网格策略 | 同上 |

### 2.2 portfolio 10 个工具

`portfolio-management-mcp.json` 显式列出：
1. `portfolio_get_current_state`
2. `portfolio_review_preflight`
3. `portfolio_review_start`
4. `portfolio_review_get`
5. `portfolio_plan_save_decision`
6. `portfolio_screenshot_upload`
7. `portfolio_screenshot_save_extraction`
8. `portfolio_screenshot_confirm`
9. `portfolio_snapshot_authorize_reuse`
10. `portfolio_snapshot_revoke_reuse`

**范围合规性**: 覆盖 DPR-020～DPR-027 全部 8 项 PRD 需求；不暴露交易创建/策略激活工具；4 锁全 false。已通过 PRD_SPEC_REVIEW.md 的 18 行映射表确认。

### 2.3 scope 与边界

| scope | 对应工具 | 设计合理性 |
| --- | --- | --- |
| `portfolio:read` | get_current_state | ✓ |
| `review:run` | preflight / start / get | ✓（preflight 阻断时不阻塞只读） |
| `capture:write` | screenshot_upload / save_extraction / confirm | ✓（仅 fund_portfolio 类型 + 截断交易行） |
| `plan:write` | plan_save_decision | ✓（只写 AdviceExecution，不写 Transaction） |

### 2.4 反假绿边界（已实现且验收）

| 边界 | 实现位置 | 证据 |
| --- | --- | --- |
| 不创建 Transaction | `portfolioWorkflowFacade` + verify-public-portfolio-mcp.ts 测试前后 count 一致 | ✓ |
| 不解锁 autoTrade | `executionBoundary` 硬编码 4 锁 false | ✓ |
| 截图只允许 account_summary/holding | `extractionRowSchema` enum 限制 + `PORTFOLIO_MCP_SCREENSHOT_*` 错误码 | ✓ |
| 复盘必须先预检 | `portfolio_review_preflight` → `portfolio_review_start` 二次预检 | ✓ |
| 真实 LLM 失败不冒充 | 由 backend 业务服务保障；MCP 层不引入新 LLM 路径 | ✓ |

---

## 3. 实现质量

### 3.1 强项

1. **官方 MCP SDK**: 使用 `@modelcontextprotocol/sdk`（`McpServer` / `StreamableHTTPServerTransport` / `Client` / `InMemoryTransport`），不是自造 JSON 行协议。
2. **Streamable HTTP 2025 规范兼容**: 不再用已被 MCP 2025-03 标记 legacy 的 `SSETransport`+HTTP+SSE 组合；新实现是 stateless `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`，符合 MCP 2025-06 规范。
3. **Bearer 哈希令牌**: `portfolioMcpAuthService` 用 SHA-256 哈希存 `McpAccessToken.tokenHash`，明文 token 仅在 `createToken()` 返回时显示一次；测试前后清理。
4. **Origin 白名单**: `validateOrigin()` 仅放行 `FAMS_MCP_ALLOWED_ORIGINS` env 列举的 origin；空 origin 允许（与 ChatGPT 等无 origin 的 fetch 兼容，但建议在文档中说明）。
5. **Scope 强制**: 每个工具通过 `requireScope(principal, scope, handler)` 强制鉴权；缺 scope 返回 `MCP_SCOPE_REQUIRED` 错误码。
6. **限流**: `assertRateLimit()` 基于 tokenId 或 subject，每 60 秒滑动窗口，默认 60/分钟；超限返回 429 `MCP_RATE_LIMIT_EXCEEDED`。
7. **敏感 schema 拒绝**: `extractionRowSchema` 与 `PORTFOLIO_MCP_SCREENSHOT_ROWS_MUST_BE_HOLDINGS_ONLY` 错误码阻断 trade/order 行。
8. **错误隔离**: `errorResult()` 把内部堆栈截到 500 字符且按错误码分支，不暴露 SQL 路径或 provider secret。
9. **沙盒边界**: 公开 portfolio server 仅 10 个工具；legacy registry.ts 的 transaction 创建工具被显式排除在 portfolio manifest 外（见 portfolio-management-mcp.json 的 `executionBoundary.brokerOrderToolsExposed: false`）。
10. **真实 DB 验证**: `verify-public-portfolio-mcp.ts` 创建隔离用户 → 跑完整 10 工具 → 删除 fixture；验证后 protected 表计数不变。

### 3.2 弱项 / 必须显式登记

| 编号 | 问题 | 严重度 | 建议 |
| --- | --- | ---: | --- |
| **MCP-Q-01** | `McpAccessToken` 表靠 `portfolioMcpAuthService.ensureStorage()` 在 `executeRawUnsafe` 中运行 `CREATE TABLE IF NOT EXISTS`，**Prisma schema 中无对应 model**（仅在 `portfolioMcpAuthService.ts:91` 用 `prisma.mcpAccessToken.create`）；若迁移到新环境未调用该方法，第一次 `authenticateBearer` 会失败 | 中 | 把 `McpAccessToken` model 加入 `prisma/schema.prisma`，迁移到正式 Prisma migration |
| **MCP-Q-02** | legacy `mcp/index.ts`（`/api/v1/mcp`）的 4 个端点仍可路由，工具集 40+ 暴露，且未走 Bearer 鉴权；只靠 header `x-fams-user-id` | 中 | 在 `/api/v1/mcp` 增加 deprecation header `Deprecation: true`，并在 `harnessos-connector.json`/`fams-domain-pack.json` 标注 deprecated；移除 `x-user-id` fallback 来源，只保留 `x-fams-user-id` |
| **MCP-Q-03** | portfolio server `successResult().content[0].text` 把 `Number(value.totalValue || 0).toFixed(2)` 直接拼入文本，且 `portfolio_get_current_state` 的 `summarize` 把"总市值"放在 text 中——这意味着 AI 宿主可能把账户金额直接回显给用户，与"公开审计不落盘账户金额"边界冲突 | 中 | 把汇总文案改为"已读取 N 个持仓；金额请在 structuredContent 中按需求展示"，避免默认把金额渲染为用户可见自然语言 |
| **MCP-Q-04** | `portfolioHttp.ts` 每次请求 `createPublicPortfolioMcpServer(principal)` + `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`，**没有复用 server 或 transport**——每次请求都重新构建实例。在高频调用场景下这是性能浪费 | 中 | 提取 `buildMcpServerForPrincipal(principal)` 并缓存单例；或至少缓存 transport |
| **MCP-Q-05** | `verify-public-portfolio-mcp.ts` / `verify-public-portfolio-mcp-stdio.ts` / `verify-public-portfolio-mcp-http.ts` 三个脚本的引导几乎相同（init Prisma → run scenario → teardown），目前分别独立运行；可在 5 分钟内合并为单一 orchestrator | 低 | 引入 `verify-public-portfolio-mcp-{in-memory,stdio,http}` 三档但共享 helper |
| **MCP-Q-06** | `registry.ts` 1859 行单文件，承载工具定义/handler/权限元数据/scope 校验/envelope 构造——是合法"中心注册表"，但拆分为 `tools/registry/{domain}.ts` 更易维护 | 低 | 当工具 > 50 时再拆，目前可接受 |
| **MCP-Q-07** | `publicPortfolioServer.ts` 与 `server.ts` 都创建 `McpServer` 并独立注册工具；二者之间没有共享"工具元数据 schema 生成器"——重复定义 zod schema | 低 | 提取 `toolDefinitions.ts` 共享 zod schema 与权限元数据 |
| **MCP-Q-08** | `npx serve` 风格的 `npm run mcp:portfolio-stdio` 没有 `npx -y` 保护：若 `node_modules` 缺失或 `tsx` 不在工作树，会直接失败；文档未列出预构建步骤 | 低 | README 增加 `npm install && npm run build` 前置步骤 |
| **MCP-Q-09** | `McpAccessToken` 表使用 `prisma.mcpAccessToken.create`，但 `portfolioMcpAuthService` 没注册到 Prisma client 的 runtime types；TypeScript 类型可能依赖 generated 但实际 schema 未声明 | 中 | 见 MCP-Q-01，必须先把 model 加到 prisma schema |
| **MCP-Q-10** | `npm audit --omit=dev` 报 21 条生产依赖告警（0 critical / 12 high / 8 moderate / 1 low），acceptance report 自述"未直接归因于新增 MCP SDK"——但 SDK 升级可能引入新告警，需要在 `npm audit` baseline 中跟踪 | 中 | 把 `npm audit` baseline 写入 contracts/MCP_SECURITY_BASELINE.md，每次升级 SDK 后复跑 |

---

## 4. 技术路线

### 4.1 协议选型

```text
MCP 2025-06 规范:
  - Streamable HTTP (stateless, POST-only JSON-RPC)
  - Stdio JSON-RPC
  - 取消使用 SSE-only legacy transport
```

**评估**:
- ✓ 使用 `@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`，是 stateless 模式（每次请求新 server，符合 2025-06 规范的"stateful session server"+"stateless per-request server"两种合法模式）
- ✓ 不再使用 `SSEServerTransport`
- ✗ 但是**未启用 stateful session**——这意味着若 AI 宿主需要"持久订阅"或"长连接"，当前实现不支持。建议在 M5 阶段补 `sessionIdGenerator: () => randomUUID()` 路径供可选启用。

### 4.2 身份与边界

```text
1. userId 注入:
   - stdio: FAMS_MCP_USER_ID (required, throw if missing) 或 FAMS_MCP_DEFAULT_USER_ID
   - streamable_http: Bearer token → SHA-256 查表 → PortfolioMcpPrincipal.userId
   - legacy http: header x-fams-user-id / x-user-id (任意头传递，弱)
2. 参数与上下文冲突:
   - registry.ts resolveUserContext(): parameterUserId vs contextUserId 不一致 → USER_CONTEXT_MISMATCH (403)
3. Scope 检查:
   - requireScope() in registry.ts 与 portfolioHttp.ts 都使用
4. 限流:
   - portfolio MCP: 60/min/token (env 可调)
   - legacy stdio: 无限流
```

### 4.3 数据所有权

| 数据 | 所有者 | 存储 |
| --- | --- | --- |
| 业务事实（仓位/复盘/截图/Operation/AdviceExecution） | FAMS Prisma | 主库 |
| 公开 portfolio 审计 / 决策记录 | FAMS Prisma | 主库（`executedAt=null` 表明是决策而非成交） |
| MCP 访问令牌 | SHA-256 hash | `McpAccessToken` 表 |
| 限流计数 | in-memory `Map` | 进程内（**重启即丢失**，建议加注释或持久化） |

### 4.4 错误契约

`publicPortfolioServer.ts` `errorResult()` 把错误分为 3 类：
1. **业务阻断**（retryable=false）：`MCP_SCOPE_REQUIRED` / `PORTFOLIO_REVIEW_IDEMPOTENCY_USER_CONFLICT` / `PORTFOLIO_MCP_SCREENSHOT_ROWS_MUST_BE_HOLDINGS_ONLY` / `PORTFOLIO_MCP_SCREENSHOT_CONFIRM_HOLDINGS_ONLY`
2. **可重试**：其他错误（网络/超时）
3. **隐内部**：`PORTFOLIO_MCP_INTERNAL_ERROR` 不暴露细节

`registry.ts` 错误格式 `fams.mcp.call.v1` envelope 是另一套；**两套错误格式不统一**。建议统一为 `fams.mcp.error.v1` + envelope。

---

## 5. 视觉部分冗余检查（重点回应用户问题）

> **检索声明**: 本节专门验证"是否有冗余 UI 实现"。

### 5.1 前端 MCP 组件盘点

```
$ ls /mnt/c/workSpace/financial-asset-manager/frontend/src/components/
$ find /mnt/c/workSpace/financial-asset-manager/frontend/src -name "*MCP*" -o -name "*Mcp*" -o -name "*mcp*"
（结果为空）
```

**结论**: **前端 0 个 MCP 组件**。MCP 是 AI 宿主（ChatGPT / Claude / 自定义客户端）通过 stdio 或 HTTP 调用的协议，不是给人直接看的 UI。

### 5.2 与 V2-PX 视觉的边界

`frontend/src/components/external-brain/OpenInExternalBrainButton.tsx` 是 V2-PX 的"在外部大脑打开"按钮，**与 MCP 无关**：
- 不调 `/api/v1/mcp`
- 不调 `/mcp`
- 不暴露任何 MCP tool 给用户
- 仅调 `chrome.runtime.sendMessage` 给 V2-PX extension

**结论**: V2-PX UI 与 MCP 视觉正交，无冗余。

### 5.3 历史 UI 残留扫描

CLAUDE.md 提到的早期 `/api/v1/mcp` 路径与"通用 MCP UI"曾被规划，但实际仓库内**无 frontend UI 组件**调用 MCP endpoints（`grep -E "mcp|MCP"` 仅返回 `OpenInExternalBrainButton.tsx` 的 0 个匹配）。这意味着：
- 早期若有 UI 计划已被砍
- 没有"看不见的 UI 重复实现"

### 5.4 视觉冗余结论

```text
human_visual_implementations=0
human_visual_redundancy=0
explanation=MCP 是 AI-to-AI 协议，不存在给人看的 UI。
            因此本审计无法找到视觉部分的冗余实现——因为根本没有视觉实现。
```

**对用户问题的直接回答**: 视觉部分**没有冗余实现**，因为本项目 MCP 服务的视觉部分**不存在**。MCP 服务的所有功能都通过 stdin/stdout 消息或 HTTP JSON-RPC 返回，由 AI 宿主（ChatGPT/Claude）渲染给人。

---

## 6. 但存在其他类型的"冗余"——传输层 / 脚本层

虽然视觉无冗余，但 MCP 的**传输层和脚本层**有可识别的结构重复：

### 6.1 传输入口冗余

| 入口 | 工厂 | 用途 |
| --- | --- | --- |
| `stdio.ts` | `createFamsMcpServer`（legacy registry） | volatility / full profile stdio |
| `portfolioStdio.ts` | `createPublicPortfolioMcpServer`（新 portfolio server） | portfolio stdio |
| `streamableHttp.ts` | `createFamsMcpServer`（legacy registry） | volatility streamable_http on 4010 |
| `portfolioHttp.ts` | `createPublicPortfolioMcpServer`（新 portfolio server） | portfolio HTTP on 4000 |

**结论**: 4 个入口分属 2 套 server 工厂（legacy + new portfolio），每套有 stdio 和 HTTP。**这不是冗余**，因为：
- legacy 服务于 volatility/full profile（保留兼容性）
- new 服务于 portfolio（更严格的安全模型）

但**风险**: 两套 server 实例并存会增加维护成本——错误修复可能漏掉其中一套。建议在 M5 把两套统一为单一 server factory + profile 配置。

### 6.2 HTTP 路由冗余

| 路径 | router | 用途 |
| --- | --- | --- |
| `/api/v1/mcp/{domain-pack,tools,call,batch}` | `mcp/index.ts` | legacy HTTP bridge（自造 JSON-RPC，非官方 SDK 协议） |
| `/mcp` | `portfolioHttp.ts` | Streamable HTTP（官方 MCP 2025 协议） |

**结论**: **部分冗余**。`/api/v1/mcp/*` 用自造 JSON-RPC，**不是官方 MCP 协议**——任何 AI 宿主 MCP client 都不能直接调用它。它仅服务于"使用 harnessos / 自家前端"的特殊场景。**建议在 M5 把 `/api/v1/mcp` 标记 deprecated，并迁移所有 client 到 `/mcp` Streamable HTTP**。

### 6.3 配置文件冗余

| 配置 | 内容 | 重叠度 |
| --- | --- | --- |
| `financial-mcp.json` | 3 个 stdio servers（portfolio/research/volatility） | 与 portfolio-management-mcp.json 部分重叠（portfolio 部分） |
| `portfolio-management-mcp.json` | portfolio 单一 manifest | 与 financial-mcp.json 的 portfolio 块重复 |
| `fams-domain-pack.json` | 完整 domain pack（含 50+ tools） | 与 harnessos-connector.json 的 canonicalTools 重复 |
| `harnessos-connector.json` | 3 个 connector + 完整 capabilities | 与 financial-mcp.json 与 fams-domain-pack.json 部分重叠 |

**结论**: **配置间存在内容重复**，但每个配置的"用途"不同：
- `financial-mcp.json` = MCP client 直读
- `portfolio-management-mcp.json` = 公开 manifest（受保护）
- `fams-domain-pack.json` = domain pack 静态描述
- `harnessos-connector.json` = harnessos 适配描述

**建议**: 在 M5 引入单一 source of truth（`portfolio-management-mcp.json`），其他配置从其生成；或显式声明每个配置的责任边界（哪些字段必须人工维护、哪些自动生成）。

### 6.4 验证脚本冗余

| 脚本 | 范围 | 与其他脚本重叠 |
| --- | --- | --- |
| `verify-public-portfolio-mcp.ts` | SDK InMemory + 真实 DB | 与 stdio/http 脚本共享引导 |
| `verify-public-portfolio-mcp-stdio.ts` | stdio 子进程 | 同上 |
| `verify-public-portfolio-mcp-http.ts` | HTTP 握手 | 同上 |
| `verify-volatility-mcp-protocol.ts` | volatility 协议 | 与 stdio/http 重叠 |
| `verify-volatility-mcp-stdio.ts` | volatility stdio | 与 protocol 重叠 |
| `verify-volatility-mcp-http.ts` | volatility HTTP | 同上 |

**结论**: 3 + 3 = 6 个 MCP 验证脚本，引导（init Prisma → run scenarios → teardown）几乎相同。**可以合并为 2 个 orchestrator，每个 orchestrator 跑 3 个 transport 变体**。这是低优先级优化。

### 6.5 server 工厂代码冗余

| 工厂 | 重复模式 |
| --- | --- |
| `server.ts` (424 行) | zod schema + permission metadata + scope check + envelope |
| `publicPortfolioServer.ts` (357 行) | zod schema + permission metadata + scope check + envelope |

**结论**: **结构上重复**，但内容不同（不同工具集、不同 scope 模型）。建议在 M5 提取 `createMcpServerWithDefinitions(server, definitions, opts)` 共享底层。

---

## 7. 反假绿/隐私/交易边界评估（沿用本审计框架）

| 防线 | 证据 | 评估 |
| --- | --- | --- |
| 不创建 Transaction | verify-public-portfolio-mcp 前后 count 一致 + `plan_save_decision` 只写 AdviceExecution | ✓ |
| 不解锁 autoTrade | `executionBoundary` 4 锁 false + portfolio-management-mcp.json 显式声明 | ✓ |
| 不暴露券商订单工具 | portfolio manifest 10 工具无 create_transaction | ✓ |
| 截图只允许 account_summary/holding | extractionRowSchema enum + 错误码 PORTFOLIO_MCP_SCREENSHOT_* | ✓ |
| 不暴露 provider secret | 错误截 500 字符 + `McpAccessToken` 存 SHA-256 hash | ✓ |
| 真实数据库读取 | verify-public-portfolio-mcp.ts 跑真实 default DB 9 项仓位 | ✓ |
| Bearer 校验 | `authenticateBearer` + 401 路径 | ✓ |
| Origin 白名单 | `validateOrigin` + 403 路径 | ✓ |
| 限流 | `assertRateLimit` + 429 路径 | ✓ |
| 撤销令牌 | `revokeToken` + 401 路径 | ✓ |
| 摘要脱敏 | portfolio `summarize` 把金额拼接 → ⚠️ 违反 §5.3 (MCP-Q-03) | ⚠️ |
| 公开审计不落盘 | acceptance 报告显式声明 | ✓ |

---

## 8. 风险评估

| 编号 | 风险 | 可能性 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| **R-MCP-01** | legacy `/api/v1/mcp` 与新 `/mcp` 双轨长期并存 | 高 | 中 | M5 加 Deprecation header + 文档化迁移路径 |
| **R-MCP-02** | `McpAccessToken` 未进 Prisma schema，新环境首次跑可能失败 | 中 | 中 | 迁移到正式 Prisma model |
| **R-MCP-03** | portfolio server 摘要文案泄露金额到自然语言 | 中 | 中 | MCP-Q-03 修复 |
| **R-MCP-04** | portfolio HTTP 每次请求新建 server/transport 性能浪费 | 低 | 低 | 缓存单例 |
| **R-MCP-05** | 限流窗口 in-memory，重启即失效 | 中 | 低 | 文档化或持久化到 Redis |
| **R-MCP-06** | 4 套配置文件重复且无 SSOT | 中 | 中 | M5 引入 SSOT |
| **R-MCP-07** | 6 个验证脚本引导重复 | 低 | 低 | 合并 orchestrator |
| **R-MCP-08** | `npm audit` 21 条生产告警未跟进 | 中 | 中 | contracts/MCP_SECURITY_BASELINE.md |
| **R-MCP-09** | Streamable HTTP 不支持 stateful session | 低 | 低 | M5 加可选 stateful 路径 |
| **R-MCP-10** | `volatility` profile 仅靠 `FAMS_MCP_DEFAULT_USER_ID` 注入 userId，无 Bearer | 高 | 中 | 复用 portfolio 的 Bearer/Scope 模式 |

---

## 9. 最终独立审计建议

```text
overall_implementation_quality=HIGH（生产可接受）
implementation_scope=3_profiles_plus_legacy_bridge
technical_route=OFFICIAL_MCP_SDK_2025_COMPLIANT
visual_part=NOT_APPLICABLE（MCP 无 human UI）
visual_redundancy=NO_REDUNDANCY_BECAUSE_NO_VISUAL
```

### 不替用户决定的事项

按 CLAUDE.md：
1. **是否把 `/api/v1/mcp` 标记 deprecated 并迁移 client 到 `/mcp`**：由产品/架构决定，**本审计不替用户做产品决策**。
2. **是否把 `McpAccessToken` model 正式加入 Prisma schema**：影响所有依赖 Prisma generate 的下游代码，需一次性迁移，**由用户决定时机**。
3. **是否在 M5 引入 stateful Streamable HTTP**：影响 ChatGPT 等宿主的能力，**由用户/产品决定**。

### 必须显式披露的事项

| 项 | 当前披露位置 | 完整度 |
| --- | --- | --- |
| 不替代 ChatGPT OAuth 远程发布 | `PORTFOLIO_MCP_SERVICE.md` §"受保护的 HTTP 接入" | ✓ |
| 不替代正式交易发布 | `AUDITS/2026-09-12-portfolio-mcp/ACCEPTANCE_AUDIT.md` | ✓ |
| `npm audit` 21 条告警阻断公网发布 | 同上 | ✓ |
| 真实数据库依赖（需 default 用户本地 DB） | `PORTFOLIO_MCP_SERVICE.md` §"本地接入" | ✓ |
| 公开审计不落盘账户金额 | acceptance + PRD_SPEC_REVIEW | ✓（但 MCP-Q-03 警告仍有路径违反） |

---

## 10. 检索声明汇总

本审计在以下文件中检索了事实：

1. **MCP 入口**: `backend/src/mcp/{stdio,portfolioStdio,streamableHttp,portfolioHttp,index}.ts`
2. **MCP server**: `backend/src/mcp/{registry,server,publicPortfolioServer}.ts`
3. **MCP 服务**: `backend/src/services/mcp/{portfolioWorkflowFacade,portfolioMcpAuthService}.ts`
4. **MCP 配置**: `mcp/{financial-mcp,portfolio-management-mcp,fams-domain-pack,harnessos-connector}.json`
5. **MCP 文档**: `docs/PORTFOLIO_MCP_SERVICE.md`、`docs/VOLATILITY_MCP_SERVICE.md`
6. **MCP 验证**: `backend/scripts/verify-public-portfolio-mcp*.ts` + `backend/scripts/verify-volatility-mcp-*.ts` + `backend/scripts/verify-relative-rotation-mcp.ts`
7. **MCP 测试命令**: `backend/package.json` 中 4 个 `test:*mcp*` 入口
8. **MCP 迁移**: `backend/prisma/manual-migrations/20260912_public_portfolio_mcp.sql`
9. **MCP 审计**: `docs/audits/2026-09-12-portfolio-mcp/{ACCEPTANCE_AUDIT,DEVELOPMENT_AND_ACCEPTANCE_PLAN,PRD_SPEC_REVIEW}.md`
10. **前端 MCP UI**: `frontend/src/components/*`（结果：无 MCP 组件）

---

> **审计签名**: MiniMax-M3，2026-09-12，独立视角
> **后续行动**: 等待用户就 MCP-Q-01～Q-10 与 R-MCP-01～R-MCP-10 做出指示；不主动修改任何 MCP 配置文件、schema、代码或文档。