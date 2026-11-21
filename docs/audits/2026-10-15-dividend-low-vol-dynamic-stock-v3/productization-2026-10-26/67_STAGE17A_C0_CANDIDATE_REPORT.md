# DLV3 Stage 17A C0 candidate report

Date: 2026-10-29  
Contract: `dlv3.stage17a-independent-qualification.v1`  
Attempt: immutable `C0`  
Implementation owner: Codex  
Candidate: `backend/data/gpt-audit/dividend-low-vol-stock-v3/scratch/DLV3-STAGE17A-C0-20261029T025142Z`  
Terminal state: `STAGE17A_REJECTED_ECONOMIC_AWAITING_HUMAN`

## Outcome

The frozen X2Q challenger was replayed once on the previously unopened `2010-01-01..2017-12-31`
physical domain.  Correctness verification is green, but the conjunctive qualification contract is
not met.  This is an economic rejection, not a request to tune the challenger.

| gate | result | observation |
| --- | --- | --- |
| Q17A-01 | pass | atomic first value-open receipt and 12 cumulative trials bound |
| Q17A-02 | fail | 28,800 identities conserved; one missing decision price (`000024`, 2015-12-31); selected execution evidence complete |
| Q17A-03 | pass | zero future/current-label leakage after preflight remediation |
| Q17A-04 | pass | all invested dates satisfy the frozen X2Q diversification/allocation rules |
| Q17A-05 | fail | Sharpe 0.601, Sortino 0.841, Calmar 0.298, max drawdown 24.24% |
| Q17A-06 | fail | positive starts 53.09%, P10 annualized -10.88%, median Sharpe 0.264, worst drawdown 24.24%, return IQR 22.49pp |
| Q17A-07 | pass | 100 bps / delays 1, 3, 5 remain above -5%; accounting residual below 0.01 CNY |
| Q17A-08 | pass | strategy annualized 7.22%, B0 annualized 3.77%, common coverage 100% |
| Q17A-09 | fail | DSR probability 0.000398%; PBO 55.71% |
| Q17A-10 | pass | independent full rebuild `VERIFIED`, zero findings |

Main 25 bps result: total return `71.20%`, annualized return `7.22%`, annualized volatility
`13.01%`, Sharpe `0.601`, maximum drawdown `24.24%`.  There were 96 decision dates, 82 invested
dates, 14 `DIVERSIFICATION_INSUFFICIENT` dates, 1,640 selected identity occurrences, and 15,437
complete factor identities.

## Data and value-open evidence

- metadata identities: `111/111`;
- physical partitions: `33,329/33,329`;
- identity-set SHA-256: `856032786851dcd47a307198f7e0695dc7567a16162888ad5ff54ca887c933d8`;
- first value-open count: exactly `1`;
- first value-open receipt SHA-256: `2e77aa51b6b6d28cba0e6d3bff098aa3f3680fea6fe993c975edb7b2f8ba55a1`;
- physical manifest SHA-256: `06c99c936042c19ac134609c4bb665f9ee5ccd432de8437f9ff91c8a01a498ef`;
- maximum physical fact date: `2017-12-31`;
- hold-out, production DB/service, MCP, broker and order touches: all `0`.

Preflight found and failed closed on three source/validation issues before any statistical output:
Python/TypeScript numeric lexeme canonicalization, provider transport timestamps, later
restatement/current security-master labels.  The physical values were repaired by hashing the exact
producer token, removing non-fact transport timestamps, excluding post-domain fact rows, and
retaining only PIT-safe security-master identity/listing fields.  No strategy parameter or economic
gate changed.

## Verification

- independent verifier: `VERIFIED`, `0` findings, SHA-256
  `a1d63c8d64577578e537dabe19065439c3e0d99d4d2d3d3e849583e17949ed02`;
- distinct absolute-root replay: byte-identical result SHA-256
  `279f391af70bf2438a7eb62b7988f048a3b4d0d6a2df8a7e5899a9445955b914`;
- unit suite: `10/10`;
- falsification suite: `10/10`, zero skipped;
- final regression: `6/6` (backend/scripts typecheck, Prisma validation, unit, falsification,
  value-open idempotence);
- candidate recursive checksum: exit `0`, 42 files;
- candidate `SHA256SUMS` SHA-256:
  `0beee55bec9b11436b3fa4c3a3574f54c509a85b2f0f4b23cc5e973916207cc1`.

The first independent-verifier run rejected a verifier-only output-order mismatch.  It is preserved
inside the candidate.  The verifier was corrected to reconstruct the frozen `industryCode, symbol`
ordering; production results were not changed.

## Boundaries and next gate

No Stage 17B shadow activation, production database/service/scheduler, schema migration, MCP,
broker, order, capital deployment, final hold-out reuse, or same-sample challenger search occurred.
The roadmap states that a Stage 17A economic failure retires X2Q on this evidence.  The next action is
a human research-route decision; Stage 17B and Stage 18 remain locked.

