# DLV3 C1-T forward shadow readiness contract

**Version:** `dlv3.c1t-forward-shadow-readiness.v1`  
**Stage:** `C1T-FWD-SHADOW-PREP`  
**Owner:** Codex  
**Classification:** prospective operational qualification; not a new historical alpha search

## 1. Objective and evidence boundary

Prepare one isolated, review-only forward shadow arm for the already inspected C1 concentration
configuration. The arm is named **C1-T** and is exactly:

- the frozen C1 risk budgets: 5% per name, 25% per PIT industry and 70% total equity;
- the existing accepted selector, breaker, score and rank bytes without alteration;
- the existing Stage 14 U3 causal technical state machine without altered windows, thresholds,
  multipliers or hysteresis;
- the existing Gate 5 accounting/execution semantics when modeled execution is later authorized.

Historical C1 results are descriptive prior evidence only. Historical values may be used for byte
identity and mechanical parity, but cannot promote C1-T. Economic qualification begins only with
facts first opened after this contract is frozen. The cumulative trial ledger records C1-T as the
prospective continuation of inspected C1 plus inspected U3, not as a reset trial.

## 2. Non-objectives

This stage does not start a service or scheduler, open current market values, allocate capital,
create an order, call MCP or a broker, touch the production database, migrate a schema, retune a
threshold, expand the universe, or claim alpha from 20 forward sessions. It does not authorize a
Monday live trade.

## 3. Frozen plan semantics

At a qualified decision instant:

1. bind the exact accepted selector output and reject duplicate/extra identities;
2. order by score descending then symbol ascending;
3. apply 5% name, 25% PIT-industry and 70% total caps, retaining unused cash;
4. compute the technical state from B1 values strictly before the decision instant by calling the
   accepted `buildTechnicalState` implementation;
5. multiply every C1 target by the applied GREEN/AMBER/RED multiplier (1, 2/3, 1/3); never scale
   above C1 and never admit a new name;
6. compare with reconciled positions and emit review-only `review_buy`, `review_sell` or `hold`
   intents. Every result has `canCreateOrder=false`, `brokerWriteAllowed=false` and
   `capitalAuthority=false`.

An empty accepted candidate set produces an explicit all-cash plan with reason
`NO_ELIGIBLE_CANDIDATE`; it is not treated as a defect and cannot be bypassed by relaxing rules.

## 4. Shadow denominator and breakers

The later shadow activation freezes one start session and every exchange session thereafter. At
least 20 completed trading sessions are required; 40 are preferred. Every session is completed or
explicitly blocked.

Hard breakers pause the arm:

- future/stale/half-day/PIT/authority/exact-set/reconciliation failure;
- release, selector, controller, source or plan hash drift;
- any target above 5%, any PIT industry above 25%, or total equity above 70%;
- theoretical shadow drawdown above 5% or cumulative shadow return below -3%;
- two consecutive scheduled sessions without a complete snapshot;
- production database fallback, lost-lease commit, mutable overwrite, MCP/broker/order/capital use;
- non-deterministic replay.

Warnings are factor missingness more than five percentage points above the frozen reference,
modeled cost above twice the accepted assumption for three plans, or one incomplete session.
Warnings never auto-retune.

## 5. Acceptance tests and evidence

The code-ready candidate must prove:

1. exact C1 caps and no candidate-set expansion;
2. exact import and use of the accepted U3 state machine;
3. prior-day B1 causality and fail-closed RED warm-up;
4. deterministic target and plan hashes under input reordering and different absolute roots;
5. explicit zero-candidate all-cash behavior;
6. isolated database path, exclusive lease and no production fallback;
7. closed state transitions and immutable supersession;
8. every forbidden capability remains false;
9. real control→fault→recovery negatives for cap breach, identity drift, look-ahead,
   reconciliation failure, lease collision and order-capability injection;
10. an independent recomputation that does not call the C1-T plan builder.

Candidate terminal states are `C1T_SHADOW_READINESS_AWAITING_CODEX`,
`C1T_SHADOW_READINESS_BLOCKED_DATA`, `C1T_SHADOW_READINESS_FAILED_CORRECTNESS` and `CANCELLED`.

## 6. Attempts, ownership and next gates

- one Codex C0 readiness candidate; no ClaudeCode correction is involved;
- accepted historical artifacts and production modules remain immutable;
- the readiness candidate may use only disposable scratch roots and an isolated shadow DB;
- after readiness acceptance, starting value acquisition or a shadow clock needs
  `HUMAN_C1T_SHADOW_START_AUTHORIZATION`;
- after at least 20 qualified sessions, the only possible advancement is a request for a separate
  Stage 18 authorization;
- Stage 18 requires an exact account, maximum capital (no more than 5% of separately approved
  target capital), manual-only order workflow, backup/reconciliation evidence, loss/incident kill
  switches and rollback. No authorization is inherited from this contract.

