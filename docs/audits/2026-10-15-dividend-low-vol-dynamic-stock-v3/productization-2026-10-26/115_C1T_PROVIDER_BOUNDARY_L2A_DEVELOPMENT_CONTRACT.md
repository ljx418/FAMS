# C1T provider boundary L2A — frozen development contract

**Stage:** `C1T-PROVIDER-BOUNDARY-L2A`  
**Contract version:** `dlv3.c1t-provider-boundary.v1.0`  
**Status:** `FROZEN_AWAITING_EXPLICIT_AUTHORIZATION`  
**Implementation budget:** one disposable/scratch ClaudeCode `C0`; at most one consolidated `R1`; no `R2`; formal/published candidate budget `0`

## 1. Classification and ownership

Two findings are deliberately separated.

1. The accepted C1T adapter governed the receipt's **total** attempt budget with a process-local
   counter. That violated frozen contract 108 §8.1 and was an `implementation_defect` missed in the
   prior review. It is Codex-owned, not a new Claude budget. Codex replaced the governing counter
   with append-only SQLite reservations and terminals in the isolated shadow store; reservation is
   committed before child/socket, restart does not reset it, and an unterminated reservation remains
   consumed. The targeted disposable regression is 8/8 and both backend typechecks pass. The old
   36-case entry point currently refuses because its accepted startup pins the superseded checkpoint
   byte hash; this Stage replaces that stale authorization binding and must not call that refusal a
   pass.
2. Authorizing a different, independently observed BaoStock distribution identity and consuming it
   through a checkpoint-anchored boundary is `new_scope`. That is the only ClaudeCode C0 scope here.

The new Stage may bind the already-corrected durable authority to one authorized database; it may not
re-implement or loosen its reservation semantics.

## 2. Objective and non-objectives

Build a development-only boundary that:

- consumes a new additive provider authorization without changing artifacts 108–114;
- validates the installed distribution against an exact manifest and `dist-info/RECORD` before any
  DNS, socket, child query or HTTP request;
- binds the existing durable budget implementation to one checkpoint-pinned authority database;
- exposes a zero-network preflight for a later forward collector;
- preserves accepted prediction, realization, ledger, economics and network policy.

It does **not** perform provider acquisition, prediction, realization, production access, service or
scheduler start, UI/MCP work, broker/order/capital action, hold-out use or Alpha research.

## 3. Frozen inputs

Observation `115A_C1T_PROVIDER_IDENTITY_OBSERVATION.json` has SHA-256
`150bcf8a8dfef3c861d43d9b2309d440e7039aab80889970617ffd00ddd1cb35` and contains the exact
53-file path/size/SHA manifest. It is evidence, never authorization.

| Input | Frozen value |
|---|---|
| distribution / pip / module | `baostock` / `0.9.1` / `00.9.10` |
| endpoint | `public-api.baostock.com:10030` |
| source file count / aggregate | `53` / `3d8608941fad987098b1dd0e18e0136ac31732e76b858cf31cdfff40c4bde40f` |
| RECORD | `846633dd73a374ffb086809de3d82fa32457b06c20ce6502965d9d2814a631d3` |
| METADATA | `de9dc78a08da61d11a5abf1b84b590451fb71d625352b1d7b5c8d24d539d0883` |
| WHEEL | `b59a1e1a3b56c5645f769944ec4ddde3954f94b3509ef6ca8989f1ee0c00cbc0` |
| Python executable | `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f` |
| total / accepted baseline / maximum remaining | `3200 / 1 / 3199` |
| original authorization 110 | `7e2f0354bbec9f8ee2c13107ccfd1cce3d27044209475780f450c6f093c64491` |
| acceptance 114 | `f2531af2c3dd58de8fd25d4d8b2203f5084364728ec0984ce89ff8717e1a8dcf` |
| pre-L2A BaoStock helper | `fa4f86b8191d0c2122542673fc32276d60ab6337b895e50c6800e5669a908c05` |

The installed package is also bound by the five `dist-info` hashes recorded in 115A. No expected
value may be generated from the same tree being tested.

## 4. Authorization chain — no self-attestation

A prompt is dormant. Before C0, after explicit human authorization, Codex must:

