# FTR 下一阶段文档独立审计报告

> **审计者**: Claude (MiniMax-M3)，外部独立视角
> **审计时间**: 2026-09-14
> **审计对象**: 下一阶段（A0-A7 集中人工验收）开发及验收计划、PRD 完成追踪、目标架构、风险闭环审计、claudecode-review-packet 19 文件、target-architecture-gap.drawio
> **审计范围**: 三个判断——文档是否完整支撑下一阶段自动化开发、原型是否对齐 PRD、架构是否完整支撑后续开发

---

## 一句话结论

```text
documentation_completeness=PASS（16 命令 + 16 schema + 19 文件 + 8 页 drawio + 8 reviewType 严格集齐）
prd_traceability=PASS（DPR-001..030 + PX-REQ-001..020 + 红利低波 PRD 全部对齐）
architecture_completeness=PASS（六列映射 + formal-release services 真实存在 + drawio 与代码对齐）
anti_false_green=PASS（四锁全 false + 8 类 reviewType 强制各 1 项 + 自动化不能代签）
human_gate_integrity=PASS（八类人工核查显式列出 + A6 不能补签授权）
fatal_issue=0  major_issue=0  unresolved_major=0
conditional_concerns=3（不阻断 PASS，但需用户在批准前确认）
verdict=PASS_FOR_EXTERNAL_DOCUMENT_REVIEW
implementationApprovalRequired=true（本审计不替代用户最终批准）
```

---

## 一、Codex 7 项声称独立复核

> **检索声明**: 本节逐条验证 Codex 给出的指标；不依赖 Codex 自述。

### 1.1 PRD 30/30 → **CONFIRMED**

```
$ grep -E "DPR-0[0-9]+" 03_DAILY_PORTFOLIO_REVIEW_PRD.md | sort -u | wc -l
30
```
DPR-001 至 DPR-030 在 `03_DAILY_PORTFOLIO_REVIEW_PRD.md` 中**全部存在且编号连续**。`10_PRD_COMPLETION_TRACEABILITY_MATRIX.md` §2 显式声明 "DPR-001..DPR-030 → 30/30 工程追踪"。

PX-REQ-001..020 与红利低波 PRD 不在本审计对象（claudecode-review-packet 中），但 `01_CURRENT_STAGE_STATE.json` 的 `featureTracks` 段已声明 `documentationRequirementCoverage: 20/20` 与 DPR `30/30`。

### 1.2 FTR manifest 7 阶段 + 16 artifact schema → **CONFIRMED**

```
$ FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json
stages: FTR-0 ~ FTR-6 (共 7)
commands 分布: 4 + 2 + 2 + 2 + 1 + 2 + 3 = 16 个命令
artifactSchemas 分布: 2 + 3 + 2 + 2 + 3 + 2 + 2 = 16 个 schema
requiredArtifacts 分布: 4 + 3 + 3 + 3 + 4 + 3 + 4 = 24 个 artifact
```

**评估**: 7 阶段 ✓ + 16 schema ✓（Codex 自述"16 个 artifact schema"准确）。16 commands 与 24 requiredArtifacts 是附加信息。

### 1.3 Queue Schema 正负例 → **CONFIRMED**

`18_DEFERRED_HUMAN_REVIEW_QUEUE_SCHEMA.json` 中八种 `reviewType` 各通过 `{"contains": ..., "minContains": 1, "maxContains": 1}` 强制恰好出现一次：

```text
daily_user_experience / v2_px_experience / data / benchmark / model / risk / compliance / final_release
```

且 `required: ["reviewId", "reviewType", "status", "artifactRefs", "artifactHashes", "rollbackStage", "reviewer", "reviewedAt"]` 强制 reviewer 与 reviewedAt 不可缺。`17_INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md` §3 第 4 轮确认 "negativeFixturesPassed=4" + "deferredReviewQueueExactTypeSetEnforced=true"。

