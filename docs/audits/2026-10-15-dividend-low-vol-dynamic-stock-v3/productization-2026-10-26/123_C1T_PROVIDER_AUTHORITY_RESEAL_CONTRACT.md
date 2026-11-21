# C1T provider authority reseal — frozen authorization contract

**Stage:** `C1T-PROVIDER-AUTHORITY-RESEAL`  
**Classification:** new authorization artifact required by review 122  
**Status:** `FROZEN_AWAITING_EXPLICIT_USER_AUTHORIZATION`  
**Owner after authorization:** Codex  
**ClaudeCode budget:** `0`; no R2; formal candidate budget `0`

## Objective

Replace no bytes. Preserve the rejected authority and issue a new, additive authorization chain to
a newly created empty scratch authority whose initial schema already satisfies contract 115 and
addendum 120.

## Exact permitted action

1. Create one new database under a new `C1T-PROVIDER-AUTHORITY-RESEAL-*` scratch root.
2. Before sealing, create exactly the three authority tables, their exact foreign key and the four
   append-only UPDATE/DELETE triggers accepted by the current validator.
3. Insert exactly one singleton lineage row with total `3200`, baseline consumed `1`, zero
   reservations and zero terminals.
4. Run full integrity, foreign-key, schema, trigger and disposable two-process tests.
5. Freeze a new receipt, activation record and checkpoint anchors with exact path, device, inode,
   bytes and SHA-256. The former receipt, activation and database remain immutable historical
   evidence.
6. Re-run the corrected 52-case verifier, durable-budget regression, accepted 36-case regression,
   both typechecks and aggregate zero-network proof.

## Prohibited

- modifying, deleting, renaming or adding triggers to the old authority;
- consuming a formal reservation;
- any real network or provider request;
- production DB/service/scheduler/MCP/broker/order/capital/hold-out access;
- changing accepted economics, policy domains, provider identity or attempt total;
- delegating another ClaudeCode correction.

## Acceptance

- the new initial authority is exact and sealed;
- a disposable byte-equivalent authority proves append, close and mutable reopen under the same
  validator; copy/hardlink/schema/trigger/request/terminal drift all fail closed;
- the new formal authority remains `reservations=0`, `terminals=0` after acceptance;
- zero forbidden counters and zero network syscalls;
- one immutable Codex acceptance receipt activates the corrected L2A lineage.

## Terminal states

`ACCEPTED`, `REFUSED_STALE_OR_UNAUTHORIZED_HANDOFF`, `BLOCKED_EXTERNAL`, `INCIDENT`, or `REJECTED`.

DLV3坐标：已完成 C1T_OPERATIONAL_SHADOW_DEVELOPMENT_ACCEPTED → 当前
C1T-PROVIDER-AUTHORITY-RESEAL / CONTRACT_FROZEN_AWAITING_AUTHORIZATION → 下一门限
AWAITING_USER_AUTHORIZATION_C1T_PROVIDER_AUTHORITY_RESEAL；计划完成度约 100%
