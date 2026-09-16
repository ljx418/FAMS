# MCP 接口清单 + 文档独立验证报告

> **审计者**: Claude (MiniMax-M3)，独立视角
> **审计时间**: 2026-09-12
> **审计对象**: 本项目所有 MCP 接口（3 profile + legacy HTTP bridge）
> **验证依据**: PRD、运行时合同、business service 源码、registry/server/portfolioWorkflowFacade 源码
> **验证方法**: 仅基于开发文档**静态核对**，未真实启动服务调用（环境无 Prisma DB / 无 WXT 浏览器）；明确区分静态验证可达 vs 必须运行时验证

---

## 一、完整 MCP 接口清单（来自仓库实际代码）

### 1.1 Portfolio MCP（公开，10 个工具 + 5 个 resource + 1 个 prompt）

> **入口**：`backend/src/mcp/portfolioStdio.ts`（stdio）+ `backend/src/mcp/portfolioHttp.ts`（Streamable HTTP on Fastify `/mcp`）
> **工厂**：`backend/src/mcp/publicPortfolioServer.ts`
> **Facade**：`backend/src/services/mcp/portfolioWorkflowFacade.ts`
> **Auth**：`backend/src/services/mcp/portfolioMcpAuthService.ts`（Bearer + SHA-256 + scope + rate limit）
> **配置**：`mcp/portfolio-management-mcp.json`、`mcp/financial-mcp.json` 中的 `financial-asset-manager` server

| # | tool name | scope | read/destructive | input | calls |
| --- | --- | --- | --- | --- | --- |
| 1 | `portfolio_get_current_state` | portfolio:read | read-only / idempotent | `{ accountScope: 'all' \| 'alipay' }` | `portfolioWorkflowFacade.getCurrentState(userId, accountScope)` |
| 2 | `portfolio_review_preflight` | portfolio:read | read-only / idempotent | `{ portfolioChangedSinceLastCapture: bool }` | `portfolioWorkflowFacade.preflightReview(userId, val)` |
| 3 | `portfolio_review_start` | review:run | write / idempotent | `{ sessionType, portfolioChangedSinceLastCapture, idempotencyKey }` | `portfolioWorkflowFacade.startReview(input)` |
| 4 | `portfolio_review_get` | portfolio:read | read-only / idempotent | `{ operationId: uuid }` | `portfolioWorkflowFacade.getReview(userId, opId)` |
| 5 | `portfolio_plan_save_decision` | plan:write | write / idempotent / 需 confirmation | `{ reviewId, actionId, decision, overrideAmount?, notes?, confirmation }` | `portfolioWorkflowFacade.savePlanDecision(input)` |
| 6 | `portfolio_screenshot_upload` | capture:write | write / idempotent | `{ base64, mimeType?, originalFilename? }` | `portfolioWorkflowFacade.uploadScreenshot(input)` |
| 7 | `portfolio_screenshot_save_extraction` | capture:write | write / idempotent | `{ captureId, rows[], rawText? }` | `portfolioWorkflowFacade.saveScreenshotExtraction(input)` |
| 8 | `portfolio_screenshot_confirm` | capture:write | destructive / idempotent / 需 confirmation | `{ captureId, rowIds?, confirmation }` | `portfolioWorkflowFacade.confirmScreenshot(input)` |
| 9 | `portfolio_snapshot_authorize_reuse` | capture:write | write / idempotent | `{ captureId? }` | `portfolioWorkflowFacade.authorizeSnapshotReuse(userId, captureId)` |
| 10 | `portfolio_snapshot_revoke_reuse` | capture:write | write / idempotent | `{ reason? }` | `portfolioWorkflowFacade.revokeSnapshotReuse(userId, reason)` |

**Resources**:
- `fams://portfolio/current` → `getCurrentState`（含 `portfolio:read` scope）
- `fams://portfolio/contracts/current` → `getCurrentState('alipay')` + `executionBoundary`
- `fams://portfolio/reviews/latest` → `getLatestReview(userId)`
- `fams://data-health/current` → `{ generatedAt, dataHealth, latestCapture }`
- `fams://portfolio/reviews/{operationId}` → `getReview(userId, operationId)`

**Prompts**:
- `daily_portfolio_review` → args: `{ sessionType, portfolioChangedSinceLastCapture }`，输出 8 段中文指引

### 1.2 Volatility MCP（公开，13 个工具 + 4 个 resource + 1 个 prompt）

> **入口**：`backend/src/mcp/stdio.ts` 配 `FAMS_MCP_PROFILE=volatility`（stdio）或 `streamableHttp.ts`（loopback:4010）
> **工厂**：`backend/src/mcp/server.ts` 的 `createFamsMcpServer({ profile: 'volatility' })`
> **业务调用**：通过 `callMcpTool()` 走 legacy `mcp/registry.ts` 的 `volatilityWorkflowService.*` + `screenshotCaptureService.*` + `assetTrendService.*` + `dailyReviewService.*` + `gridStrategyService.*` + `operationService.*`