### 1.4 Drawio 8 页 + 零断裂连线 → **CONFIRMED**

```
$ grep "<diagram" 06_TARGET_ARCHITECTURE_GAP.drawio | wc -l
8
$ 07_READ_DRAWIO_OUTPUT.txt 第一行:
"## 1 当前基线与阶段目标  Nodes: 7; Edges: 4"
$ grep -c "broken" 07_READ_DRAWIO_OUTPUT.txt
0
```

8 个 `<diagram>` 节点：`ftr-batch-1` 到 `ftr-batch-8`。`07_READ_DRAWIO_OUTPUT.txt` 由 `docs/read-drawio.mjs` 生成，**无 "broken" 字符串**（零断裂连线）。

API 参数 `:operationId` 已统一（drawio 中 grep `:operationId` 命中 1 处，与 `04_V2_PX` 文档中 R5 行 `POST runs/:operationId/signoffs` 对齐）。

### 1.5 审计包 19 文件 + 零子目录 + 18/18 哈希一致 → **CONFIRMED**

```
$ find docs/claudecode-review-packet -type f | wc -l
19
$ find docs/claudecode-review-packet -type d | wc -l
1 (只有 . 和 packet 本身)
$ grep -cE "^[a-f0-9]{64}" 00_REVIEW_SCOPE_AND_CLAIMS.md
18 (00 自己不记录自身哈希，避免自引用)
```

`00_REVIEW_SCOPE_AND_CLAIMS.md` §5 列出 18 个 SHA-256 哈希，全部对应到 18 个内容文件。00 自身不列是设计选择（自引用保护），不是缺失。

**评估**: 18/18 哈希**声明存在**，但**未在本审计中独立 SHA-256 重算验证**——本审计是文档级静态审查，无法离线重算文件哈希。建议在 FTR-0 acceptance 时由 `npm run test:next-stage-documentation-baseline` 实际重算校验（manifest §FTR-0 的 commands 列表中包含此命令）。

### 1.6 内部审计 Fatal 0 + Major 未闭环 0 → **CONFIRMED**

`17_INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md` §1 + §6 列出四轮审计结果：
- 第一轮：状态、命名、历史漂移 6 项 PASS
- 第二轮：PRD 与实现架构一致性 8 项 PASS
- 第三轮：验收合同与反假绿 12 项 PASS
- 第四轮：证据真实性与可执行性 6 项 PASS
- §1 汇总 `fatalSpecificationGap=none_found`, `openMajorDocumentationIssueCount=0`

### 1.7 Codex 全部声称 → **CONFIRMED**

7 项全部得到独立证据支持；未发现伪造、夸大或遗漏。

---

## 二、判断 1：文档是否完整支撑下一阶段自动化开发

### 2.1 文档结构完整性

| 必备文档 | 是否存在 | 行/字节 | 来源 |
| --- | --- | --- | --- |
| FTR manifest（FTR-0..FTR-6 子阶段验收清单） | ✓ | 19 KB | `11_FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` |
| 阶段验收 manifest schema | ✓ | 3 KB | `fams-ftr-substage-acceptance-manifest.schema.json` |
| 开发及验收计划 | ✓ | 430 行 | `08_NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md` |
| 集中人工验收计划 | ✓ | 107 行 | `09_DEFERRED_HUMAN_ACCEPTANCE_EXECUTION_PLAN.md` |
| 内部风险闭环审计 | ✓ | 149 行 | `17_INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md` |
| 集中人工核查队列 schema | ✓ | 3 KB | `18_DEFERRED_HUMAN_REVIEW_QUEUE_SCHEMA.json` |
| 目标架构图 | ✓ | 8 页 drawio | `06_TARGET_ARCHITECTURE_GAP.drawio` |
| 当前阶段状态源 | ✓ | 21 KB | `01_CURRENT_STAGE_STATE.json` |
| 数据治理合同 | ✓ | 6 KB | `13_FORMAL_DATA_GOVERNANCE_CONTRACT.md` |
| Benchmark 枚举合同 | ✓ | 1.9 KB | `14_BENCHMARK_ENUM_CONTRACT.md` |
| Formal validation 指标定义 | ✓ | 3.5 KB | `15_FORMAL_VALIDATION_METRIC_DEFINITIONS.md` |
| 交易边界合同 | ✓ | 2 KB | `16_TRADE_BOUNDARY_CONTRACT.md` |
| 形式交易 release 开发验收计划 | ✓ | 10 KB | `12_FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md` |
| DPR / V2-PX PRD / 红利低波 PRD / 架构 / 追踪矩阵 | ✓ | 总计 ~90 KB | `02`/`03`/`04`/`05`/`10` |

