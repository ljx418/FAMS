# FAMS Codex Migration

## Purpose

This document is the handoff entry point for maintaining FAMS with Codex. The
project was previously developed with Claude Code team configuration and agent
prompts. Those files remain useful as historical context, but Codex should use
the source code and this document as the primary source of truth.

## What Was Migrated

- Documentation ownership moved from `CLAUDE.md`-centric guidance to docs in
  `docs/`.
- The actual runtime architecture was reconciled against the current codebase.
- A two-state draw.io diagram was added in `docs/fams-architecture.drawio`:
  current implementation and target vision.

No runtime code, API route, database schema, MCP tool, or Claude configuration
was changed by this migration.

## Current Source Of Truth

Use these files first when evaluating the project:

- `backend/src/index.ts` for the Fastify application entry point and route
  registration.
- `backend/prisma/schema.prisma` for the current data model and database
  provider.
- `frontend/src/App.tsx` for the browser route map.
- `backend/src/mcp/index.ts` for exposed MCP-style tool definitions.
- `backend/src/agents/router.ts` and `backend/src/workflow/router.ts` for the
  current in-process Agent and workflow routers.
- `server.py` for the separate FastAPI + akshare stock analysis prototype.

## Historical Claude Code Files

These files are preserved as compatibility and history:

- `CLAUDE.md`
- `.claude/`
- `skills/`
- `mcp/financial-mcp.json`

Treat them as reference material. They contain useful intent, but some details
are stale compared with the code. In particular, several documents describe
PostgreSQL, TimescaleDB, Redis, and queue workers as if they are already active.
The current Prisma datasource is SQLite via `DATABASE_URL="file:./dev.db"`.

## Current Runtime Facts

- Frontend: React 18, Vite, TypeScript, React Router, ECharts, Ant Design,
  TailwindCSS.
- Backend: Node.js, Fastify, TypeScript, Prisma, Swagger UI, multipart upload.
- Database: SQLite for the current local app (`backend/prisma/dev.db`).
- Optional/planned dependencies: Redis, Bull, PostgreSQL, TimescaleDB.
- API base: `http://localhost:4000/api/v1`.
- API docs: `http://localhost:4000/api-docs`.
- Frontend dev server: Vite default port from `frontend/vite.config.ts`.
- Separate Python analysis service: `server.py`, FastAPI + akshare.

## Common Commands

Backend:

```bash
cd backend
npm install
npm run db:generate
npm run db:push
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Build checks:

```bash
cd backend && npm run build
cd frontend && npm run build
```

Python stock analysis prototype:

```bash
python3 server.py
```

## Maintenance Rules For Codex

- Prefer the current implementation over older prose when they conflict.
- Keep documentation changes scoped to `docs/` unless the user explicitly asks
  for code changes.
- Do not delete Claude Code files unless the user asks for cleanup explicitly.
- When updating architecture documentation, keep current implementation and
  target vision separate.
- When describing financial functionality, preserve the risk disclaimer that
  generated suggestions are informational and not investment advice.

## Known Documentation Drift

- `README.md` and `CLAUDE.md` mention PostgreSQL, TimescaleDB, Redis, Bull, and
  broad microservice behavior. The code is currently a modular Fastify backend
  with Prisma + SQLite and in-process routers.
- `mcp/financial-mcp.json` points at a built `backend/dist/mcp/index.js`, while
  the active HTTP MCP-like router is registered in `backend/src/index.ts` under
  `/api/v1/mcp`.
- Workflow execution currently returns placeholder step results for Agent/MCP
  calls rather than executing durable distributed workflows.