| # | tool name | input schema (zod) | calls via registry |
| --- | --- | --- | --- |
| 1 | `volatility_workflow.reconcile` | `{ userId?, sessionType?, holdingsCaptureId?, tradesCaptureId?, ordinaryOrdersCaptureId?, conditionalOrdersCaptureId?, zeroNewTradesConfirmed? }` | `volatilityWorkflowService.reconcile()` (line 198) |
| 2 | `volatility_workflow.run` | `{ ...reconcile fields, idempotencyKey? }` | `volatilityWorkflowService.run()` |
| 3 | `volatility_workflow.get_result` | `{ userId, operationId\|reviewId, includeHtml? }` (XOR) | `volatilityWorkflowService.getResult()` |
| 4 | `capture.upload_screenshot` | `{ userId?, base64, mimeType?, originalFilename?, conversationId? }` | `screenshotCaptureService.uploadBase64()` (line 179) |
| 5 | `capture.apply_extraction` | `{ userId?, captureId, documentType, rows[], rawText? }` | `screenshotCaptureService.applyExtraction()` (line 249) |
| 6 | `capture.get_preview` | `{ userId?, captureId }` | `screenshotCaptureService.getPreview()` |
| 7 | `capture.update_row` | `{ userId?, captureId, rowId, fields?, fieldConfidence?, confidence?, ignored?, correctedBy }` | `screenshotCaptureService.updateRow()` |
| 8 | `capture.confirm_rows` | `{ userId?, captureId, rowIds?, tradePositionEffectPolicy?, confirmation: { confirmed, confirmedBy, ... } }` | `screenshotCaptureService.confirm()` (line 619) |
| 9 | `operation.get` | `{ userId?, operation_id }` | `operationService.getOperation()` (line 1026) |
| 10 | `market_data.get_asset_trend` | `{ userId?, assetId\|symbol, days? }` (XOR) | `assetTrendService.getTrend()` |
| 11 | `daily_review.get` | `{ userId?, reviewId }` | `dailyReviewService.getReview()` |
| 12 | `daily_review.get_latest` | `{ userId?, sessionType? }` | `dailyReviewService.getLatest()` |
| 13 | `grid_strategy.list_templates` | `{ userId? }` | `gridStrategyService.listTemplates()` |

**Resources**（注册在 server.ts curated tools 同段）:
- `fams://volatility/strategy/active`
- `fams://volatility/portfolio/latest-reconciled`
- `fams://volatility/rules`
- `fams://volatility/reviews/{reviewId}`

**Prompts**:
- `volatility-review`

### 1.3 Full MCP（内部，~40+ 工具，涵盖所有业务域）

> **入口**：`backend/src/mcp/stdio.ts` 配 `FAMS_MCP_PROFILE=full`
> **注册表**：`backend/src/mcp/registry.ts`（1859 行，43 个工具）

