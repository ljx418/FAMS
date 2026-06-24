# FAMS Advice JSON Schema

## Purpose

This schema defines the structured output contract for AI-generated advice.
The frontend should render structured fields first and use free text only as a
secondary explanation layer.

## Design Rules

- AI advice is informational, not auto-trading.
- Every advice response must be traceable to a snapshot input.
- Every actionable item must be convertible into `AdviceAction`.
- User confirmation is always required before recording trade-affecting actions.

## Top-Level Schema

```json
{
  "schema_version": "v1",
  "generated_at": "2026-05-04T09:30:00.000Z",
  "scope": "portfolio",
  "summary": "当前组合科技成长暴露偏高，现金偏低。",
  "risk_level": "medium",
  "required_user_confirmation": true,
  "portfolio_view": {
    "total_value": 1250000,
    "cash_pct": 0.08,
    "concentration_risk": "high",
    "primary_observations": [
      "港股科技仓位偏高",
      "现金缓冲不足"
    ]
  },
  "portfolio_targets": [
    {
      "bucket": "现金",
      "current_pct": 0.08,
      "target_pct": 0.15,
      "suggestion": "increase"
    }
  ],
  "actions": [
    {
      "asset_code": "00700.HK",
      "asset_name": "腾讯控股",
      "asset_type": "stock",
      "action": "hold",
      "priority": "medium",
      "confidence": 0.77,
      "reason": "趋势未破位，但当前仓位已接近上限",
      "suggested_quantity": null,
      "suggested_amount": null,
      "suggested_price": null,
      "target_position_pct": 0.12,
      "stop_loss": 285,
      "take_profit": 380,
      "requires_asset_creation": false
    }
  ],
  "risks": [
    "港股流动性和政策波动风险",
    "科技股集中度偏高"
  ],
  "disclaimer": "AI 建议仅用于辅助决策，不自动交易，不构成投资建议。"
}
```

## Field Contract

### Required Top-Level Fields

- `schema_version`
- `generated_at`
- `scope`
- `summary`
- `risk_level`
- `required_user_confirmation`
- `actions`
- `risks`
- `disclaimer`

### Enumerations

#### scope

- `portfolio`
- `holding`
- `candidate`
- `strategy`

#### risk_level

- `low`
- `medium`
- `high`

#### action

- `buy`
- `sell`
- `hold`
- `rebalance`
- `grid_order`
- `dca`
- `watch`

#### priority

- `low`
- `medium`
- `high`

## Mapping To Database

### Advice

Map these top-level fields into `Advice`:

- `schema_version`
- `generated_at`
- `summary`
- `risk_level`
- `disclaimer`
- full raw structured payload as `recommendationJson`

### AdviceAction

Each item in `actions[]` maps to one `AdviceAction`:

- `asset_code` -> resolve to `assetId` if possible
- `action` -> `actionType`
- `confidence`
- `reason`
- `suggested_quantity`
- `suggested_amount`
- `suggested_price`
- `target_position_pct`

### AdviceInputSnapshot

Not part of AI output, but every advice row must reference one snapshot used
to generate it.

## Validation Rules

- `actions` may be empty, but must exist
- `confidence` must be `0` to `1`
- at least one of `suggested_quantity`, `suggested_amount`,
  `target_position_pct`, or `reason` must be populated for actionable rows
- `disclaimer` must always be present
- text explanation cannot override structured fields

## Product Rules

### Never Allow

- direct broker execution
- schema without disclaimer
- unstructured blob as sole output
- action rows without explicit `action`

### Allowed

- `hold` or `watch` actions with no transaction quantity
- buy candidate on asset not yet in portfolio
- user override before transaction recording

## Transport Envelope

When exposed through REST or MCP later, wrap the schema in an envelope:

```json
{
  "status": "ok",
  "warnings": [],
  "artifact_refs": [],
  "next_actions": [
    "review_actions",
    "confirm_trade"
  ],
  "data": {
    "advice": {}
  }
}
```

## Phase Scope

### V1.0

- implement this schema for advice generation
- persist full payload in `Advice.recommendationJson`
- map action rows into `AdviceAction`

### V1.5

- validate schema versioning
- bind every advice row to `AdviceInputSnapshot`
- add artifact refs for report rendering
