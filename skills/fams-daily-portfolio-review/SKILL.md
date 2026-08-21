---
name: fams-daily-portfolio-review
description: Run or explain a FAMS open, pre-close, or manual portfolio review with current prices, 30 completed closes, MA5/MA10/MA30 charts, evidence changes, attention targets, and manual grid drafts.
---

# FAMS Daily Portfolio Review

Use the FAMS MCP tools as the source of record. Do not reproduce pricing, moving-average, evidence-change, or grid calculations outside FAMS when the tools are available.

## Workflow

1. For a fresh review, call `daily_review.run` with `sessionType` set to `open`, `pre_close`, or `manual`. This starts an audited operation; it does not create an order.
2. Poll `operation.get` when the caller wants to wait for completion, then call `daily_review.get` or `daily_review.get_latest`. Use `daily_review.list` when the user asks to compare or browse prior runs.
3. Present each holding's current quote, latest completed close, MA5/MA10/MA30, and chart. State when a quote used a fallback or history/evidence was insufficient.
4. Compare fundamental and news evidence with the prior review. Distinguish `none`, `watch`, `material`, and `insufficient`; never turn missing evidence into a positive conclusion.
5. Summarize whether the active strategy remains reasonable, the holdings and persisted candidate-pool targets that need attention, and how the current manual grid differs from the previous one. If no validated active strategy applies, identify the built-in result as `system_research_fallback`, never as an activated user strategy.
6. Label every price/quantity row as a manual plan draft. Keep `formalTradingUnlocked=false`, `autoTradeUnlocked=false`, `canCreateOrder=false`, and `orderCreateAllowed=false`.

Never call `create_transaction` or imply that a grid draft is a broker order. If the user requests actual execution, explain the boundary and leave execution to the user outside FAMS.
