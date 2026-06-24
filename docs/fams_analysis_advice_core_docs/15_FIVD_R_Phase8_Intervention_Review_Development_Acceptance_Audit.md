# FIVD-R Phase 8：人工复核与干预记录开发验收审计

版本：v0.1  
日期：2026-06-02

## 1. 阶段目标

Phase 8 的目标是支持用户对 FIVD-R 结果进行人工复核，并保留 append-only 审计记录。

本阶段不允许人工复核覆盖模型原始结果，不允许人工复核绕过 `validation_evidence`，不开放自动交易。

## 2. PRD 规格检视

对应总 PRD 和模型架构要求：

- 人工复核必须记录 review decision、reason、runId、evidenceRefs、reviewer、createdAt。
- 人工干预必须 append-only，不覆盖原始模型输出。
- 人工复核只能进入研究结论或交易计划草案，不开放自动交易。
- 后续 replay 能引用人工复核记录。

当前实现差距：

- Phase 7 已有 replay 产物，但没有人工复核记录表。
- 当前系统没有 FIVD-R intervention append-only 服务。
- 当前没有 hash chain 或等价机制证明记录未被覆盖。

规格结论：

- Phase 8 与总 PRD 一致。
- 必须落地持久化记录和链路审计，不能只输出临时 JSON。

## 3. 开发计划

开发内容：

1. 新增 `FivdRInterventionReview` 表。
2. 新增服务：
   - createReview
   - listReviews
   - verifyChain
3. 记录字段：
   - userId
   - runId
   - positionId
   - symbol
   - decision
   - reason
   - reviewer
   - modelResultRef
   - evidenceRefs
   - override
   - previousHash
   - recordHash
   - createdAt
4. 新增 API：
   - `POST /api/v1/analysis/fivd-r/interventions`
   - `GET /api/v1/analysis/fivd-r/interventions`
   - `GET /api/v1/analysis/fivd-r/interventions/audit`
5. 新增真实数据验收脚本。

## 4. 验收计划

固定命令：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

真实数据端到端验收：

1. 创建真实 FIVD-R position run。
2. 对该 run 创建第一条人工复核记录。
3. 对同一 run 创建第二条人工复核记录。
4. 验证第一条记录未被覆盖。
5. 验证第二条记录 `previousHash` 指向第一条 `recordHash`。
6. 验证 hash chain audit 通过。
7. 验证人工复核没有 approve formal trade action。
8. 输出 `.verification/fivd-r-phase8-intervention-review-audit.json`。

## 5. 开发前审计意见

审计时间：2026-06-02。

结论：允许进入 Phase 8 实质开发。

致命风险：无。

重大风险：无。

一般风险：

1. 数据库本身不能禁止管理员直接改表。
   - 闭环要求：业务服务只提供 create/list/verify，不提供 update；通过 hash chain 发现篡改。
2. 人工复核可能被误读为交易放行。
   - 闭环要求：decision 枚举不提供 approve_trade_action，本阶段只允许 research-only、reject、request evidence、manual watch。

## 6. 开发后实现结果

实现时间：2026-06-02。

实现结论：Phase 8 实质开发已完成。

实现内容：

- 新增 Prisma 模型 `FivdRInterventionReview`。
- 新增 `fivdRInterventionService`。
- 新增 hash-chain append-only 审计。
- 新增 FIVD-R intervention API。
- 新增验收脚本 `backend/scripts/verify-fivd-r-phase8-intervention-review.ts`。

## 7. 真实数据端到端验收结果

验收时间：2026-06-02。

专项命令：

```text
node node_modules/tsx/dist/cli.mjs scripts/verify-fivd-r-phase8-intervention-review.ts
```

验收结果：通过。

真实样本：

- runId=`fivd-r:default:1780398413513`
- symbol=`009725`
- records=`2`
- chainOk=`true`
- firstUnchanged=`true`
- secondLinksFirst=`true`

验收产物：

- `.verification/fivd-r-phase8-intervention-review-audit.json`

专项验收判断：

- 真实 FIVD-R run 已创建。
- 两条人工复核记录均持久化。
- 第一条记录未被第二条覆盖。
- 第二条记录 hash link 指向第一条记录。
- 人工复核未绕过 validation gate。
- 未使用 mock 数据作为端到端通过依据。

## 8. 固定门禁复验结果

复验时间：2026-06-02。

已通过：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
```

关键结果：

- FIVD-R core 通过，`validationSource=fivd_r_internal_validation_tournament`。
- Production readiness 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- 最新 evidence operation=`15fae43c-c208-47b7-9596-90dedc99377b`。
- `blockerGateIds=["validation_evidence"]`。

固定负向门禁：

```text
backend: npm run test:trade-action-readiness
```

结果：按预期失败。

判断：

- `tradeActionReady=false`
- `readyForManualTradeDraft=false`
- blocker=`validation_evidence`
- 人工复核未绕过交易 gate。

## 9. 开发后审计意见

审计时间：2026-06-02。

结论：Phase 8 验收通过，允许进入 Phase 9 开发前计划与审计。

致命风险：无。

重大风险：无。

一般风险：

1. hash chain 能发现篡改，但不能阻止数据库管理员直接写表。
   - 审计意见：这是当前 SQLite 架构限制；后续可通过数据库权限和审计日志加强。
2. 前端人工复核 UI 尚未实现。
   - 审计意见：当前 API 和持久化链路已完成，前端 UI 可作为后续增强，不影响 Phase 8 核心 append-only 审计通过。
