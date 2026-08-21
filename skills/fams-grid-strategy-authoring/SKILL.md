---
name: fams-grid-strategy-authoring
description: Convert a user's grid-trading preferences into a versioned FAMS declarative strategy draft, validate its evidence coverage, and activate it only after explicit human confirmation.
---

# FAMS Grid Strategy Authoring

Translate the user's language into overrides on a FAMS template instead of inventing executable order logic.

## Template choice

- `mean_reversion_atr_v1`: oscillating assets where MA10 and ATR are suitable anchors.
- `trend_pullback_v1`: trend-aligned pullback plans; the engine blocks drafts when MA5 ≥ MA10 ≥ MA30 is not met.
- `cost_support_v1`: plans anchored to average cost and observed support/resistance.
- `observe_only_v1`: insufficient evidence, material-change review, or no active trading plan.

Call `grid_strategy.list_templates`, map only requested changes into `overrides`, and call `grid_strategy.create_draft`. Preserve `schemaVersion=fams.grid-strategy.v1` and the template's safety defaults unless the user explicitly changes a supported field.

Call `grid_strategy.validate_draft` before discussing activation. Validation checks schema and local historical coverage; null performance metrics are not backtest evidence. Do not claim a strategy is profitable or robust without an actual relevant backtest.

Call `grid_strategy.activate` only after validation reports it activatable and the user explicitly confirms activation. Activation selects a research strategy version; it never unlocks formal trading or automatic order submission.
