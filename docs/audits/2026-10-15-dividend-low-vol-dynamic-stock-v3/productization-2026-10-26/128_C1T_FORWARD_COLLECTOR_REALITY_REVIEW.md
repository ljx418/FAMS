# C1-T forward collector — contract reality review

**Date:** `2026-11-21`  
**Reviewed contract:** `127_C1T_FORWARD_COLLECTOR_CONTRACT.md`  
**Review state:** `INDEPENDENT_READ_ONLY_REVIEW_ACCEPTED_REGISTRY_SYNC_PENDING`

## Code and evidence inspected

- accepted C1-T plan builder and its candidate/position/B1-history input;
- accepted prediction, realization, qualification, store and replay-verifier paths;
- provider HTTP/BaoStock allowlists, parameter guards, helper and durable authority;
- contracts and acceptances 103–126;
- Stage 17 source-capability addendum and the current checkpoint.

## Findings

| ID | Class | Finding | Contract disposition |
| --- | --- | --- | --- |
| RR-01 | `new_scope` | accepted code consumes candidate rows but no current forward collector constructs them | FC-03/04/05/08 require raw-to-candidate construction and independent replay |
| RR-02 | `external_blocker` | current provider availability after 2026-10-30 is unobserved; the accepted boundary authorized zero real calls | activation requires a new, hash-pinned network authorization and can end blocked |
| RR-03 | `contract_gap` | contract 108 freezes a 2026-10-30 bootstrap clock that cannot count as a November prospective prediction | section 5 makes it regression-only and requires a new first eligible date |
| RR-04 | `implementation_defect` | none established; accepted operational/provider code remains read-only | no rework of accepted code is authorized by this review |
| RR-05 | `new_scope` | HTTP allowlists already name Eastmoney finance/actions and CSI B0/B1; BaoStock covers membership/calendar/master/industry/OHLC | section 4 reuses these roles but requires refreshed date/query receipts, not a new source family by default |
| RR-06 | `external_blocker` | a complete selector snapshot has not yet been demonstrated from those current provider rows | missing or ambiguous coverage is `BLOCKED_DATA`, never a stale/fallback candidate |
| RR-07 | `concurrency` | the durable authority has 3,199 units left, but no collector phase allocation exists | activation must allocate smaller tranches and retain a daily-realization reserve |
| RR-08 | `workflow_owner_conflict` | `docs/workflows/REGISTRY.md` has current foreign uncommitted edits | registry synchronization is required before activation; this review does not overwrite it |

## Independent review correction log

The first read-only review returned seven must-fix items. Contract 127 now:

1. writes only a new `/work` forward runtime store and makes accepted DB bytes immutable;
2. freezes an exact changed-component allowlist and narrow accepted-module deltas;
3. maps E01–E17 dependencies, including PIT total shares, audited peer fields, report-period lineage
   and valid-empty dividend partitions;
4. separates provider wire query keys from semantic constraints and adds paging/filter negatives;
5. freezes a bounded eligibility interval/rule, then seals exact dates after calendar discovery and
   before security-value requests;
6. requires a fresh stat-only production identity receipt and incident-on-drift behavior;
7. fixes non-borrowable attempt tranches at `16 + 1400 + 1600`, leaving `183` unusable.

The remaining registry-owner conflict is not treated as passed. Activation stays blocked until the
foreign writer finishes and the new workflow is registered without overwriting its work.

The second independent read-only review accepted the corrected contract with no new must-fix
finding. It independently recomputed contract 127 SHA-256 as
`15f9c34a2e27ae5fa813e6cbb768b8c53ca00ce7ba0ace415c3462c5f9687557` and confirmed all seven
findings closed. The reviewer changed no file.

## Economic reality

The strategy still has research value as a **defensive sleeve hypothesis**, not as an established
standalone alpha strategy:

- the long-history U2 baseline annualized only `1.80%` with Sharpe `0.561` and average exposure
  `9.89%`; low drawdown is materially explained by cash;
- C1 improved annualized return to `2.26%` but Sharpe only to `0.568`; the improvement is too small
  to claim a robust edge;
- increasing caps did not cure the zero-target period from 2025-11, proving that capacity was not
  the root cause;
- X2's attractive development result failed the independent window: Sharpe `0.601`, maximum
  drawdown `24.24%`, positive starts `53.09%`, P10 annualized `-10.88%`, PBO `55.71%`, and DSR
  probability `0.000398%`.

Accordingly, same-sample factor or threshold search has no remaining evidentiary value. Prospective
C1-T evidence can still answer whether the frozen mechanism produces investable candidates,
whether cash drag persists, and whether its low-volatility behavior survives real timing, costs and
corporate actions. Operational confidence can rise after 20/40 sessions; economic confidence needs
multiple monthly decisions and regimes and will remain low until then.

## Review conclusion

The contract is activation-ready only after:

1. an independent read-only reviewer checks contract-to-code coverage;
2. the workflow registry is synchronized without overwriting its active foreign owner;
3. the user explicitly authorizes the exact public/free/no-credential source map and network stage;
4. the checkpoint pins the activation receipt, dates, tranches, owner and output root.

Until all four are true, no implementation, socket or forward-session claim is authorized.