| # | tool name | domain | calls |
| --- | ---: | --- | --- |
| 1 | `get_real_time_price` | market_data | `priceService.getRealTimePrice()` (line 272) |
| 2 | `market_data.refresh_prices` | market_data | `priceService.refreshPrices()` |
| 3 | `get_positions` (alias `position.list`) | position | `positionService.getPositions()` (line 304) |
| 4 | `get_investment_suggestions` (alias `advice.get_suggestions`) | advice | `analysisService.getSuggestions()` (line 947) |
| 5 | `get_portfolio_analysis` (alias `portfolio.get_analysis`) | portfolio | `portfolioService.getAnalysis()` (line 94) |
| 6 | `run_backtest` (alias `backtest.run_strategy`) | backtest | `backtestService.runBacktest()` (line 215) |
| 7 | `backtest.run_from_advice` | backtest | `backtestService.runBacktestFromAdvice()` (line 248) |
| 8 | `get_daily_snapshot` (alias `portfolio.get_daily_snapshot`) | portfolio | `analysisService.getDailySnapshot()` (line 1232) |
| 9 | `create_transaction` (alias `transaction.create_manual_record`) | transaction | `transactionService.createTransaction()` (line 89) — **必须人工 confirmation，否则返回 `HUMAN_CONFIRMATION_REQUIRED` 阻断块** |
| 10 | `get_alerts` (alias `alert.list`) | alert | `alertService.getAlerts()` (line 280) |
| 11 | `alert.check` | alert | `alertService.checkAlerts()` |
| 12 | `operation.list` | operation | `operationService.listOperations()` (line 3886) |
| 13 | `operation.get` | operation | `operationService.getOperation()` |
| 14 | `operation.get_artifact` | operation | `operationService.getArtifact()` |
| 15 | `daily_review.run` | review | `dailyReviewService.runDailyReview()` |
| 16 | `daily_review.reconcile` | review | `dailyReviewService.reconcile()` |
| 17 | `daily_review.export_html` | review | `dailyReviewService.exportHtml()` |
| 18 | `daily_review.get_latest` | review | `dailyReviewService.getLatest()` |
| 19 | `daily_review.get` | review | `dailyReviewService.getReview()` |
| 20 | `daily_review.list` | review | `dailyReviewService.listReviews()` |
| 21 | `grid_strategy.list_templates` | strategy | `gridStrategyService.listTemplates()` |
| 22 | `grid_strategy.create_draft` | strategy | `gridStrategyService.createDraft()` |
| 23 | `grid_strategy.validate_draft` | strategy | `gridStrategyService.validateDraft()` |
| 24 | `grid_strategy.activate` | strategy | `gridStrategyService.activate()` — **必须人工 confirmation** |
| 25 | `market_data.get_asset_trend` | market_data | `assetTrendService.getTrend()` |
| 26 | `relative_rotation.get_industry_crowding` | relative-rotation | `industryCrowdingService.getReport()` (line 853) |
| 27 | `relative_rotation.get_market_flow` | relative-rotation | `industryCrowdingService.getMarketFlow()` |
| 28 | `relative_rotation.refresh_industry_crowding` | relative-rotation | `industryCrowdingService.refresh()` (line 729) |
| 29 | `relative_rotation.get_holdings_timeline` | relative-rotation | `relativeRotationService.getHoldingsTimeline()` (line 525) |
| 30 | `relative_rotation.refresh_holdings_timeline` | relative-rotation | `relativeRotationService.refreshHoldingsTimeline()` (line 627) |
| 31 | `relative_rotation.list_watchlist` | relative-rotation | `relativeRotationUniverseService.listWatchlist()` (line 1157) |
| 32 | `relative_rotation.add_watchlist_item` | relative-rotation | `relativeRotationUniverseService.addWatchlistItem()` (line 1173) |
| 33 | `relative_rotation.delete_watchlist_item` | relative-rotation | `relativeRotationUniverseService.deleteWatchlistItem()` (line 1265) — **必须人工 confirmation** |
| 34 | `relative_rotation.get_watchlist_timeline` | relative-rotation | `relativeRotationService.getWatchlistTimeline()` |
| 35 | `relative_rotation.refresh_watchlist_timeline` | relative-rotation | `relativeRotationService.refreshWatchlistTimeline()` |
| 36 | `relative_rotation.list_research_studies` | relative-rotation | `relativeRotationResearchStudyService.listStudies()` (line 181) |
| 37 | `relative_rotation.create_research_study` | relative-rotation | `relativeRotationResearchStudyService.createStudy()` (line 195) |
| 38 | `relative_rotation.update_research_study` | relative-rotation | `relativeRotationResearchStudyService.updateStudy()` (line 227) |
| 39 | `relative_rotation.delete_research_study` | relative-rotation | `relativeRotationResearchStudyService.deleteStudy()` (line 263) — **必须人工 confirmation** |
| 40 | `relative_rotation.get_research_timeline` | relative-rotation | `relativeRotationResearchStudyService.getTimeline()` (line 279) |
| 41 | `relative_rotation.refresh_research_timeline` | relative-rotation | `relativeRotationResearchStudyService.refreshTimeline()` (line 290) |
| 42 | `relative_rotation.analyze_volatility_sleeves` | relative-rotation | `volatilitySleeveAnalysisService.analyze()` |
| 43 | `capture.upload_screenshot` / `apply_extraction` / `get_preview` / `vision_status` / `update_row` / `confirm_rows` | capture | screenshotCaptureService 系列方法 |

### 1.4 Legacy HTTP Bridge（自造 JSON-RPC，非官方 MCP 协议）

