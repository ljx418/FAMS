# C1-T forward collector — frozen development contract

**Version:** `dlv3.c1t-forward-collector.v1.0`  
**Date:** `2026-11-21`  
**Stage:** `C1T-FORWARD-COLLECTOR-L3`  
**Classification:** `new_scope` — prospective evidence collection, not another historical alpha search  
**Status:** `FROZEN_AWAITING_EXPLICIT_SOURCE_AUTHORIZATION`  
**Implementation owner after activation:** Codex  
**Read-only reviewer:** unassigned until activation  
**Attempt budget:** C0 `1`, consolidated R1 `<=1`, R2 `0`, formal candidate `0`

## 1. Objective and research claim

Build one isolated forward collector that can turn public, free, no-credential facts into the exact
input of the already accepted C1-T plan builder, write a genuinely ex-ante monthly prediction, and
append complete daily realization evidence to a **new isolated forward runtime store**. The new
store is initialized from the accepted schema/genesis/bindings, but no accepted candidate database
or sealed byte is opened writable or changed.

The collector tests only these claims:

1. the frozen selector can still produce a complete, reproducible current candidate set;
2. C1's `5%` single-name, `25%` PIT-industry and `70%` total-equity limits plus the frozen U3
   `GREEN/AMBER/RED` multiplier behave causally on facts first opened after activation;
3. prediction, modeled execution, corporate actions, benchmark comparison, NAV and breaker evidence
   can be accumulated without production or trading capability;
4. the strategy does not silently convert missing data into cash, eligibility or a stale candidate.

Twenty distinct completed trading sessions prove operational readiness only; forty are preferred.
Neither threshold proves alpha or authorizes capital. Economic value requires a later, preregistered
forward observation horizon spanning multiple monthly decisions and market regimes.

## 2. Frozen upstream identities

The implementation must fail before any socket, child process or writable shadow database open if
one of these anchors drifts:

| Anchor | SHA-256 / identity |
| --- | --- |
| C1-T readiness contract 105 | `52be77eee6ba69d234027176a8a585d2d6eacbf3344c076cea2276e334aeac62` |
| readiness acceptance 107 | `3ac65f65a48cf4013a2a37123b31d4d4dd68073c30b27070c5672be6a0939ee9` |
| operational contract 108 | `2544e6a1c6054df00a9198d8c8e8505a6b42128ef5b7b73b007ca90dc2d94746` |
| operational acceptance 114 | `f2531af2c3dd58de8fd25d4d8b2203f5084364728ec0984ce89ff8717e1a8dcf` |
| provider contract 115 | `e82174a681b74590048bd27b69db9ca826e86951d6bcabc46f0f26c621b3576a` |
| provider observation 115A | `150bcf8a8dfef3c861d43d9b2309d440e7039aab80889970617ffd00ddd1cb35` |
| authority contract 123 | `9daaff3eb9857e52b0abd2486b6fb17247c6368147bef129de6edf285ab64d4b` |
| provider acceptance 126 | `b63b75ce96a0b393c1b312e398f91bc9257678a6466cc38f787fbd866224573f` |
| C1 result | `fc643e0ce7bfc6914ee456f008bce61bac241cca54ad0c610529952e7721c079` |
| selector target surface | `987fa0fd9ec87535240eb8c15a675bb4699a685b81cc135439cad5a8043c5617` |
| accepted operational seal | `580c4fee55cf16c94ee4deeeda4e3cf0fdf01d9bdbac34f2a279d2903c6911bb` |
| accepted canonical economics | `28f18b1e34cd97a83070497a7dc43956009a15a1b0fac60e7bc9373d7c46de5d` |
| authority id | `a651597f1d87a9710b6acffd306751249f3250cc77cb896cc853f85175d507ed` |
| authority DB | device `73`, inode `844424934461908`, bytes `16384`, SHA-256 `54dbb16613962f71afaf02fbfc92a6ceb440193ba90a219909cca257087b6833` |
| durable budget at freeze | total `3200`, accepted baseline `1`, reservations `0`, terminals `0`, maximum remaining `3199` |

The authority database is append-only. Its current SHA-256 is an activation identity before the
first legitimate append, not a requirement that a correctly appended ledger retain the empty hash.

## 3. Explicit non-objectives

- no change to selector, score, factor, threshold, breaker, C1 cap or U3 multiplier;
- no new historical arm, parameter search, hold-out reuse or retrospective reconstruction counted
  as forward evidence;
- no fallback symbol, stale candidate, current-label backfill, denominator shrink or missing-as-zero;
- no profitability, promotion, production-readiness or low-volatility claim from 20/40 sessions;
- no production database, global Prisma, production service, scheduler, MCP, frontend, broker,
  external order, account, capital or funds;
