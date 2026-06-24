# FIVD-R Phase 18.14：候选评分到研究观察闭环开发计划、验收标准与审计意见

日期：2026-06-03

## 1. 阶段目标

将“选股候选 -> FIVD-R 评分 -> 研究观察动作”形成可用闭环。该阶段只允许研究快照、观察、风险提醒，不允许任何交易动作。

## 2. 开发范围

后端：

- 复用现有 `POST /api/v1/analysis/fivd-r/candidates` 输出。
- 验证候选默认按 `evidenceAdjustedScore` 排名。
- 验证 validation evidence 未通过时，候选只能进入研究/观察动作。
- 验证候选级研究快照保存路径。

前端：

- Candidate FIVD-R 卡片新增“保存快照”。
- 候选卡保留“加入观察”和“风险提醒”。
- 候选快照 payload 明确写入 `allowedActions`、`prohibitedActions`、`blockedReasons` 和 evidence gate。

## 3. 验收标准

- 使用真实候选列表至少 10 个候选完成 FIVD-R scoring。
- 候选按 `evidenceAdjustedScore` 排序。
- validation evidence 未通过时，无候选允许 `ADD / REDUCE / AUTO_TRADE`。
- 候选可保存研究快照，并返回 operation artifact。
- 前端 build 通过。

## 4. 审计意见

风险等级：minor

本阶段只补研究动作闭环，不新增交易动作、不修改 validation gate、不修改 trade-action-readiness 预期失败状态。

## 5. 实施结果

已完成：

- `CandidateScoreBreakdown` 增加“保存快照”按钮。
- `Analysis` 增加 `handleSaveFivdRCandidateSnapshot`。
- 候选快照保存到 `POST /api/v1/analysis/fivd-r/snapshots`。
- 快照 result 使用 `scope=candidate`，并保留候选级 summary、evidenceGate、blockers、allowedActions、prohibitedActions。
- 前端 `saveFivdRResearchSnapshot` 类型放宽为支持通用研究 result。

## 6. 真实数据验收

候选评分 smoke：

```json
{
  "schemaVersion": "fivd.r.candidate_batch.v1",
  "analyzed": 10,
  "observable": 10,
  "manualReviewEligible": 0,
  "blocked": 10,
  "anyTradeAllowed": false,
  "allProhibitTrade": true,
  "sortedByEvidenceAdjusted": true
}
```

Top 5：

```json
[
  {
    "rank": 1,
    "symbol": "000333",
    "name": "美的集团",
    "signalScore": 66,
    "researchScore": 66,
    "evidenceAdjustedScore": 33,
    "disposition": "observe_only",
    "capabilityState": "TRADE_BLOCKED",
    "blockers": ["validation_evidence"],
    "allowed": ["RESEARCH", "OBSERVE", "SNAPSHOT", "WATCH", "RISK_ALERT"],
    "prohibited": ["ADD", "REDUCE", "AUTO_TRADE"]
  },
  {
    "rank": 2,
    "symbol": "600000",
    "name": "浦发银行",
    "evidenceAdjustedScore": 32,
    "disposition": "observe_only",
    "capabilityState": "TRADE_BLOCKED"
  }
]
```

候选快照 smoke：

```json
{
  "schemaVersion": "fivd.r.research_snapshot.v1",
  "operationId": "87126748-019f-4c89-a1c2-5a1aedc87190",
  "runId": "fivd-r:candidates:default:1780489851355",
  "artifactRefs": [
    "operation_artifact:87126748-019f-4c89-a1c2-5a1aedc87190:fivd_r_research_snapshot.json"
  ],
  "scope": "candidate",
  "prohibitedActions": ["ADD", "REDUCE", "AUTO_TRADE"]
}
```

## 7. 命令验收

已通过：

```bash
cd backend
node node_modules/typescript/bin/tsc

cd frontend
npm run build
```

沿用 Phase 18.13 本轮完整验收结果：

- `npm run test:fivd-r-core` 通过。
- `npm run test:production-readiness` 通过。
- `npm run test:trade-action-readiness` 按预期失败，blocker 为 `validation_evidence`。

## 8. PRD 规格检视

检视结果：

- 符合“选股到 FIVD-R 决策支持闭环”的研究/观察目标。
- 候选高分只作为研究排序，不作为买入、加仓或减仓指令。
- Snapshot/watch/risk-alert 只创建研究 artifact 或观察记录，不创建 transaction、manual trade draft 或 advice execution。
- validation evidence 未通过时，所有候选继续禁止 `ADD / REDUCE / AUTO_TRADE`。

剩余缺口：

- 前端还需要补“候选观察池列表/历史快照列表”的统一入口。
- candidate scoring 仍主要依赖 market_feature_daily 和 identity resolver，基本面/估值事实集对新候选仍偏弱。
- validation evidence 未通过，候选不能进入 manual trade draft。