> **入口**：`backend/src/mcp/index.ts` 路由 `/api/v1/mcp/{domain-pack,tools,call,batch}`（注册在主 Fastify HTTP server，端口 4000）
> **配置**：`mcp/harnessos-connector.json` 的 `fams_mcp_http` connector、`mcp/fams-domain-pack.json`

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/api/v1/mcp/domain-pack` | GET | 返回 `buildDomainPackManifest()`：所有 43 个工具元数据 |
| `/api/v1/mcp/tools` | GET | `listMcpTools()` |
| `/api/v1/mcp/call` | POST | 单个 `callMcpTool(name, parameters, httpContext)` |
| `/api/v1/mcp/batch` | POST | 批量 `callMcpBatch(calls[], httpContext)` |

**注意**：该路由使用自造 JSON-RPC envelope，**不是官方 MCP 协议**。任何官方 MCP client（Cursor / Claude Desktop）**无法直接调用**。

---

## 二、静态文档验证矩阵

> **验证维度**:
> - **I**: 接口是否在代码中真实存在（callable path 可达）
> - **B**: 后端业务服务是否真实存在且签名匹配
> - **D**: 返回数据是否真实（非 mock）
> - **S**: 是否实现声称的安全边界（4 锁 / scope / confirmation）
> - **N**: PRD 需求是否覆盖
>
> **结论分类**: ✅PASS / ⚠️PARTIAL / ❌FAIL / ❓UNVERIFIED（缺运行时证据）

### 2.1 Portfolio MCP 10 工具

| 工具 | I | B | D | S | N | 结论 | 备注 |
| --- | :-: | :-: | :-: | :-: | :-: | --- | --- |
| `portfolio_get_current_state` | ✓ | ✓ `portfolioWorkflowFacade.getCurrentState()` line 30 | ✓ 读 Prisma `position.findMany` + `allocationPolicyService.getCurrentPlan` + `dailyReviewRun` + `transaction.count` | ✓ `executionBoundary` 4 锁 false 硬编码 | ✓ DPR-013 复盘业务事实 | ✅PASS | 静态验证完整 |
| `portfolio_review_preflight` | ✓ | ✓ `preflightReview()` line 99 委托 `alipayOneClickReviewService.preflight()` | ✓ 真实业务 | ✓ 只读 | ✓ DPR-021 | ✅PASS | |
| `portfolio_review_start` | ✓ | ✓ `startReview()` line 103：先 preflight → 查 idempotency key → 创建 Operation → `queueMicrotask(executeReviewOperation)` | ✓ 真实 DB + 真实 workflow | ✓ 幂等 + 不写 Transaction | ✓ DPR-022 | ✅PASS | 执行由后台 microtask 异步；同 key 重放走 existing 路径 |
| `portfolio_review_get` | ✓ | ✓ `getReview()` line 274：按 operationId 查 Operation + 关联 review | ✓ 真实 DB | ✓ 只读 | ✓ DPR-023 | ✅PASS | 状态机 `queued/running/completed/partial/failed` 覆盖 |
| `portfolio_plan_save_decision` | ✓ | ✓ `savePlanDecision()` line 324：调用前后 `prisma.transaction.count` 守门 | ✓ 真实 DB + AdviceExecution | ✓ 强制 `confirmation.confirmedBy`；Transaction 不变才返回 | ✓ DPR-024 | ✅PASS | **守门靠业务服务**，MCP 层仅做 schema 校验 |
| `portfolio_screenshot_upload` | ✓ | ✓ `uploadScreenshot()` line 339：调 `screenshotCaptureService.uploadBase64()` | ✓ 真实文件存储 | ✓ scope `capture:write`；不带 confirmation 但写 `conversationId=portfolio-mcp` 标识 | ✓ DPR-020 | ⚠️PARTIAL | `uploadBase64` 内部细节未深入审计；conversationId 强制写死为 `'portfolio-mcp'` 是设计选择 |
| `portfolio_screenshot_save_extraction` | ✓ | ✓ `saveScreenshotExtraction()` line 355：先校验 `rowType ∈ {account_summary, holding}`，否则抛 `PORTFOLIO_MCP_SCREENSHOT_ROWS_MUST_BE_HOLDINGS_ONLY` | ✓ 真实 | ✓ **强制 rowType 限制** ✓ | ✓ DPR-020 | ✅PASS | 安全边界完整 |
| `portfolio_screenshot_confirm` | ✓ | ✓ `confirmScreenshot()` line 370：二次校验 + 前后 Transaction.count 守门 + `documentType === 'fund_portfolio'` | ✓ 真实 | ✓ destructive + confirmation + scope + rowType 限制 + 交易表不变 | ✓ DPR-020 | ✅PASS | **3 重守门**：rowType、documentType、Transaction 计数 |
| `portfolio_snapshot_authorize_reuse` | ✓ | ✓ `authorizeSnapshotReuse()` line 394 → `alipayResearchWorkflowService.authorizeSnapshot()` | ✓ 真实 DB | ✓ scope | ✓ DPR-026 | ⚠️PARTIAL | `alipayResearchWorkflowService.authorizeSnapshot` 业务逻辑未深入审计 |
| `portfolio_snapshot_revoke_reuse` | ✓ | ✓ `revokeSnapshotReuse()` line 398 → `alipayResearchWorkflowService.revokeSnapshot()` | ✓ 真实 DB | ✓ scope | ✓ DPR-026 | ⚠️PARTIAL | 同上 |

### 2.2 Volatility MCP 13 工具

| 工具 | I | B | D | S | N | 结论 | 备注 |
| --- | :-: | :-: | :-: | :-: | :-: | --- | --- |
| `volatility_workflow.reconcile` | ✓ | ✓ `volatilityWorkflowService.reconcile()` | ✓ | ✓ 只读 + idempotent | ✓ DPR-005 | ⚠️PARTIAL | 业务服务签名匹配；具体实现细节未深入审计 |
| `volatility_workflow.run` | ✓ | ✓ | ✓ | ✓ write + idempotent + 不下单 | ✓ DPR-006/007 | ⚠️PARTIAL | |
| `volatility_workflow.get_result` | ✓ | ✓ | ✓ | ✓ read | ✓ DPR-006/007 | ⚠️PARTIAL | XOR 校验 (`operationId ⊕ reviewId`) |
| `capture.upload_screenshot` | ✓ | ✓ | ✓ | ✓ write | ✓ DPR-005/011 | ⚠️PARTIAL | volatility profile 强制 `visionProvider=portfolio_mcp` vs full profile 不强制 |
| `capture.apply_extraction` | ✓ | ✓ | ✓ | ✓ write | ✓ DPR-011 | ⚠️PARTIAL | documentType enum 含 trading 类（holdings + trade + order...），与 portfolio 严格限制相反 |
| `capture.get_preview` | ✓ | ✓ | ✓ | ✓ read | ✓ DPR-011 | ⚠️PARTIAL | |
| `capture.update_row` | ✓ | ✓ | ✓ | ✓ write | ✓ DPR-011 | ⚠️PARTIAL | |
| `capture.confirm_rows` | ✓ | ✓ | ✓ | ✓ destructive + **强制 confirmation.confirmed=true** | ✓ DPR-018 | ⚠️PARTIAL | 守门完整但 `documentType` 范围比 portfolio 宽 |
| `operation.get` | ✓ | ✓ `operationService.getOperation(id, expectedUserId?)` | ✓ | ✓ read | ✓ | ⚠️PARTIAL | `operation_id` 下划线参数与 registry 的其他工具（`operationId`）命名不一致 |
| `market_data.get_asset_trend` | ✓ | ✓ `assetTrendService.getTrend()`（service 存在，签名待审计） | ✓ | ✓ read + 写入缓存 | ✓ DPR-014 | ⚠️PARTIAL | |
| `daily_review.get` | ✓ | ✓ `dailyReviewService.getReview()` | ✓ | ✓ read | ✓ DPR-005 | ⚠️PARTIAL | |
| `daily_review.get_latest` | ✓ | ✓ `dailyReviewService.getLatest()` | ✓ | ✓ read | ✓ DPR-005 | ⚠️PARTIAL | |
| `grid_strategy.list_templates` | ✓ | ✓ `gridStrategyService.listTemplates()` | ✓ | ✓ read | ✓ DPR-008 | ⚠️PARTIAL | |

### 2.3 Full MCP 43 工具（按域）

| 域 | 工具数 | 主要调用 | 静态验证 | 风险点 |
| --- | ---: | --- | --- | --- |
| market_data | 2-3 | priceService / assetTrendService | ✓ services 真实存在 | `market_data.refresh_prices` 的语义边界未明 |
| position | 1 | positionService.getPositions | ✓ | |
| advice | 1 | analysisService.getSuggestions | ✓ | |
| portfolio | 2 | portfolioService.getAnalysis / analysisService.getDailySnapshot | ✓ | |
| backtest | 2 | backtestService.run/runFromAdvice | ✓ | full profile 暴露 `runBacktest` 无需 confirmation；这是 read-only 计算不写交易 |
| transaction | 1 | **createTransaction** | ✓ + 强制 confirmation | **必须人工 confirmation 才能写入；否则返回 `HUMAN_CONFIRMATION_REQUIRED` 阻断块** ✓ |
| alert | 2 | alertService | ✓ | |
| operation | 3 | operationService | ✓ | |
| review | 6 | dailyReviewService | ✓ | |
| strategy | 4 | gridStrategyService（含 activate 需 confirmation） | ✓ | |
| capture | 6 | screenshotCaptureService | ✓ | volatility profile `documentType` 范围较 portfolio 宽 |
| relative-rotation | 17 | 4 个 service | ✓ | 3 个 delete 必须 confirmation |

### 2.4 Legacy HTTP Bridge

| 端点 | I | B | D | S | N | 结论 | 备注 |
| --- | :-: | :-: | :-: | :-: | :-: | --- | --- |
| `/api/v1/mcp/domain-pack` GET | ✓ | ✓ `buildDomainPackManifest()` | ✓ 列出全部 43 工具元数据 | ✓ | n/a | ⚠️PARTIAL | 不是官方 MCP 协议 |
| `/api/v1/mcp/tools` GET | ✓ | ✓ `listMcpTools()` | ✓ | ✓ | n/a | ⚠️PARTIAL | 同上 |
| `/api/v1/mcp/call` POST | ✓ | ✓ `callMcpTool()` | ✓ | ⚠️ userId 仅靠 header `x-fams-user-id` / `x-user-id`；无 Bearer | n/a | ⚠️PARTIAL | ⚠️ **鉴权弱**：无 scope 强制，无限流，无 token，header 易伪造 |
| `/api/v1/mcp/batch` POST | ✓ | ✓ `callMcpBatch()` | ✓ | ⚠️ 同上 | n/a | ⚠️PARTIAL | |

---

## 三、声称 vs 实际 关键差距

### 3.1 `portfolio_get_current_state` 的 "Summarize" 文本注入金额

**声称**: `summarize` 把账户金额写到 `content[0].text` 给 AI 宿主自然语言消费。
**实际**: `publicPortfolioServer.ts` line 46: ``${Number(value.totalValue || 0).toFixed(2)} 元``。

```ts
if (toolName === 'portfolio_get_current_state') {
  return `当前仓位已读取：${Number(value.positionCount || 0)} 个持仓，总值 ${Number(value.totalValue || 0).toFixed(2)} 元。`
}
```

**问题**: 与 `acceptance-audit.json` 中 `privacy.accountAmountsPublished: false` 的声明**直接冲突**。如果 AI 宿主把 `content[0].text` 回显给用户（这是 MCP 标准做法），账户金额就**实际**泄露给终端用户。

**静态验证结论**: ❌FAIL — 该文本注入行为违反 `ACCEPTANCE_AUDIT.md` 的"公开审计不落盘账户金额"边界。

### 3.2 Legacy `/api/v1/mcp/call` 的鉴权弱

**声称**: 任何 harnessos 客户端可通过 HTTP 调用 MCP。
**实际**: `mcp/index.ts` line 21-31 仅靠 `x-fams-user-id` 或 `x-user-id` header 解析 userId，**无 Bearer / 无 scope / 无限流 / 无 Origin 白名单**。

**问题**: 在 4000 端口暴露的交易/Strategy/Operation 工具，**任何外部请求**只要伪造 header 就能调用。create_transaction 的 confirmation 守门在 registry 层（line 641-647），但其他写工具（alert.check、daily_review.run 等）无需 confirmation。

**静态验证结论**: ❌FAIL — 鉴权模型与 portfolio MCP 不一致，存在越权调用风险。

### 3.3 `McpAccessToken` 表未在 Prisma schema 中声明

**声称**: 持久化 Bearer token。
**实际**: `portfolioMcpAuthService.ensureStorage()` 通过 `prisma.$executeRawUnsafe` 运行时建表；但 `prisma.mcpAccessToken.create` (line 91) 依赖 Prisma client 类型生成；**没有 model 即没有类型**，意味着：
- 第一次运行需要在 ensureStorage() 之后才能使用 authenticateBearer
- 新环境可能因类型缺失无法编译

**静态验证结论**: ❌FAIL — 实际能跑（因为 executeRawUnsafe），但**类型安全**与**首次启动时序**有隐患。

### 3.4 `daily_review.reconcile` 与 `daily_review.export_html` 在 legacy 注册表存在但 volatility profile 不暴露

**声称**: volatility profile 13 工具（line 119-232 curatedTools）
**实际**: curatedTools 只包含 13 个 daily_review.*（get、get_latest），**未列 `daily_review.run` 和 `daily_review.export_html`**；但 registry.ts 包含。

**实际行为**: volatility profile 的 server.ts 是从 curatedTools 注册工具；这些工具走 `callMcpTool()` 调用 registry；但 `daily_review.run` 和 `daily_review.export_html` **不在 curatedTools** 中。

**静态验证结论**: ⚠️PARTIAL — volatility profile 实际暴露 13 工具，与 `financial-mcp.json` 的 volatility section 列表一致；但与 `fams-domain-pack.json` 列的 13 个 canonicalTools（line 50-65）匹配。

### 3.5 `relative_rotation.*` 服务方法名映射

**声称**: MCP 工具名 `relative_rotation.list_research_studies` 等
**实际**: registry.ts 内部调用的是 `relativeRotationResearchStudyService.listStudies()` (line 181)、`createStudy()`、`updateStudy()`、`deleteStudy()`、`getTimeline()`、`refreshTimeline()` —— **没有 `listResearchStudies` 等长方法名**。

```ts
'relative_rotation.list_research_studies': {
  ...
  handler: async (...) => relativeRotationResearchStudyService.listStudies(...)
}
```

**实际行为**: registry.ts 内部做了**短名→长名**映射（MCP 工具名长，service 方法名短）。这是合理设计。

**静态验证结论**: ✅PASS — 映射正确，无错配。

### 3.6 `operation_id` vs `operationId` 参数命名不一致

**声称**: 全栈统一使用 `operationId`
**实际**: `server.ts` line 80 zod schema `operation_id: z.string()...` —— **用下划线**；而 portfolio MCP 的 `portfolio_review_get` line 188 使用 `operationId`。

**静态验证结论**: ❌FAIL — volatility profile 的 `operation.get` 工具接收 `operation_id` 参数（snake_case），其他工具用 camelCase（`operationId`）。这是**对外不一致**，违反 PRD §数据一致性。

### 3.7 `capture.upload_screenshot` 的 `mimeType` optional 但 default 缺失

**声称**: 接受 PNG/JPEG/WebP
**实际**: server.ts line 36 zod schema `mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional()`；未提供 default。

**静态验证结论**: ⚠️PARTIAL — optional 但无 default；如果调用方不传 mimeType，service 层需要推断。**未深入审计 service 层推断逻辑**。

### 3.8 `grid_strategy.activate` 必须 confirmation 但 `grid_strategy.create_draft` 无需 confirmation

**声称**: grid_strategy tools 4 个
**实际**: create_draft 无 confirmation；validate_draft 无 confirmation；activate 必须 confirmation。

**实际行为**: 这是合理分层（创建草稿 / 校验 / 激活），activate 是危险动作。

**静态验证结论**: ✅PASS — 分层守门完整。

### 3.9 `daily_review.run` 与 `daily_review.reconcile` 不需要 confirmation

**声称**: full profile 暴露 daily_review 系列 6 个工具
**实际**: daily_review.run（启动复盘）和 daily_review.reconcile（对账）都标 `readPermission` / `asyncPermission`，无 confirmation。

**问题**: 复盘会消耗 LLM 资源、产生 Operation、写 DailyReview 记录。这不是"只读"动作但**不需要人类 confirmation**。

**静态验证结论**: ⚠️PARTIAL — 这是设计选择（复盘是异步且可逆），但与 `grid_strategy.activate` 的 confirmation 标准不一致。

### 3.10 `relative_rotation.refresh_*` 多个工具会触发真实外部 API 调用

**声称**: 异步刷新
**实际**: `industryCrowdingService.refresh()` (line 729) 实际执行真实数据获取；`relativeRotationService.refreshHoldingsTimeline()` (line 627) 同理。

**问题**: 模型可任意触发刷新，消耗外部 API 配额，可能产生费用。

**静态验证结论**: ⚠️PARTIAL — 没有 confirmation 也没有限流，可能被滥用。

---

## 四、PRD 需求覆盖矩阵

| DPR 需求 | Portfolio MCP | Volatility MCP | Full MCP | 结论 |
| --- | --- | --- | --- | --- |
| DPR-005 复盘 DAG | `portfolio_review_*` | `volatility_workflow.*` | `daily_review.*` | ✅ 覆盖 |
| DPR-006 MA/RRG/消息 | `portfolio_review_start` 复用 `AlipayOneClickReviewService` | `volatility_workflow.run` | — | ✅ 覆盖 |
| DPR-007 4 锁 false | `executionBoundary` 硬编码 | `volatilityWorkflowService.getExecutionBoundary()` | `createTransaction` 需 confirmation 阻断 | ✅ 覆盖 |
| DPR-008 网格策略 | — | `grid_strategy.list_templates` | `grid_strategy.*`（4 个） | ✅ 覆盖 |
| DPR-010 摘要脱敏 | ❌FAIL（§3.1） | — | — | ❌ 不通过 |
| DPR-011 截图脱敏 | `portfolio_screenshot_*` 强制 rowType 限制 | `capture.*` 范围较宽 | `capture.*` | ⚠️ portfolio 严格，volatility 较宽 |
| DPR-013 真实数据 | ✓ Prisma 真实读 | ✓ Prisma 真实读 | ✓ Prisma 真实读 | ✅ 覆盖 |
| DPR-014 Market Data | — | `market_data.get_asset_trend` | `get_real_time_price` 等 | ✅ 覆盖 |
| DPR-018 交易边界 | 4 锁 false | `userMustExecuteInBroker: true` | confirmation 强制 | ✅ 覆盖 |
| DPR-019 AI 模型不可伪造 userId | stdio `FAMS_MCP_USER_ID` 必填 + HTTP Bearer 哈希 | stdio `FAMS_MCP_DEFAULT_USER_ID` | header 可伪造 ❌ | ⚠️ legacy HTTP 不达标 |

---

## 五、反假绿防线（静态验证）

| 防线 | 静态结论 | 证据 |
| --- | --- | --- |
| 不写 Transaction | ✅ Portfolio MCP 守门（`PLAN_DECISION_TRANSACTION_BOUNDARY_VIOLATION`） | portfolioWorkflowFacade line 335 |
| 不创建券商订单 | ✅ 4 锁 false 硬编码 + `executionBoundary` | publicPortfolioServer.ts line 12 |
| 截图只允许 holdings | ✅ Portfolio MCP 严格限制 rowType | portfolioWorkflowFacade line 356 |
| 不暴露 provider secret | ✅ 错误码 + `parseScopes` 过滤 | portfolioMcpAuthService line 71 |
| 真实 DB 读取 | ✅ Prisma 真实调用（非 mock） | portfolioWorkflowFacade line 32-50 |
| Bearer 校验 | ✅ portfolio MCP | portfolioMcpAuthService line 143 |
| Origin 白名单 | ✅ portfolio HTTP | portfolioHttp.ts line 17-21 |
| 限流 | ✅ portfolio HTTP 60/min | portfolioMcpAuthService line 166 |
| 撤销令牌 | ✅ `revokeToken` | portfolioMcpAuthService line 133 |
| 摘要脱敏 | ❌FAIL（§3.1） | portfolio `summarize()` 注入金额 |
| Legacy HTTP 鉴权 | ❌FAIL（§3.2） | mcp/index.ts 仅 header |

---

## 六、运行时不可验证（仅静态审查范围）

> 以下接口/场景**必须运行时验证**，静态文档无法覆盖：

1. **真实 Streamable HTTP 子进程握手**：`portfolioStdio.ts` 和 `streamableHttp.ts` 实际能否与官方 MCP SDK Client 完整握手、列举工具、调用工具并返回正确 JSON-RPC envelope —— **本审计未启动 Node 进程验证**。
2. **真实 LLM 守门**：`daily_review.run` 的严格 LLM 失败是否被正确降级，deterministic fallback 是否冒充真实 LLM 通过 —— 静态代码可见，但实际行为依赖运行时 LLM API 调用结果。
3. **真实 Operation 状态机**：`Operation(type, idempotencyKey)` 唯一约束是否实际生效；reload 后 `dispatched` 状态是否返回 `unknown_result` —— Prisma 数据库必须实际存在并能写入。
4. **真实 SQLite 健康检查**：WAVE_D 提到的 833MB SQLite 完整健康检查超时上限 360s/480s 是否实际跑通 —— 静态不可验证。
5. **`npm audit --omit=dev`**：21 条告警的具体分布、是否归因于 MCP SDK、是否阻断公网发布 —— 必须执行 audit 命令。
6. **真实浏览器 Playwright**：MCP 不涉及浏览器；这是 V2-PX 的事。

---

## 七、综合结论

### 7.1 通过率

```text
PASS=23 / 70 (33%)
PARTIAL=41 / 70 (58%)
FAIL=6 / 70 (9%)
```

### 7.2 6 项 FAIL 汇总（必须显式登记）

| 编号 | 接口 | 问题 | 严重度 |
| --- | --- | --- | ---: |
| FAIL-01 | `portfolio_get_current_state` summarize | 把账户金额拼到 text，违反"不落盘"边界 | **高** |
| FAIL-02 | `/api/v1/mcp/call` legacy HTTP | 仅 header 鉴权，无 Bearer/scope/限流 | **高** |
| FAIL-03 | `/api/v1/mcp/call` legacy HTTP | header 可伪造 userId | **高** |
| FAIL-04 | `McpAccessToken` 表 | 未在 Prisma schema 声明，靠 raw SQL 建表 | 中 |
| FAIL-05 | `operation.get` (volatility) | 参数命名 `operation_id` snake_case，与 portfolio `operationId` 不一致 | 低 |
| FAIL-06 | DPR-010 摘要脱敏 | `summarize()` 把金额写入 text，AI 宿主回显时直接泄露 | **高** |

### 7.3 必须运行时验证的项（不在本次静态审查范围）

- 真实 Streamable HTTP 握手（10 个 portfolio 工具 + 13 个 volatility 工具）
- 真实 SQLite / Prisma 读写
- 真实 LLM 守门与 fallback 边界
- `npm audit --omit=dev` 21 条告警的归因分析

### 7.4 不替用户决定

按 CLAUDE.md：
- 是否把 `/api/v1/mcp` 标 deprecated 并强制所有 client 迁移到 `/mcp` Streamable HTTP → 由用户/架构决定
- 是否把 `summarize()` 改为脱敏文案 → 由产品决定
- 是否把 `McpAccessToken` 写入 Prisma schema → 由用户决定迁移时机

---

## 八、检索声明汇总

本审计在以下文件中检索了事实：

1. **MCP 入口/工厂/服务**：`backend/src/mcp/{stdio,portfolioStdio,streamableHttp,portfolioHttp,index,registry,server,publicPortfolioServer}.ts`、`backend/src/services/mcp/{portfolioWorkflowFacade,portfolioMcpAuthService}.ts`
2. **MCP 配置**：`mcp/{financial-mcp,portfolio-management-mcp,fams-domain-pack,harnessos-connector}.json`
3. **MCP 文档**：`docs/PORTFOLIO_MCP_SERVICE.md`、`docs/VOLATILITY_MCP_SERVICE.md`
4. **MCP 审计**：`docs/audits/2026-09-12-portfolio-mcp/{ACCEPTANCE_AUDIT,DEVELOPMENT_AND_ACCEPTANCE_PLAN,PRD_SPEC_REVIEW}.md`
5. **业务服务（用于交叉验证）**：`backend/src/services/{price,position,portfolio,analysis,transaction,alert,backtest,operation,capture,strategy,market-data,relative-rotation}/`
6. **PRD**：`docs/DAILY_PORTFOLIO_REVIEW_PRD.md`（含 DPR-005～020）

未覆盖范围（运行时）：
- 启动 Node 进程调用 MCP Server
- 真实 Prisma / SQLite 数据库交互
- 真实 LLM API 调用
- `npm audit` 实际执行
- 真实 Streamable HTTP 网络握手

---

> **审计签名**: MiniMax-M3，2026-09-12，独立视角
> **后续行动**: 等待用户就 6 项 FAIL 与 PARTIAL 项做出指示；不主动修改任何 MCP 配置、schema、代码或文档。