- no schema migration and no mutation of any accepted/rejected/withdrawn candidate;
- no network call until a later checkpoint pins the authorization receipt described in section 5.

## 3.1 Frozen changed-component allowlist

Only these components may change after activation:

- new `backend/src/research/dividend-low-vol-stock-v3/c1t-shadow/collector/**`;
- new `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-c1t-forward-collector-*`;
- `c1t-shadow/operational/contracts.ts`, only to version the network-receipt schema and separate
  provider query parameters from semantic constraints;
- `c1t-shadow/operational/fact-adapter.ts`, only to consume that separation and enforce page/filter/
  date/security-domain boundaries before reservation/socket;
- `c1t-shadow/operational/startup.ts` and `production-guard.ts`, only for the new activation chain,
  fresh stat-only production identity receipt and isolated forward-store binding;
- `backend/package.json`, script aliases only;
- `backend/tsconfig.dlv3-scripts.json`, script inclusion only;
- the exact `/work/dlv3-c1t-forward/<runId>/` root pinned by activation.

The accepted `plan.ts`, selector, eligibility/scoring/evaluation, U3 state machine, ledger/economic
reducers, policy modules, replay semantics, accepted artifacts and every production component are
immutable. A change outside the allowlist is `FAILED_CORRECTNESS`, not an implicit scope extension.

## 4. Required source-completeness map

The first C0 step is a source-completeness preflight. All domains below are mandatory; a source row
may be replaced only by a separately frozen contract addendum before the first value open.

| Domain | Required authority | Required semantics |
| --- | --- | --- |
| exchange calendar and CSI 300 membership | BaoStock public SDK | PIT-dated calendar and membership, exact raw response |
| security master and dated industry | BaoStock public SDK | security identity and industry visible at the decision instant |
| unadjusted OHLC, preclose, amount, trade status and ST | BaoStock public SDK | `adjustflag=3`, daily; never relabel adjusted data as execution data |
| PIT profit, audited annual peer fields and cash flow | Eastmoney public Data Center | report/notice/update dates; net profit, operating revenue, ROE and cash-flow-to-profit inputs; raw pages and page exact-set |
| PIT total shares/share-capital history | Eastmoney public Data Center, provider endpoint pinned at activation | shares outstanding, units, effective/announcement/availability dates; never infer from market cap |
| dividends and company actions | Eastmoney public Data Center | announcement, record, ex, pay, cash, stock/transfer, source year, report-period lineage and complete valid-empty partitions |
| B0 and B1 total-return identity/series | CSI official public endpoint | `H00300` and `H20269`; price-only identity cannot substitute |

The collector must close every evaluator dependency, not merely return a provider row:

| Fields | Complete dependency set |
| --- | --- |
| E01 | PIT CSI 300 membership interval |
| E02/E04 | A-share identity, list/out dates and security status |
| E03 | decision-date trade status, ST state and delisting state |
| E05/E06/E07/E12 | cash-dividend actions, three-year/trailing partitions including provable valid-empty partitions, close history and availability |
| E08 | PIT industry interval plus a common visible audited Q4 period containing operating revenue, attributable net profit and average ROE for the full industry peer denominator |
| E09 | at least 60 visible daily amount observations |
| E10 | visible raw close and verified PIT total shares with units |
| E11 | dividend-to-report-period lineage plus matching net profit and total shares |
| E13 | matching report-period cash-flow/profit values and PIT financial-industry exemption |
| E14/E15 | 250/60 visible close windows |
| E16 | 250 total-return observations derived from raw prices and explicit verified actions, with basis/provenance guards |
| E17 | the complete E01–E16 dependency set, source manifest, conservation and conflict accounting |

Existing accepted source identities are a starting allowlist, not evidence that a current request
will succeed. The current HTTP receipt cannot be copied unchanged: it mixes semantic constraints
(`securityCodeDomain`, `availabilityCeiling`) into the exact provider URL query while omitting
Data Center paging/filter/order keys. The new receipt schema must separate:

- exact provider query keys/values actually sent on the wire; and
- non-wire semantic constraints enforced before reservation (security denominator, date ceiling,
  report-period/availability rules and page exact-set).

Negatives must cover missing/extra page, page-count drift, filter/order/date/security escape and a
semantic constraint accidentally serialized onto the wire. Before the first socket, the activation
receipt must also freeze:

- exact provider, transport, host, port/path, method and parameter domains;
- a bounded eligibility interval and deterministic decision/effective-date rule;
- discovery requests, then the membership/physical denominator they reveal;
- maximum dates, response bytes, timeouts, retries and the per-phase attempt ceilings;
- installed interpreter/package/helper identities and the exact authority DB identity;
- a raw-byte destination inside a native-Linux research sandbox, never the project tree;
- zero credentials and redirect denial.

The accepted authority's remaining `3199` units are a hard global ceiling, not a target. The fixed
non-borrowable tranches are:

- discovery/calendar/membership: at most `16` attempts;
- initial complete snapshot: at most `1400` attempts;
- daily realization reserve: at least and at most `1600` attempts;
- unallocated safety margin: `183` attempts, unusable without a new contract addendum.

No phase may borrow from another. A retry consumes a unit forever. Exhausting a tranche returns
`BLOCKED_EXTERNAL_BUDGET`; it does not create a second authority or shrink the denominator.

## 5. Authorization boundary

This contract does not itself authorize network acquisition. Activation requires one explicit human
authorization naming this contract hash and permitting only the source map in section 4 for facts
first opened after activation. The checkpoint must then pin:

- authorization receipt and activation-record hashes;
- owner `Codex`, attempt `C0`, allowed components and output root;
- eligibility interval and deterministic date rule, plus the fixed request tranches above;
- the still-forbidden production, hold-out, broker, order and capital capabilities.

The activation interval begins on its Shanghai-local activation date and ends 45 calendar days
later. After the calendar response is sealed, the collector chooses the first exchange month-end
trading day `D` in that interval for which collection can complete after `D` close and before the
next trading session's 09:15 outcome boundary. It then writes a denominator-freeze receipt pinning
exact `D` and the next effective session **before any security-value request**. If no such pair
exists, the result is `BLOCKED_DATA_CALENDAR`; dates are never caller-selected or backfilled.

Before activation, Codex must also create a fresh **stat-only** production-boundary receipt for the
canonical main/WAL/SHM/writer-lock paths and their exact current identities/states. The collector
may compare `lstat/realpath/bigint stat` only; it may not open the DB or sidecars. Main identity,
unexpected sidecar or holder drift returns `INCIDENT` and stops before shadow-store/network work.

Facts downloaded under an earlier stage are not forward evidence unless they were already opened
after this contract and are named in the activation exact-set. The stale `2026-10-30` bootstrap
clock in contract 108 may be used only as a deterministic regression fixture.

## 6. Workflow and branches

### Step A — bind before side effects

Validate checkpoint, contract, receipt, provider identities, authority inode and the fresh stat-only
production receipt.
Any mismatch returns `REFUSED_STALE_OR_UNAUTHORIZED_HANDOFF`; network attempts and writable opens
remain zero.

### Step B — metadata discovery and denominator freeze

Reserve before each request. Collect calendar and membership metadata inside the `16`-attempt
tranche, persist raw bytes, derive dates by the frozen rule, then seal the exact dates, membership
and request plan before opening security facts.

- timeout/rate-limit: bounded retry with durable attempts, then `BLOCKED_EXTERNAL`;
- incomplete or unstable membership/page count: `BLOCKED_DATA`, no denominator shrink;
- concurrent runner: authority reservation and collector lease allow one owner; loser exits without
  duplicating a request or snapshot;
- crash after reservation: the unit remains consumed; restart resumes from sealed raw bytes and
  never rewrites a terminal.

### Step C — PIT snapshot construction

Collect every mandatory E01–E17 domain inside the `1400`-attempt tranche, normalize only after raw
persistence, and build the exact selector input. Every row carries provider, request, raw hash,
retrieved/available/effective timestamps, units and normalization version.

Missing/ambiguous facts produce `BLOCKED_DATA`. They never produce `false`, `0`, a stale row or an
eligible candidate. A complete snapshot must independently reproduce candidate identities, reasons,
scores and the C1 proposed-weight surface.

### Step D — ex-ante prediction

On the first eligible monthly decision after activation, call the accepted plan builder and commit
the input exact-set plus prediction before the effective session's outcome boundary. A late receipt
is terminal `MISSED_FORWARD_SESSION`; it cannot be backfilled or counted.

### Step E — daily realization

After each close, use only the `1600`-attempt realization reserve and collect bars for the exact holdings/order/fact denominator, both benchmark
returns and the exact effective corporate-action set. Submit realization atomically; incomplete
facts leave zero economic commit and are retryable until the session deadline.

### Step F — qualification and stop

Count only distinct, complete, prospective sessions. Pause on accepted breakers: shadow drawdown
`>5%`, cumulative return `<-3%`, two consecutive missing snapshots, identity/PIT/reconciliation/
lease/capability drift or any forbidden touch. Twenty sessions allow operational review; forty mark
preferred operational evidence. Neither state advances capital automatically.