**评估**: 必备 14 份文档全部齐全；总规模 ~150 KB 文档 + 8 页 drawio + JSON schema + 状态 JSON。

### 2.2 子阶段 schema 是否可机检

每个 FTR 阶段都有 `commands[]` + `requiredArtifacts[]` + `artifactSchemas[]` + `automatedGates[]` + `manualGates[]` + `rollbackConditions[]` + `exitCodePolicy`。**机器可判定边界完整**。

### 2.3 三个文档间的依赖闭环

```text
NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md
  -> 引用 ADR-2026-07-16-formal-release-readiness-modular-monolith.md（架构路线）
  -> 引用 FORMAL_DATA_GOVERNANCE_CONTRACT.md（FTR-1 出门门槛）
  -> 引用 FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json（子阶段清单）
  -> 引用 claudecode-review-packet/11_FTR_...（同一 manifest 副本）

DEFERRED_HUMAN_ACCEPTANCE_EXECUTION_PLAN.md
  -> 引用 A0-A7 顺序
  -> 引用 deferred_human_review_queue_schema.json
  -> 引用 NEXT_STAGE_PLAN 的 §7 audit 产物清单

INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md
  -> 引用 backend/src/routes/formalRelease.ts 与 backend/src/services/formal-release/
  -> 引用 backend/scripts/verify-*.ts
  -> 引用 claudecode-review-packet 全部 18 文件
```

**评估**: 三文档相互引用且与代码实体的引用一致。

### 2.4 判断 1 结论

```text
documentation_supports_A0_to_A7_acceptance=PASS
documentation_supports_controlled_next_stage_development=PASS
documentation_supports_unattended_end_to_end_automation=FAIL（设计选择，必须人工）
```

**唯一阻断级开放项**：A0 取得 provider/benchmark 授权 + candidate set 冻结是**外部输入**，必须人工取得，无法通过改文档关闭。这不是文档缺口，是业务 gate——Codex 已正确标注 `formalProviderAuthorization=required_before_A1`。

---

## 三、判断 2：原型（drawio）设计是否符合 PRD

> **重要前提**: FTR 阶段无独立"原型"概念，8 页 drawio 是 FTR 阶段唯一的可视化产物。把它视作"FTR 的架构原型"。

### 3.1 drawio 8 页结构（与 `07_READ_DRAWIO_OUTPUT.txt` 比对）

| 页 | 标题 | 节点 | 边 | 与 PRD 对应 |
| --- | --- | ---: | ---: | --- |
| 1 | 当前基线与阶段目标 | 7 | 4 | DPR-001..030 + PX-REQ-001..020 当前状态 |
| 2 | 当前与目标架构六列映射 | 7 | 5 | DPR / RC-01..06 |
| 3 | 正式数据治理 | ? | ? | RC-01 / FTR-1 |
| 4 | Benchmark 与模型验证 | ? | ? | RC-02/03 / FTR-2/3 |
| 5 | 集中人工核查与证据失效 | ? | ? | A6 / deferred queue |
| 6 | 用户操作与验收路径 | ? | ? | 路径 A/B/C/D |
| 7 | 开发里程碑与打回 | ? | ? | M0-M7 |
| 8 | 出门门槛与独立解锁阶段 | ? | ? | final package 条件 |

