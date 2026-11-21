# Gate 16 negative research acceptance

Date: 2026-10-29  
Accepted by: user  
Decision: `ACCEPT_NEGATIVE_RESULT_AND_FREEZE_ONE_QUALIFICATION_CHALLENGER`

## Accepted interpretation

- Stage 16 R1 is accepted as a correct, reproducible negative historical result.
- No X1-X3 arm passed every frozen Stage 16 gate. No arm is promoted to forward shadow or
  production by this decision.
- U2 remains the immutable primary research baseline.
- X2 is retained as the sole production-qualification challenger because it passed eleven of twelve
  gates and failed only the frozen industry-concentration gate.
- X3 remains a descriptive comparator. X1 is closed as negative evidence.
- The Stage 10..16 development sample has no remaining alpha-search budget. No new factor family,
  weight search or same-sample threshold repair is authorized.

## Frozen identities

- Stage 16 R1 candidate:
  `backend/data/gpt-audit/dividend-low-vol-stock-v3/scratch/DLV3-STAGE16-R1-CODEX-20261028T151500Z`.
- Candidate seal-file SHA-256:
  `482d865181965680ca4e8955b904acb7ded1f4cd036e5457d034ca0666866b2b`.
- Result SHA-256:
  `14b488cc43e14056b0b137ed365a1e8beae6746d8246909e4d52122af5520203`.
- X2 target hash:
  `f2d7c888c617411d493fe4cd35c19f74f69f9e3317d740c9e6d1ded3fecee989`.
- X2 historical observations: annualized return 9.7282%, Sharpe 1.4931, maximum drawdown 5.5171%,
  turnover efficiency 5.4050%, maximum time-weighted industry share 26.6312%.

## Disclosure preserved

The sealed result's nested `inputs.contractSha256` was overwritten by the inherited Stage 13 input
identity, while `CANDIDATE.json`, the sealed Stage 16 contract and their hashes correctly bind the
Stage 16 contract. This metadata defect was found after the sole R1 and is not repaired in place.
Stage 17 binds the candidate seal, result hash, Stage 16 contract hash and X2 target hash as four
separate identities and never trusts the defective nested field. The negative economic result is
unchanged.

## Authority boundary

This acceptance closes Stage 16. It authorizes documentation freeze only. It does not authorize
Stage 17 implementation, data acquisition, value opening, shadow activation, scheduler, production
database access, MCP, broker access, order creation or capital deployment.

