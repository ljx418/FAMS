# Project Migration Guide

This guide describes how to move the current Financial Asset Manager project to another PC and continue development.

## What to Copy

Copy the whole project directory:

```bash
financial-asset-manager/
```

Make sure the following files are included:

- `backend/.env`
- `backend/prisma/dev.db`
- `2026仓位管理-20260413.xlsx`
- `backend/test_positions.xlsx`
- `mcp/financial-mcp.json`

Important: `backend/.env` and `backend/prisma/dev.db` are ignored by Git, so they may be missing if you only migrate through a Git repository.

## What Can Be Excluded

These folders do not need to be copied. They can be regenerated on the new PC:

- `backend/node_modules`
- `frontend/node_modules`
- `backend/dist`
- `frontend/dist`

You can also exclude temporary or system files:

- `.DS_Store`
- `*.log`

## New PC Requirements

Install these before running the project:

- Node.js 18 or newer
- npm

The current development database uses SQLite:

```env
DATABASE_URL="file:./dev.db"
```

So PostgreSQL and Redis are not required for the current local development setup. They are only needed if you later switch to the production-style architecture.

## Setup on the New PC

After extracting the project on the new PC, install backend dependencies:

```bash
cd financial-asset-manager/backend
npm install
npx prisma generate
npm run dev
```

Open another terminal and install frontend dependencies:

```bash
cd financial-asset-manager/frontend
npm install
npm run dev
```

The backend usually runs on:

```text
http://localhost:4000
```

The frontend Vite dev server will print its actual URL in the terminal, commonly:

```text
http://localhost:5173
```

## MCP Configuration

If you use MCP/Agent integration, check:

```text
mcp/financial-mcp.json
```

After moving to a new PC, update any machine-specific paths, commands, or database connection settings if needed.

## Recommended ZIP Migration

It is OK to migrate by creating a ZIP archive of the current project directory.

Before compressing, confirm the ZIP includes:

- `backend/.env`
- `backend/prisma/dev.db`
- Excel data files used by the project

For a smaller ZIP, exclude:

- `backend/node_modules`
- `frontend/node_modules`
- `backend/dist`
- `frontend/dist`

After extracting on the new PC, run `npm install` in both `backend` and `frontend`.

## Quick Checklist

- [ ] Copy the full `financial-asset-manager` project directory.
- [ ] Confirm `backend/.env` is included.
- [ ] Confirm `backend/prisma/dev.db` is included.
- [ ] Confirm Excel files are included.
- [ ] Install Node.js 18+ on the new PC.
- [ ] Run `npm install` in `backend`.
- [ ] Run `npx prisma generate` in `backend`.
- [ ] Run `npm install` in `frontend`.
- [ ] Start backend with `npm run dev`.
- [ ] Start frontend with `npm run dev`.
