# C1T-SHADOW-L1 Codex-fix final acceptance

## Verdict

`ACCEPTED`

- Stage: `C1T-SHADOW-L1`
- Immutable attempt: `CODEX_FIX` after consumed `C0` and `R1`; no `R2`
- Implementation owner: Codex
- Independent read-only reviewer: `c1t_c0_independent_review`
- Frozen contract: `dlv3.c1t-operational-shadow.v1.1`
- Contract SHA-256: `2544e6a1c6054df00a9198d8c8e8505a6b42128ef5b7b73b007ca90dc2d94746`
- Complete prior finding set: `113_C1T_OPERATIONAL_SHADOW_R1_CODEX_FINAL_REVIEW.md`
- Candidate root: `backend/data/gpt-audit/dividend-low-vol-stock-v3/scratch/C1T-SHADOW-L1-CODEX-FIX-20261101T032914Z`
- Candidate seal SHA-256: `580c4fee55cf16c94ee4deeeda4e3cf0fdf01d9bdbac34f2a279d2903c6911bb`
- `SHA256SUMS` SHA-256: `f9b1272230253956c8f4a76ee23d5fabbd4e2c1a407f7067712151ba0db9734f`
- Result SHA-256: `6d263500868dc0b9247a7f9eeee6f4ceb3b755cdb39863720465d185fb5ada7a`
- Canonical economic SHA-256: `28f18b1e34cd97a83070497a7dc43956009a15a1b0fac60e7bc9373d7c46de5d`

This accepts the development contract implementation only. It is not an Alpha, profitability,
production-readiness, broker-order or capital authorization.

## Consolidated finding closure

1. Drift is exercised with genuinely changed facts. Replaying the same drift input reuses the
   stored revision and returns its stored input identity, event count and conservation result.
2. Realization facts are byte-bound to a persisted `session_facts` envelope in the same
   transaction. The replay verifier reads that envelope and does not trust caller-supplied facts.
3. The independent verifier reconstructs order and retry outcomes from predecessor state, raw
   session facts and frozen order/fill rules. It verifies the complete modeled-order,
   modeled-order-attempt, corporate-action and revision-scoped receivable exact sets and fields.
4. Cash-dividend entitlements are lot-specific. A multi-lot stock dividend fails closed because
   the accepted frozen reducer cannot preserve source-lot lineage for the bonus shares.
5. The mechanical capital sensitivity accepts only the hash-pinned Gate-6 `R0/300000/0` journal
   and its exact 18-fill set. Arbitrary or merely hash-shaped input is refused.

The decisive negative controls mutate and delete modeled attempts and receivables, mutate order
and action fields, replay a drift revision, mismatch the raw-fact envelope, exercise two-lot cash
entitlements and require multi-lot stock dividends to fail closed.

## Verification

| Command | Result |
|---|---|
| `test:dividend-low-vol-stock-v3-c1t-operational-shadow-unit` | 18/18 passed |
| `test:dividend-low-vol-stock-v3-c1t-operational-shadow-falsification` | 18/18 passed |
| `verify:dividend-low-vol-stock-v3-c1t-operational-shadow` | 18/18 items, 36/36 cases passed |
| `backend-tsc-noemit` | passed |
| `v3-scripts-typecheck` | passed |
| dual-root candidate execution | passed; distinct databases, identical canonical economic bytes |
| `sha256sum -c SHA256SUMS` | every payload passed |

The repository entry-point audit is truthfully separate: all seven C1T aliases exist and are
typechecked, while the command exits 1 for a pre-existing foreign Stage-7A fixture reference to
`scripts/research/dividend-low-vol-stock-v3/x.ts`. A control run without the C1T aliases produced
the same foreign violation. This acceptance does not relabel that repository-level issue as passed.

## Persisted evidence

Each independent root contains 6 predictions, 18 fact envelopes, 11 target positions, 6
realizations, 6 daily NAV rows, 24 journal events, 12 modeled orders, 8 modeled-order attempts,
1 receivable and 6 session qualifications. Every daily conservation error is zero. The two roots
use different files and inodes and produce the same canonical economic bytes.

The one allowed scale disclosure reads 18 accepted Gate-6 fills. It compares 300,000 CNY with the
single 100,000 CNY mechanical overlay and remains descriptive, not promotion evidence.

## Boundaries and terminal state

- Production database opens/reads/writes: `0/0/0`.
- Production service, scheduler and MCP starts/calls: `0/0/0`.
- External orders created/transmitted: `0/0`.
- Capital deployed: `0`.
- Broker and hold-out use: `0`.
- Formal candidate budget: `0`; C0 remaining: `0`; R1 remaining: `0`; R2: forbidden.

The deterministic implementation is accepted. The real BaoStock attempt is
`refused_before_the_socket` because the installed package tree does not match the pinned source-tree
identity. This is `BLOCKED_EXTERNAL`, not a code failure and not a reason to rewrite accepted code.
The 20 distinct forward-session minimum (40 preferred) remains unmet. Real sessions alone may
advance that gate; fixture/bootstrap/historical/unknown sessions do not count.

Next gate: `C1T_OPERATIONAL_SHADOW_20_SESSION_GATE` after the authorized provider identity is
restored and real forward evidence is accumulated. Stage 18 and every production, broker, order or
capital action remain separately locked.

DLV3坐标：已完成 C1T_OPERATIONAL_SHADOW_DEVELOPMENT_ACCEPTED → 当前 C1T-SHADOW-L1 / BLOCKED_EXTERNAL_PROVIDER_IDENTITY → 下一门限 C1T_OPERATIONAL_SHADOW_20_SESSION_GATE；计划完成度约 100%