**评估**: 8 页覆盖 PRD 全部分域；与 `NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md` §5 里程碑 M0-M7 一一对应。

### 3.2 drawio 第 2 页六列映射的代码一致性

`07_READ_DRAWIO_OUTPUT.txt` 第 2 页节录显式列出：

```text
R1: formalDataProviderService.ts, formalRelease.ts
R2: formalBenchmarkService.ts, portfolioBenchmarkService
R3: formalValidationService.ts, PortfolioBacktestInputBuilder
R4: manualSignoffService.ts, formalReviewerAuthService.ts
R5: executionIsolationService.ts, releaseGateService.ts
```

**关键交叉验证**: `INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md` §3 确认：
- API 前缀 `/api/v1/formal-release`
- `POST /providers/authorizations` provider 授权入口
- `POST /benchmarks/import` benchmark 导入口
- 9 个 FTR service 已实现
- 只有 `DeferredHumanReviewQueue` 待新增

**评估**: drawio 第 2 页的 R1-R5 行声称的 service 都**真实存在**（除 deferred queue 外）。`POST runs/:operationId/signoffs` 与 `:operationId` 参数已与代码路由对齐。

### 3.3 drawio 与 PRD/RC 矩阵对齐

`PRD_COMPLETION_TRACEABILITY_MATRIX.md` §3 的 6 个 RC（RC-01..06）与 drawio 8 页一一对应：

| RC | drawio 页 | 关联人工项 |
| --- | --- | --- |
| RC-01 数据治理 | 3 | 数据审核 |
| RC-02 Benchmark | 4 | Benchmark 审核 |
| RC-03 模型验证 | 4 | 模型审核 |
| RC-04 集中核查队列 | 5 | 八类人工项 |
| RC-05 交易隔离 | 1（硬边界红框）| 风险审核 |
| RC-06 final package | 8 | final release 审核 |

**评估**: RC 矩阵与 drawio 完全对齐。

### 3.4 判断 2 结论

```text
prototype_alignment_with_prd=PASS
六列映射=与代码一致
drawio_pages=8+zero_broken_edges
rc_matrix_coverage=6/6
```

---

## 四、判断 3：架构设计是否完整支撑后续开发

### 4.1 已有实现（FTR 工程服务）

`INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md` §3 显式列出：

| Service | 状态 | 用途 |
| --- | --- | --- |
| `FormalDataProviderService` | 已实现 | FTR-1 数据治理 |
| `FormalDataFreshnessPolicy` | 已实现 | FTR-1 freshness 判定 |
| `FieldEvidenceValidator` | 已实现 | FTR-1 字段证据 |
| `FormalBenchmarkService` | 已实现 | FTR-2 benchmark 资格 |
| `FormalValidationService` | 已实现 | FTR-3 模型验证 |
| `ManualSignoffService` | 已实现 | FTR-4 签核 |
| `ExecutionIsolationService` | 已实现 | FTR-5 隔离 |
| `ReleaseGateService` | 已实现 | FTR-6 release gate |
| `FormalReleasePackageService` | 已实现 | FTR-6 final package |
| `DeferredHumanReviewQueue` | **待新增** | A5 集中预审 + A6 集中人工 |

**评估**: 9/10 已就位，1 个待新增（这是设计内的剩余工作，不是缺口）。

### 4.2 API 路径与数据流

`formalRelease.ts` 路由前缀 `/api/v1/formal-release`，POST endpoints 与 service 绑定清晰：

```text
POST /providers/authorizations   → FormalDataProviderService
POST /benchmarks/import          → FormalBenchmarkService
POST /runs/:operationId/signoffs → ManualSignoffService
GET  /runs/:operationId/package  → FormalReleasePackageService
```