1. create and freeze a provider authorization receipt;
2. create the empty authority database and singleton baseline under the authorized scratch root;
3. create a budget-activation record where
   `budgetAuthorityId = sha256(canonicalJson({authorizationReceiptSha256,total:3200,baselineEvidenceSha256,schemaVersion}))`;
4. update the authoritative checkpoint with receipt path/SHA, activation path/SHA, contract path/SHA,
   stage, immutable attempt `C0`, owner `ClaudeCode`, authority database canonical path and exact
   device/inode, authority ID, C0/R1 budgets and forbidden boundaries.

ClaudeCode treats both receipts and the checkpoint as read-only. Startup discovers the checkpoint
from the repository-owned constant path, recomputes the receipt/activation hashes, and compares every
anchor. Caller paths, receipt self-reported hashes and implementation constants are not authority.
Missing, stale or drifting anchors refuse before any writable database open or process spawn.

## 5. Exact provider verification

The verifier resolves the installed distribution root from the pinned interpreter. For every RECORD
row it must:

- decode `sha256=<URL-safe-base64-without-required-padding>` to exactly 32 bytes;
- resolve the POSIX relative path beneath the distribution root without traversal;
- reject duplicate paths, case-fold collisions, symlinks and non-regular files;
- verify declared size and digest; the RECORD row for RECORD itself may have empty digest/size and is
  handled only by the separately pinned physical RECORD hash;
- require an exact set: all 53 package files from 115A, no missing/extra package file except excluded
  `__pycache__`/`.pyc`, and the exact pinned dist-info files.

Then it verifies pip/module version, aggregate manifest, interpreter, helper, host and port. Any read
error or mismatch is `BLOCKED_EXTERNAL_IDENTITY`; it never repairs or installs anything.

## 6. Network policy is mechanically frozen

Baseline hashes at freeze:

- `fact-adapter.ts`: `f48a5d42cb6e9a5a0eeed5d3a4c8e7f92f8aa32c38ef9cfd45ea16e7308e9261`
- BaoStock helper: `fa4f86b8191d0c2122542673fc32276d60ab6337b895e50c6800e5669a908c05`
- durable authority: `0c6f9deb5181ee20445dedac326f1fb5759983584da67926a36491874b9ea745`

Only imports, provider-identity invocation, authorization-anchor consumption and authority binding in
`fact-adapter.ts` may change. `queryAllowed`, `dateInside`, `baostockParametersAllowed`, HTTP
scheme/host/path/method/query validation, retry/timeout/response ceilings, redirect denial,
membership/date/symbol/field/frequency/adjustflag domains and terminal recording semantics may not.
The helper is read-only.

An independent verifier must generate the complete allowed method/field/date/symbol Cartesian
boundary from the frozen receipt and prove one inside and every adjacent outside class is refused;
HTTP scheme, host, path, method, extra/missing query key and redirect are likewise covered. Existing
sample cases alone are insufficient.

## 7. Single durable authority binding

The accepted store authority is append-only:

- singleton row binds authority ID, receipt hash, `total=3200`, `baseline=1` and schema version;
- reservation is committed before child/socket and consumes forever, even without terminal;
- terminal is a separate append-only row, byte-identical replay only;
- sequence and consumed count derive transactionally from reservations.

The checkpoint-pinned authority path and exact identity are the only formal authority. Another path,
copied DB, different inode, receipt or authority ID refuses. Disposable tests use a distinct receipt
marked `testOnly=true`; they cannot initialize or impersonate the formal authority. A two-database
negative proves the second DB cannot become another formal 3,200-unit authority.

Terminal canonical JSON has this closed schema and no extra keys:
`sequence, transport, provider, method, url, query, status, redirectChain,
responseHeadersSha256, rawBytesSha256, byteLength, connections, terminal, reason`.
`transport ∈ {http,baostock}` and `terminal ∈ {ok,refused,budget_exhausted,failed}`; hashes are
64-lowercase-hex or null, counts are nonnegative integers, request hash binds the reservation, and
secrets/auth headers are forbidden.

## 8. Allowed changes

- new `operational/provider-identity.ts` and `operational/provider-authorization.ts`;
- narrow authorization/identity integration in `contracts.ts`, `startup.ts`, `fact-adapter.ts`,
  `network-attempt-authority.ts`, `store.ts`, `index.ts`;
- new `dlv3-c1t-provider-boundary-*` scripts;
- package script aliases and DLV3 script inclusion only;
- the exact authorized scratch root.

