# FIVD-R 统一开发及验收计划

版本：v0.2  
日期：2026-06-01

---

## 1. 总原则

```text
对外一套 FIVD-R 入口。
P4 竞标赛内化为 FIVD-R validation_tournament_agent。
先结构化，再解释。
先证据门禁，再人工复核。
Validation Evidence 未通过时禁止 formal ADD / REDUCE。
```

---

## 2. Phase 0：文档与 Schema 合并

目标：把旧 FIVD-R 开发计划和 P4 剩余计划合并成一条主线。

任务：

1. PRD 改为统一 FIVD-R 产品口径。
2. P4 不再作为外部产品模块，只作为内部验证机制。
3. 冻结 `fivd.r.analysis.result.v1`、`fivd.r.strategy_validation.v1`、`fivd.r.agent_trace.v1`。
4. 明确 `ADD / REDUCE / AUTO_TRADE` 的门禁条件。

验收：

```text
PRD 和开发计划均明确 P4 内化。
文档不再要求独立 P4 用户入口。
```

状态：第一段已完成。

---

## 3. Phase 1：统一 API 与输出结构

目标：提供 FIVD-R 单一入口，组合级和持仓级结果都从该入口返回。

任务：

1. 新增 `GET /api/v1/analysis/fivd-r`。
2. 后端 `analysisService.getFivdRAnalysis` 聚合：
   - 持仓研究。
   - 价值评估。
   - PositionAdvice。
   - 最新验证锦标赛 Operation。
   - 候选处置 artifact。
3. 前端服务新增 `getFivdRAnalysis`。
4. 新增 `test:fivd-r-core` 验证脚本。

验收：

```text
组合级结果包含 summary / evidenceGate / portfolio / strategyValidation / candidateDisposition / agentTrace。
持仓级结果包含 asset / valuation / tradingDiscipline / positionAdviceImpact。
Validation Evidence 未通过时 blockedReasons 包含 validation_evidence。
```

状态：第一段已实现。

---

## 4. Phase 2：内部多 Agent 编排

目标：把现有服务收敛成稳定的 FIVD-R 内部编排契约。

任务：

1. 将 `agentTrace` 从描述性字段升级为可审计步骤记录。
2. 固化五个内部 Agent：
   - evidence_agent
   - valuation_agent
   - validation_tournament_agent
   - discipline_agent
   - explanation_agent
3. 每个 Agent 输出 `status / evidenceRefs / blockedReasons / producedArtifacts`。
4. LLM 解释层只能消费结构化结果。

验收：

```text
每次 FIVD-R run 都有可追溯 agentTrace。
任一 Agent blocked 时 summary.status 不得为 available。
```

状态：第一段已实现。`agentTrace` 已包含顶层 `status / blockedReasons / evidenceRefs`，五个内部 Agent 均输出 `sequence / status / inputRefs / evidenceRefs / blockedReasons / producedArtifacts / output`。

---

## 4.5 Phase 2.5：阶段治理与审计门禁

目标：把 FIVD-R 后续阶段的开发、验收、PRD 检视和审计流程制度化。

任务：

1. 每个阶段开发前必须产出开发计划、验收计划、PRD 规格检视和审计意见。
2. 审计意见存在致命或重大项时，不允许进入实质开发。
3. 每个阶段完成后必须用真实数据端到端验收。
4. 验收失败时打回计划阶段，不允许降低 gate 或修改验收口径来通过。

状态：第一段已实现，见 `07_FIVD_R_Stage_Governance.md`。

---

## 5. Phase 3：统一前端面板

目标：前端不再让用户分别理解“价值评估”和“P4 竞标赛”，而是展示一套 FIVD-R 面板。

任务：

1. 新增或改造分析建议面板。
2. 展示：
   - 顶部结论。
   - 允许/禁止动作。
   - 价值评估。
   - 交易纪律。
   - 内部验证锦标赛摘要。
   - 候选处置。
   - 证据与缺口。
3. Operation 任务中心仍保留 artifact 审计能力，但作为“证据详情”，不是主入口。

验收：

```text
用户从一个入口可看到完整 FIVD-R 结果。
候选处置、验证矩阵和 OOS 复验可从证据详情打开。
```

---

## 6. Phase 4：交易动作 Readiness

目标：在保持研究链路可用的同时，继续推进正式交易动作门禁。

剩余计划：

1. 继续扩大 top-N / 多窗口验证，寻找能通过四项稳定性检查的候选组合。
2. 将 `validationCandidateDisposition.status=ready_for_manual_review` 接入 formal trade readiness。
3. 完善正式交易状态 provider 和市场约束覆盖。
4. 将人工复核记录纳入 FIVD-R run。
5. 对通过候选执行 paper trade，再进入人工交易计划复核。

验收：

```text
test:trade-action-readiness 通过前，不允许 formal ADD / REDUCE。
即使 research chain ready，也不得把观察建议包装成交易建议。
```

当前状态：

```text
研究/分析建议链路可用。
交易动作仍被 validation_evidence 阻断。
```

---

## 7. 剩余计划总索引

FIVD-R 剩余阶段总计划维护在：

```text
09_FIVD_R_Remaining_Roadmap.md
```

后续阶段顺序：

1. Phase 3.5：Position 级 FIVD-R 面板与性能审计。
2. Phase 4：Expected Return Distribution 第一段。
3. Phase 5：Trading Discipline Engine 完整化。
4. Phase 6：PositionAdvice Adapter 深度接入。
5. Phase 7：Advice Replay & Validation。
6. Phase 8：人工复核与干预记录。
7. Phase 9：Calibration 与 Model Tuning。
8. Phase 10：交易动作 Readiness 收口。

每个阶段均必须先完成开发计划、验收计划、PRD 规格检视和审计意见；无新增致命或重大审计意见后，才能进入实质开发。