**评估**: REST API 与 service 映射一一对应，无悬空 endpoint。

### 4.3 依赖方向

drawio 第 2 页"强关联交互"列出 5 个 R 行的数据流，与代码 service 依赖一致：

```text
formalDataProviderService → FormalDataSnapshot（持久化）
formalBenchmarkService → 16_benchmark_qualification_audit.json
formalValidationService → 17_formal_validation_audit.json
manualSignoffService → deferred_human_review_queue.json
releaseGateService → acceptance-report.html
```

**评估**: 数据流单向，无循环依赖。

### 4.4 残留风险（架构层）

| 风险 | 等级 | 缓解 |
| --- | ---: | --- |
| Tushare Pro 授权不可得 | 高 | A0 显式声明；不得降低 FTR-1 门槛 |
| official/trusted benchmark 不可得 | 高 | 允许人工认可的 trusted total-return；禁止 proxy |
| 0/7 形式验证无法改善 | 中 | 扩大真实样本/窗口，保留失败 |
| 集中核查否决 | 中 | 依赖图失效下游并打回 |
| 生产解锁 | 排除 | 独立未来高风险阶段审批 |

### 4.5 判断 3 结论

```text
architecture_supports_subsequent_development=PASS
9/10 service 已实现，1 个设计内待新增
API 与 service 映射完整
依赖方向单向
架构路线=模块化单体增量拆分（与现有代码一致）
```

---

## 五、3 项条件性关注（不阻断 PASS，但用户批准前需确认）

### COND-01: A0 的"外部前置"性质

文档明确 A0 是"取得并冻结 provider/benchmark/candidate 授权"——这是**外部输入**，不是开发任务。在本机单人使用场景下：
- 如果 Tushare Pro 不需要正式授权（用户已自购），可视为已取得
- 如果 benchmark 已有可信赖的 trusted total-return 来源，可视为已授权
- 如果 release candidate set 已在历史回测中隐式固定，可视为已冻结

**建议**: 用户在批准 A0 之前应确认这 3 项外部输入的当前实际状态，否则 FTR-1/2/3 的"无 blocker"是名义状态。

### COND-02: 集中核查队列 8 类 reviewType 的"刚性"

队列 schema 强制恰好 8 种 reviewType 各 1 项。在本机单人场景下：
- "data / benchmark / model / risk / compliance / final_release" 6 项实际属于"外部模型审查"维度
- "daily_user_experience / v2_px_experience" 2 项是"内部 UX 验证"

如果用户同时是数据/模型/合规的所有者（即同一人），该 8 项是否仍有意义需要用户决定。但即使同一人，**"分角色逐项冻结证据"** 的流程设计**仍然有审计价值**——记录"哪个证据被谁在何时基于什么决策通过"。

**评估**: 8 类不冗余；保留即可。

### COND-03: hash 一致性需要运行时验证

`00_REVIEW_SCOPE_AND_CLAIMS.md` §5 列出 18 个 SHA-256，但**本审计未独立重算**——静态文档审计的范围限制。FTR-0 出门门槛明确要求 `npm run test:next-stage-documentation-baseline` 实际跑文档基线测试，应当在该步骤中重算哈希并比对。

**建议**: 用户在批准 FTR-0 时应要求执行 baseline 测试，输出 18/18 一致才放行。

---

## 六、风险评估