## 7. Observable states and cleanup

| State | Operator evidence | Persistent state | Recovery |
| --- | --- | --- | --- |
| `PENDING_AUTHORIZATION` | contract and missing receipt | no new DB/network row | human authorization only |
| `DISCOVERING` | request ledger and phase counters | raw immutable responses + reservations | bounded resume |
| `BLOCKED_EXTERNAL` | provider/timeout reason | consumed attempts retained | resume same C0 after source recovers |
| `BLOCKED_DATA` | exact missing identities | no prediction/economic commit | new source contract or later complete fact |
| `PREDICTION_RECORDED` | receipt/input hashes | append-only prediction | await effective session |
| `SESSION_COMPLETED` | realization/NAV/benchmark hashes | append-only journal and qualification | next session |
| `PAUSED_BREAKER` | breaker code and causal rows | no later automatic predictions | human review; no auto-resume |
| `FAILED_CORRECTNESS` | invariant/finding | failing bytes retained | one consolidated R1 at most |

Cleanup never deletes raw bytes, reservations, terminals, predictions, journals or failure evidence.
Disposable scratch databases may be moved to a named quarantine only after their exact path is
validated. Production files and accepted artifacts are never cleanup targets.

## 8. Acceptance matrix

Each invariant needs one positive and one falsifying negative using the real production entry point.

| ID | Invariant | Decisive negative |
| --- | --- | --- |
| FC-01 | exact checkpoint/contract/authority binding before side effects | drift one hash or authority inode |
| FC-02 | one durable request budget and reserve-before-socket | crash or two-process last-unit race |
| FC-03 | complete E01–E17 source map, units and raw-byte lineage | remove total shares, audited peer field, report-period lineage, valid-empty partition, page or raw hash |
| FC-04 | denominator frozen before fact normalization | mutate membership after first fact open |
| FC-05 | PIT availability and dated industry | future report or current industry backfill |
| FC-06 | raw execution prices and trade-state semantics | qfq/close substituted for raw open |
| FC-07 | official total-return B0/B1 | price-only index or proxy promoted |
| FC-08 | selector and candidate set independently reproduced | caller injects a symbol/score/reason |
| FC-09 | prediction genuinely before outcome | late/backfilled receipt |
| FC-10 | incomplete session has zero economic commit | omit one bar, benchmark or action |
| FC-11 | C1/U3 identities and caps unchanged | alter cap, multiplier or admit a new name |
| FC-12 | idempotent, single-owner append-only lifecycle | duplicate/concurrent prediction or terminal |
| FC-13 | breaker and missing-session logic | suppress a breaker or count a missing day |
| FC-14 | independent replay from raw facts | mutate target, fill, fee, tax, action or NAV |
| FC-15 | zero production/trading capability | alias/hardlink/global Prisma/broker/order/capital probe |
| FC-16 | prospective session accounting | fixture/bootstrap/historical row counted forward |
| FC-17 | new isolated runtime store, accepted bytes immutable | point writer at an accepted DB or mutate an accepted seal |
| FC-18 | current production identity checked stat-only | main/sidecar/lock identity drift or any open attempt |
| FC-19 | numeric phase tranches cannot borrow | snapshot consumes realization reserve or safety margin |
| FC-20 | date selection is calendar-derived and non-circular | caller date, no freeze receipt, or security request before date freeze |

Mandatory final checks are targeted unit/falsification tests, disposable-DB integration, independent
raw-to-plan and journal replay, child-aware network-attempt audit, both TypeScript checks, exact-set
source seal and read-only package verification. Full repository regression runs once on the final
candidate; unrelated failures are separated, never relabelled.

## 9. Terminal gate

Before activation the only state is `FROZEN_AWAITING_EXPLICIT_SOURCE_AUTHORIZATION`. After activation
the legal C0 outcomes are:

- `C1T_FORWARD_COLLECTOR_CANDIDATE_AWAITING_CODEX`;
- `C1T_FORWARD_COLLECTOR_BLOCKED_EXTERNAL`;
- `C1T_FORWARD_COLLECTOR_BLOCKED_DATA`;
- `C1T_FORWARD_COLLECTOR_FAILED_CORRECTNESS`;
- `C1T_FORWARD_COLLECTOR_INCIDENT`;
- `CANCELLED`.

Acceptance of code enables no network schedule by itself. The separate operational gate remains
`C1T_OPERATIONAL_SHADOW_20_SESSION_GATE`; any capital pilot remains a separate Stage 18 human gate.

