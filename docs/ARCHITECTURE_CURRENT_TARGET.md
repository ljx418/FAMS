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
