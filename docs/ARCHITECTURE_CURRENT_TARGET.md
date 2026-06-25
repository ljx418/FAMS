# FAMS Architecture: Current Implementation And Target Vision

## Summary

FAMS is a financial asset management application for positions, transactions,
portfolio analysis, investment suggestions, backtesting, and AI-agent-facing
tool calls. The current system is a modular local application: React frontend,
Fastify backend, Prisma, and SQLite. The target vision described by earlier
project docs extends this into a production-grade platform with PostgreSQL,
TimescaleDB, Redis, queue workers, durable workflows, and richer Agent/MCP
integration.

The paired draw.io diagram is stored at `docs/fams-architecture.drawio`.
A focused target-and-gap diagram is stored at
`docs/target-architecture-gap.drawio`.

## Current Implementation

### Runtime Shape

- Browser UI uses React 18 + Vite + TypeScript.
- Frontend pages are mounted through `frontend/src/App.tsx`:
  dashboard, assets, positions, fund detail, stock analysis, transactions,
  analysis, backtest, and portfolios.
- Frontend services call `http://localhost:4000` directly for backend APIs.
- Backend is a Fastify server in `backend/src/index.ts`.
- API documentation is exposed through Swagger UI at `/api-docs`.
- Prisma uses SQLite through `backend/prisma/schema.prisma`.
- `server.py` is a separate FastAPI + akshare prototype for global stock
  analysis and technical indicators.

### Backend Modules

The Fastify server registers these route groups under `/api/v1`:

- `auth`, `assets`, `positions`, `transactions`, `portfolios`
- `analysis`, `backtest`, `alerts`, `prices`
- `stocks`, `fund`, `tags`, `llm`
- `mcp`, `agents`, `workflows`

Business behavior is organized by services:

- Asset and import parsing: `assetService`
- Position lifecycle and holdings: `positionService`
- Transaction creation and import support: `transactionService`
- Price fetching and validation: `priceService`
- Portfolio allocation and scoring: `portfolioService`
- Analysis, suggestions, snapshots: `analysisService`
- Backtest execution: `backtestService`
- Alert and risk checks: `alertService`
- Stock technical analysis: `stockAnalysisService`, `technicalService`
- LLM stock advice prompting and parsing: `llmService`

### Data Model

Current Prisma models include:

- Users, assets, positions, transactions
- Price history and tags
- Portfolios and portfolio allocations
- Strategies, backtests, backtest results, trade signals
- Daily snapshots, alerts, suggestions

The active provider is SQLite. JSON-like fields are currently stored as strings
in several models.

### Agent And MCP Surface

The current backend exposes an HTTP MCP-style router:

- `GET /api/v1/mcp/tools`
- `POST /api/v1/mcp/call`
- `POST /api/v1/mcp/batch`

Registered tools map directly to service methods:

- `get_real_time_price`
- `get_positions`
- `get_investment_suggestions`
- `get_portfolio_analysis`
- `run_backtest`
- `get_daily_snapshot`
- `create_transaction`
- `get_alerts`

The Agent router defines roles and capabilities in process. The workflow router
defines templates for daily analysis, strategy backtesting, and news sentiment.
Workflow execution is currently a lightweight placeholder rather than a durable
or distributed execution engine.

## Target Vision

The target architecture should evolve the current modular app without forcing a
rewrite:

- Replace local SQLite with PostgreSQL for transactional data.
- Move price history, equity curves, and daily snapshots into TimescaleDB or
  PostgreSQL time-series tables.
- Use Redis for cache, rate limits, sessions, and queue coordination.
- Use Bull workers for scheduled price refreshes, snapshot generation,
  backtests, alert checks, and report generation.
- Persist workflow executions, step outputs, errors, retries, and cancellation
  state.
- Separate current HTTP MCP endpoints from a formal MCP server process if
  external Agent clients require stdio or native MCP transport.
- Treat external data providers as unreliable dependencies with caching,
  validation, retry, timeout, and source attribution.
- Add production security boundaries: authentication enforcement, authorization
  checks per user-owned resource, request validation, and secret management.
- Add observability around API latency, provider failures, workflow duration,
  queue lag, and LLM parsing failures.

## Current Stage Target: Interactive Strategy Backtest And Formal-Trading Prerequisites

The active product target is no longer only a generic portfolio ledger and
analysis workspace. The current stage is an interactive strategy backtesting
and formal-trading-prerequisite system.

