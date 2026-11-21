# Stage 10-RD1 Codex-fix replacement acceptance

**Date:** 2026-10-28  
**Candidate:** `backend/data/gpt-audit/dividend-low-vol-stock-v3/scratch/DLV3-STAGE10-RD1-CODEX-FIX-20261028T150000Z/`  
**Verdict:** `RD1_DIAGNOSTIC_ACCEPTED_AWAITING_HUMAN_RESEARCH_DECISION`  
**Eligibility:** `NOT_HOLDOUT_ELIGIBLE`, `NOT_PRODUCTION_ELIGIBLE`

## Decision

The replacement closes RD1-F01..F05. It is accepted as an exposed diagnostic artifact only. It is
not a second hold-out attempt, does not promote an arm, and grants no production capability.

- Four symbols each carry 263 unique signal-only warm-up sessions (2024-09-02..2025-09-30).
  Warm-up does not enter the 241-session performance calendar, orders, dividends, or measured period.
- The explicit replay capability is exact-bound to 2025-10-01..2026-09-30; wrong dates and wrong
  classification fail closed.
- The independent verifier rebuilds integer-fen cash, FIFO sleeve lots, receivables, taxes, costs,
  market value, equity, attribution, return/risk and B0/B1/P0 from journal/source facts: 0 findings.
- Six built-in negative controls pass. Four additional real temporary-root mutations invoke the
  actual runner/verifier and all exit non-zero with the expected guard.
- Gate 6 default-center journal, ledger, return and order/fill identities match for all three arms.
- Two absolute roots produce byte-identical R0/R1/R2 cells and diagnostic summary.
- Gate 6 (74), Stage 10 C0 (5,315), failed RD1 C0 (20), and replacement (30) seal entries verify.
- No parameter search, best-of-three, production database/service, scheduler, migration, MCP,
  broker or live-order action occurred.

## Diagnostic result

| Arm | Return | Sharpe | Sortino | Max drawdown | vs B0 | vs B1 | Average cash |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R0 | +0.7743% | 0.557 | 0.811 | 1.446% | +6.052 pp | -4.138 pp | 91.16% |
| R1 | +0.5281% | 0.764 | 1.124 | 0.562% | +5.806 pp | -4.384 pp | 96.40% |
| R2 | +0.5277% | 0.713 | 1.061 | 0.574% | +5.805 pp | -4.385 pp | 96.12% |

B0 returned -5.2777%, B1 +4.9122%, and P0 +5.2632%. The strategy preserved capital and limited
drawdown, but its 91%–96% average cash allocation left more than four percentage points of upside
versus B1/P0 uncaptured. R2 added turnover and cost without improving return over R1. Confidence is
medium on replay mechanics and low on generalisation because this period is exposed and only one
year long. Thesis breaker: this period does not support a claim that sparse selection captures the
dividend-low-vol benchmark's upside.

## Identities

- replacement `SHA256SUMS` SHA-256:
  `3560f0e07a29ced0bb8f299bba755b4de68ff04fcd9fde2d34d9c735fd11582b`
- payload tree digest:
  `2f781c11a1b6e7069d86976c496b9e3c32677b4ffd79c4e4a2b3edbedb5ca587`
- independent verification SHA-256:
  `8c916a2a6bb08d19488499ac012c0afe2dd3cf7e1b6300a6d88d00312b47276a`
- real-negative evidence SHA-256:
  `2f4fa637e76ef6b5aa0f27e8feb73cb2b324ce9ec75ec13935525906eadf0286`

`3.0.0-research`, Stage 10 C0, and the failed RD1 C0 remain immutable. The exposed period remains
permanently ineligible as a hold-out.

## Human decision

The next gate is not another correction. The human may accept this diagnostic interpretation and
either stop the branch, keep `3.0.0-research` as the active research baseline, or authorise a newly
pre-registered future research release with a genuinely unexposed validation window. None of those
choices activates production.

DLV3坐标：已完成 Gate 10（INCONCLUSIVE_CONFIRMED）→ 当前 Stage 10-RD1 /
RD1_DIAGNOSTIC_ACCEPTED_AWAITING_HUMAN_RESEARCH_DECISION → 下一门限 RD1 人工诊断验收与研究分支决策；
计划完成度约 100%。