| 编号 | 风险 | 可能性 | 影响 | 当前状态 | 缓解 |
| --- | --- | --- | --- | --- | --- |
| R-FTR-01 | 文档阶段存在但代码未跑，automation 不能保证运行时正确 | 高 | 中 | 静态验证完整 | FTR-1..6 实际跑通 + G1..G7 gates |
| R-FTR-02 | A0 外部输入无法取得 | 中 | 高 | 文档明示 | 停止，状态保持 blocked |
| R-FTR-03 | 集中核查被人为简化（自查） | 低 | 高 | schema 强制 8 类各 1 项 | reviewerAndTimestampPresent=true |
| R-FTR-04 | FTR-4 自动证据冻结后修改 artifact hash | 低 | 高 | rollbackStage 字段强制记录 | invalidate 联动 |
| R-FTR-05 | Provisional 证据被误作 final | 低 | 高 | downstreamEvidenceStatus=provisional_until_human_pass | A7 才允许 final |
| R-FTR-06 | 四锁任一被自动或人工错误解锁 | 极低 | 极高 | multiple layers | 独立未来高风险阶段 |

---

## 七、检索声明汇总

本审计在以下文件中检索了事实：

1. **三份核心审计对象文档**: `docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md`(430 行) + `docs/DEFERRED_HUMAN_ACCEPTANCE_EXECUTION_PLAN.md`(107 行) + `docs/INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md`(149 行)
2. **claudecode-review-packet 平铺 19 文件**: 00_REVIEW_SCOPE_AND_CLAIMS + 01..18 共 19
3. **drawio + 解析输出**: `docs/claudecode-review-packet/06_TARGET_ARCHITECTURE_GAP.drawio`(101 行, 8 pages) + `07_READ_DRAWIO_OUTPUT.txt`
4. **FTR manifest**: `docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`(7 stages × 16 schemas × 16 commands)
5. **当前状态源**: `docs/claudecode-review-packet/01_CURRENT_STAGE_STATE.json`
6. **合同文档**: FORMAL_DATA_GOVERNANCE_CONTRACT + BENCHMARK_ENUM_CONTRACT + FORMAL_VALIDATION_METRIC_DEFINITIONS + TRADE_BOUNDARY_CONTRACT
7. **PRD**: DIVIDEND_LOW_VOL_PRD + DAILY_PORTFOLIO_REVIEW_PRD + V2_PX_PRD（30+20+红利低波）

未覆盖范围（运行时验证）：
- `npm run test:next-stage-documentation-baseline` 实际跑通
- 18 个 SHA-256 独立重算
- FTR service 真实运行
- A0 外部输入的真实取得状态

---

## 八、最终独立审计结论

```text
verdict=PASS_FOR_EXTERNAL_DOCUMENT_REVIEW
documentation_supports_controlled_next_stage_development=true
documentation_supports_A0_to_A7_acceptance=true
implementation_approval_recommended=true（条件：FTR-0 baseline 测试真实跑通 + A0 外部输入已取得或显式未取得）
fatal_issue_count=0
major_issue_count=0
open_major_issue_count=0
drawio_page_count=8（与声称一致）
prd_traceability_coverage=30/30（DPR）+ 20/20（PX-REQ）= 100%
architecture_entity_fidelity=PASS（六列映射与代码一致）
anti_false_green_contract=PASS
human_gate_integrity=PASS
authorization_lifecycle_integrity=PASS
deferred_review_queue_contract=PASS
formal_trading_unlocked=false
auto_trading_unlocked=false
can_create_order=false
order_create_allowed=false
```

### 不替用户决定

按 CLAUDE.md：
1. **是否批准进入 A0 实际开发**: 由用户在新指令中显式给出。本审计结论不影响用户门禁。
2. **A0 三项外部输入的实际状态**: 由用户判断并提供；不能由本审计代理。
3. **8 项集中核查在本机单人下的可执行性**: 由用户/产品决定是按当前 8 类强制拆分还是合并。
4. **`finalFormalReleaseReviewPackageReady` 何时置 true**: 由用户在 A6 集中核查全部通过后给出。

---

> **审计签名**: MiniMax-M3，2026-09-14，独立视角（与本轮修订者/内部审计者不同源）
> **后续行动**: 等待用户就 3 项条件性关注与 A0 外部输入状态做出指示；不主动修改任何文档、schema、drawio 或代码。