The user-facing target experience is:

- Select dividend-low-volatility, current holdings, permanent portfolio,
  all-weather, local real-data sample, or custom-weight strategies.
- Configure start/end dates, initial capital, rebalance frequency, dividend
  mode, fees, slippage, and benchmark.
- View multi-strategy equity curves, drawdown curves, metrics, benchmark
  returns, excess returns, dividend contribution, data coverage, blocked
  reasons, and evidence references.
- Trace each heavy run through Operation artifacts and audit packages.
- Generate manual plan drafts only when the gate allows it.

The target architecture relationship is:

- Current implemented layer: React/Vite frontend, Fastify REST backend,
  portfolio backtest services, dividend-low-vol services, Operation artifacts,
  local market data cache, and research-grade validation artifacts.
- Modification layer: runtime-health consistency, ETF proxy market data,
  benchmark adapters, dividend total-return replay, front-end runtime
  acceptance, and artifact completeness.
- New target layer: formal-review readiness artifact that aggregates runtime,
  provider, benchmark, tradeability, validation, manual review, and frontend
  visibility.
- Hard boundary: this stage can produce research comparison and manual plan
  drafts. It must not unlock formal `ADD / REDUCE`, order creation, automatic
  rebalance, or `AUTO_TRADE`.

2026-06-24 implementation sync:

- Runtime health consistency is implemented for `/health`, SQLite health,
  portfolio backtest APIs, and the interactive strategy backtest audit package.
  Latest status is `healthy`.
- ETF proxy coverage is `ready`; permanent and all-weather portfolios can
  complete as portfolio formal-review-ready strategies when the local/free
  source data gates pass.
- The `/backtest` frontend runtime path passed headless-browser validation and
  shows runtime gate, benchmark status, dividend contribution, cost drag, and
  non-trading warnings.
- `current_holdings_buy_and_hold` is completed for the audit user
  `audit_portfolio_backtest_user`; default users with no open positions still
  return `insufficient`, which is an expected blocked state.
- Portfolio backtest formal review readiness is true for the latest audit
  package. This does not unlock formal trading because official benchmark
  upgrade, model effectiveness validation, human review records, and execution
  controls are still separate gates.

2026-06-25 formal-trading-prerequisite documentation sync:

- The active target is now a documented formal-trading-prerequisite stage, not a
  formal-trading release.
- Current implemented components remain the React/Vite frontend, Fastify REST
  backend, SQLite/Prisma runtime, Operation artifacts, dividend-low-vol
  strategy services, portfolio backtest services, local/free-source market
  evidence, and manual draft gates.
- Components requiring modification are data-grade propagation, official/free
  benchmark status, model-effectiveness validation, manual-plan draft audit,
  frontend formal-review visibility, and consolidated unlock blockers.
- Components to add next are a formal trading unlock checklist, data-grade audit
  artifacts, model-effectiveness artifacts, manual-plan-draft artifacts, and
  blocker reports for human review.
- The hard boundary remains unchanged: no formal `ADD / REDUCE`, no
  `ORDER_CREATE`, no automatic rebalance, and no `AUTO_TRADE` in this stage.

Exit status for this stage should be:

```text
interactive_strategy_backtest_ready
research_grade_strategy_comparison_ready
portfolio_backtest_formal_review_ready
manual_trade_draft_ready
formal_trading_locked
auto_trade_locked
```

Exit status for the next documentation/development stage should be:

```text
formal_trading_prerequisites_documented
portfolio_strategy_backtest_formal_review_ready
manual_trade_plan_draft_review_ready
formal_trading_locked
auto_trade_locked
```

Machine-readable aliases for implementation and audit checks:

```text
portfolioBacktestFormalReviewReady=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

The stage target API and artifact surface must expose:

```text
dataGrade
modelEffectiveness
modelEffectivenessStatus
manualPlanDraft
formalTradingUnlockChecklist
formalTradingBlockers
allowedActions=RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

Required formal-trading-prerequisite audit files:

```text
09_data_grade_audit.json
10_model_effectiveness_audit.json
11_manual_plan_draft_audit.json
12_formal_trading_unlock_blockers.json
SUMMARY_FOR_GPT.md
acceptance-report.html
```

### Concrete Implementation Map For This Stage

The draw.io architecture and the stage documents must describe concrete code
and artifact entities, not generic boxes. The current implementation map is:

| Layer | Implemented Entity | Responsibility In This Stage |
| --- | --- | --- |
| Frontend research page | `frontend/src/pages/DividendLowVol.tsx` | Shows dividend-low-vol candidates, filters, explanations, buy/sell observation zones, rolling backtest results, and non-trading warnings. |
| Frontend backtest page | `frontend/src/pages/Backtest.tsx` | Runs interactive portfolio backtests and shows curves, metrics, data grade, model effectiveness, manual draft readiness, review records, and trade blockers. |
| Frontend audit page | `frontend/src/pages/Operations.tsx` | Lets users trace Operation status and artifact references for scans, backtests, and acceptance reports. |
| Dividend strategy API | `backend/src/routes/strategy.ts` | Serves dividend-low-vol candidate pool, trading zones, rolling backtest, FIVD-R adapter, and manual acceptance data. |
| Portfolio backtest API | `backend/src/routes/portfolioBacktest.ts` | Serves strategy templates, run results, Operation artifacts, readiness summary, and review endpoints. |
| Dividend strategy services | `dividendLowVolStrategyService`, `dividendLowVolTradingZoneService`, `dividendLowVolBacktestService`, `dividendLowVolFivdRAdapter` | Produce candidates, scores, rejection taxonomy, observation zones, rolling strategy evidence, and research-only FIVD-R integration. |
| Portfolio backtest services | `PortfolioBacktestInputBuilder`, `PortfolioBacktestEngine`, `PortfolioBenchmarkService`, `portfolioBacktestReviewService` | Build portfolio inputs, replay strategies, calculate metrics, attach data/model readiness, and persist human review audit records without creating orders. |
| Runtime and evidence | `operationService`, SQLite/Prisma, local/free-source market cache, `DividendLowVolDaily`, `market_bar_canonical`, `market_tradeability_daily` | Provide current research runtime, persisted artifacts, local evidence, and data freshness gates. |
| Audit package | `SUMMARY_FOR_GPT.md`, `09_data_grade_audit.json`, `10_model_effectiveness_audit.json`, `11_manual_plan_draft_audit.json`, `12_formal_trading_unlock_blockers.json`, `acceptance-report.html` | Explains research readiness, formal review readiness, manual draft readiness, model/data gaps, and why formal trading remains locked. |

The target relationship is intentionally incremental:

- Gray in the diagram means the entity already exists and is part of the
  current research/formal-review-ready flow.
- Yellow means the entity exists but needs stronger data propagation,
  validation detail, frontend visibility, or terminology alignment.
- Orange means the entity is a new formal-trading-prerequisite artifact or
  checklist, not a trading execution feature.
- Red means a fixed boundary: no formal `ADD / REDUCE`, no `ORDER_CREATE`, no
  automatic rebalance, and no `AUTO_TRADE`.

This mapping is the source of truth for documentation-level architecture. If a
future diagram includes an abstract module such as "strategy service" or
"data layer", it must also name the concrete service, route, table/cache, or
artifact that implements the behavior.

## Design Decisions

- Keep a modular monolith as the default backend shape. The domain boundaries
  are visible enough for maintainability, but current scale does not justify
  independent services.
- Keep current and target architecture documents separate in meaning. Current
  diagrams describe code that exists; target diagrams describe migration
  direction.
- Preserve Agent and MCP abstractions because they are part of the product
  direction, but document the current placeholder behavior honestly.
- Prefer incremental database migration from SQLite to PostgreSQL over a broad
  data-layer rewrite.

## Risks And Gaps

- Several route handlers use broad `any` request typing and rely on service or
  database errors for validation.
- Some current docs overstate production infrastructure readiness.
- MCP config in `mcp/financial-mcp.json` does not exactly match the active HTTP
  router shape.
- `server.py` is outside the Node backend lifecycle and should be treated as an
  integration candidate, not a fully integrated service.
- The repository contains built output under `frontend/dist` and `backend/dist`;
  confirm whether those should remain versioned before introducing CI.

## Suggested Next Steps

- Update README after this migration so quick-start instructions match SQLite
  and Fastify accurately.
- Add integration tests for the critical route-to-service paths.
- Decide whether `server.py` becomes a supported service, a backend route, or a
  retired prototype.
- Define a real workflow persistence model before adding more workflow types.
- Add an ADR for the eventual SQLite-to-PostgreSQL migration.