Receipt, activation, checkpoint, observation 115A, artifacts 108–114, helper, accepted candidate,
production DB/services, scheduler, UI/MCP, broker/order/capital and hold-out are read-only or forbidden.

## 9. Terminal behavior

```text
checkpoint/receipt/activation drift -> REFUSED_STALE_OR_UNAUTHORIZED_HANDOFF (zero DB/network)
identity mismatch/read failure      -> BLOCKED_EXTERNAL_IDENTITY (zero reservation/network)
authority path/identity/id mismatch -> FAILED_CORRECTNESS (zero reservation/network)
verified no-network preflight       -> CANDIDATE_AWAITING_CODEX
```

Reservation concurrency, crash and cleanup retain accepted semantics. No stale-lock recovery or broad
delete is allowed.

## 10. Acceptance matrix

Each item needs one positive and one falsifying negative.

| ID | Invariant | Decisive negative |
|---|---|---|
| L2A-01 | checkpoint pins contract, receipt, activation, owner and attempt | caller-selected or self-signed receipt refused before DB |
| L2A-02 | 108–115A and accepted candidate remain byte-identical | any drift fails audit |
| L2A-03 | RECORD algorithm and exact 53-file set verify | bad base64/size, duplicate/case collision, extra/missing/symlink each refused |
| L2A-04 | metadata/interpreter/helper/host/port exact | change one identity field |
| L2A-05 | policy surface unchanged and Cartesian verifier complete | adjacent outside method/field/date/symbol/URL/query class refused |
| L2A-06 | formal authority path/id/inode unique | copied or second DB cannot initialize as formal authority |
| L2A-07 | baseline imported once and restart durable | repeated open remains consumed=1 |
| L2A-08 | reservation precedes child/socket | child cannot start without committed reservation |
| L2A-09 | last unit is process-safe | two processes race: one reservation, one exhausted |
| L2A-10 | crash never refunds | unterminated reservation consumed after reopen |
| L2A-11 | terminal closed-schema and append-only | extra key or different second terminal refused |
| L2A-12 | total never exceeds 3200 | 3201st reservation refused |
| L2A-13 | production aliases/global Prisma remain closed | relative/case/symlink/hardlink/global client refused before open |
| L2A-14 | accepted economics unchanged | accepted dual-root economic hash stays exact |
| L2A-15 | forbidden capabilities stay false | any provider request/order/capital/production touch fails candidate |
| L2A-16 | C0 has zero network in entire process tree | syscall trace detects deliberate child DNS/connect, then real suite records zero |

Zero-network proof must run the whole C0/preflight suite in a network namespace and collect a
child-aware syscall trace, e.g. `unshare -Urn` plus `strace -f -e trace=network`, or an equivalent
mechanism. A negative child intentionally issuing DNS/connect must be detected. If the environment
cannot provide a valid mechanism, outcome is `BLOCKED_EXTERNAL`, never `passed`.

Mandatory deterministic checks: L2A unit, falsification and 32-case verifier; corrected durable-budget
regression; affected C1T matrix under the new checkpoint chain; backend and DLV3 script typechecks;
entry-point audit with unrelated failures separated.

## 11. Candidate return and gate

Return exact contract/receipt/activation hashes, changed files, independently recomputed manifest,
RECORD counts/mismatches, formal authority identity, two-DB refusal, concurrency/crash evidence,
syscall trace and negative-control trace, commands/exits, byte audits, and zero counters for network,
production, orders and capital.

This contract and its prompt do not authorize implementation. The next gate is
`AWAITING_USER_AUTHORIZATION_C1T_PROVIDER_BOUNDARY_L2A_C0`. Once the hash-pinned authorization chain
exists, ClaudeCode may create one **scratch development candidate**. It may not publish a formal
candidate or make a provider call. C0=1, consolidated R1≤1, R2=0, formal candidate=0.

DLV3坐标：已完成 C1T_OPERATIONAL_SHADOW_DEVELOPMENT_ACCEPTED → 当前 C1T-PROVIDER-BOUNDARY-L2A / CONTRACT_FROZEN_AWAITING_AUTHORIZATION → 下一门限 AWAITING_USER_AUTHORIZATION_C1T_PROVIDER_BOUNDARY_L2A_C0；计划完成度约 100%
