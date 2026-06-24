# FAMS Operation And Job Design

## Purpose

Some workflows are not good synchronous request/response operations:

- batch price refresh
- alert checks
- daily advice generation
- monthly backtest
- report generation

This document defines the minimal async execution backbone for `V1.5`.

## Core Model

Use one primary entity first: `Operation`.

Optional later split:

- `Operation` for user-visible task record
- `Job` for lower-level worker execution record

## Operation Entity

Suggested fields:

```text
Operation
- id
- user_id
- type
- status: queued | running | completed | failed | cancelled
- requested_at
- started_at
- completed_at
- input_json
- result_json
- error_json
- artifact_refs_json
- progress_pct
- idempotency_key nullable
- created_by: user | scheduler | system | agent
```

## Initial Operation Types

- `refresh_prices`
- `check_alerts`
- `generate_daily_advice`
- `run_backtest`
- `generate_backtest_report`

## Execution Flow

### User-triggered

1. API receives request
2. validate input
3. create `Operation` in `queued`
4. enqueue worker task
5. return `operation_id`
6. poll or subscribe for status

### Scheduler-triggered

1. scheduler creates `Operation`
2. worker executes
3. artifacts and errors attached to operation row

## Artifact Contract

Artifacts should not be buried in logs. Store stable references in:

- `artifact_refs_json`

Examples:

- advice report
- backtest report
- portfolio snapshot export

## Why Not Reuse Alert Or Backtest Status Fields

Because async lifecycle is cross-domain:

- alerts
- price refresh
- advice generation
- reports
- backtests

One shared model is simpler than inventing separate queue-state columns
everywhere.

## Relationship To Existing Models

- `Backtest.status` remains domain status
- `Operation.status` is execution lifecycle
- `Advice.status` remains decision/business status
- `AlertEvent.status` remains read/dismissed state

Do not overload one status field to mean all three.

## API Shape

### Start Operation

```json
{
  "status": "queued",
  "operation_id": "op_123",
  "data": {
    "type": "run_backtest"
  }
}
```

### Poll Operation

```json
{
  "status": "running",
  "operation_id": "op_123",
  "progress_pct": 45,
  "artifact_refs": [],
  "result": null,
  "error": null
}
```

## Worker Strategy

### Near-term

- start with in-process queue or simple scheduler trigger
- persist operation state in database first

### Later

- BullMQ or equivalent worker process
- Redis-backed queue coordination

## Phase Scope

### V1.0

- no full worker system required
- define model now so sync endpoints do not become permanent architecture

### V1.5

- add `Operation` table
- use for refresh prices, alert checks, daily advice, monthly backtest
- attach artifacts and failures

### V2.0+

- expose async operation state through MCP envelope
- include `operation_id`, `artifact_refs`, `next_actions`
