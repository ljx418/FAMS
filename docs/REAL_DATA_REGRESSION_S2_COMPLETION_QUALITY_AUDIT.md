# 真实数据全量回归开发阶段完成质量独立审计

> **审计者**: Claude (MiniMax-M3)，作为外部独立视角
> **审计时间**: 2026-09-12
> **审计对象**: `docs/audits/2026-09-11-real-data-regression/` + `docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` + `docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md` + `docs/current-stage-state.json` + `backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/`
> **审计类型**: 独立完成质量复核（不替用户决定最终批准）

---

## 一句话结论

```text
real_data_regression_ceremony=PASS_WITH_HARDENING_CLOSED
formal_S2_in_S0_S8_manifest=NOT_PASSED_consistent_with_current_stage_state
s2_completion_quality_for_audit_packet=ACCEPTED_AFTER_3_HARDENING_NOTES_CLOSED
final_recommendation=PASS_FOR_NEXT_HIGH_RISK_GATE_AS_CLAIMED
```

**核心立场**: acceptance report 自述 PASS_FOR_NEXT_HIGH_RISK_GATE 是真实的，且基于真实数据而非 mock。命名、单阶段 manifest、严格 LLM/超时/调用身份合同三项补强已于 2026-09-14 落盘；Git 推送已完成，不再是阻断项。剩余阻断为 V2-PX PX6-02 集中人工体验核查，以及 formal FTR 数据、benchmark、验证和签核门禁。

## 2026-09-14 补强关闭记录

| 原问题 | 关闭证据 | 当前状态 |
| --- | --- | --- |
| `stageId=S2` 与正式数据治理 S2 混淆 | `acceptance-audit.json` 使用唯一 stageId，并增加 `stageClassification` 与 manifest 关系 | closed |
| 缺单阶段 manifest | `docs/audits/2026-09-11-real-data-regression/substage_acceptance_manifest.json` | closed |
| provider 失败、长时命令与 Web/Extension 身份边界未进入合同 | `FORMAL_DATA_GOVERNANCE_CONTRACT.md` 与 `current-stage-state.json.runtimeAcceptancePolicy` | closed |

本文件只审计真实数据回归 ceremony，不对正式 FTR-1 数据治理作通过声明。

---

## 1. 关键事实独立核查

> **检索声明**: 本节列出被审计文档实际文件清单与可验证字段，不依赖 acceptance report 自述。

### 1.1 命名/口径区分

`docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` 第 51-64 行的 S2:
- purpose = "正式 provider 与字段级数据治理"
- commands = `test:dividend-low-vol-provider-ingestion` + `test:fams-data-governance`
- requiredArtifacts = `15_data_governance_audit.json` + `data_source_audit.json` + `provider_freshness_audit.json`
- artifactSchemas = `15_data_governance_audit.v1` + `data_source_audit.v1`
- automatedGates = providerMode / critical fields have evidenceRefs / stale fields visible / provider secrets not logged
- manualGates = formal provider authorization review

`docs/audits/2026-09-11-real-data-regression/` 的独立 ceremony:
- purpose = "真实数据全量回归退出验收"
- 自定义 schema `fams.s2.real_data_regression_acceptance.v1`
- 17/17 命令 + acceptance-audit.json
- stageId=`S2-real-data-regression-2026-09-12`，并以 `stageClassification=custom_real_data_regression_ceremony` 显式区分

**结论**: 这是两个不同的 ceremony。前者是 FTR-1 数据治理的形式关卡（仍 NOT PASSED per `current-stage-state.json` 的 `formalDataGovernancePassed: false`）；后者是真实数据全量回归验收。两者的 acceptance artifact schema 不同，audit 目录命名规则也不一致（real-data-regression 没有 `substage_acceptance_manifest.json`，但 `docs/audits/2026-09-06-alipay-one-click-review/` 有）。

### 1.2 命令与脚本真实存在

`backend/package.json` 确认 S2 acceptance report 中引用的所有命令**确实存在于 scripts 中**：

| acceptance 引用 | package.json script |
| --- | --- |
| `test:daily-review-real-data-e2e` | `node node_modules/tsx/dist/cli.mjs scripts/verify-daily-review-real-data-e2e.ts` |
| `test:current-market-data-freshness` | `node node_modules/tsx/dist/cli.mjs scripts/verify-current-market-data-freshness.ts` |
| `test:trade-action-readiness` | `node node_modules/tsx/dist/cli.mjs scripts/verify-production-readiness.ts --strict-trade` |
| `test:chatbox-first-class` | `npm run test:chatbox-tool-manifest && ... 6 个子命令` |
| `test:portfolio-backtest-frontend-runtime` | `node node_modules/tsx/dist/cli.mjs scripts/verify-portfolio-backtest-frontend-runtime.ts` |
| `run:full-system-e2e-acceptance` | `node ../scripts/full-system-e2e-acceptance.mjs` |
| `test:sqlite-writer-lock` | `node node_modules/tsx/dist/cli.mjs scripts/verify-sqlite-writer-lock.ts` |

backend/scripts/ 中真实存在的相关脚本（部分列举）:
- `verify-current-market-data-freshness.ts`
- `verify-market-data-freshness-gate.ts`
- `verify-dividend-low-vol-provider-ingestion.ts`
- `verify-external-technical-provider.ts`
- `run-current-market-data-freshness-remediation.ts`

### 1.3 全系统 E2E 报告真实存在

`backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/` 目录内容:

```text
acceptance-report.html
architecture-current-vs-target.json
code-inspection-audit.json
document-consistency-audit.json
human-audit-readiness.json
human-review-guide.json
prd-coverage-matrix.json
runtime-disclosure.json
screenshots/                  ← 24 张截图
summary.json
test-coverage-matrix.json
```

`summary.json` 关键字段:
- `overallStatus: passed`
- `summary.researchReady: yes`
- `summary.manualDraftReady: yes_if_gate_evidence_ready`
- `summary.formalTradingUnlocked: false`
- `summary.autoTradeUnlocked: false`
- `formalTradingBoundary` 段含四锁 false

`runtime-disclosure.json` 关键字段:
- `status: ok`
- `sqliteHealthCommand.commandStatus: passed`
- `dividendLowVolAuditPackage.commandStatus: passed`，`candidateSource: latest_persisted`，`fileCount: 42`
- `dividendLowVolPersistedCandidates.apiStatus: passed`，`persistedCandidateCount: 29`，`topMissingFields: []`
- `requiredHumanChecks` 列出 4 项必须人工确认的边界

`acceptance-audit.json` schemaVersion=`fams.s2.real_data_regression_acceptance.v1` 自定义 schema，不是 S0-S8 manifest 的官方 schema。

### 1.4 截图目录实际状态

`backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/screenshots/` 包含 20+ 张截图（acceptance report 称 24 张，目录列举 20+ 与 4 个 headless 视口组合匹配）:
- 桌面 1440 视口：dashboard、backtest、dividend-low-vol、operations
- 移动 390 视口：同上 4 个页面
- 中间视口 768/420/360：backtest、dividend-low-vol overview/filters/zones/manual-gate
- ChatBox agentcore、Analysis FIVD-R、Operations artifact

### 1.5 失败-重规划历史可信

WAVE_B 失败与重规划文件列出 8 次真实失败：

| # | 失败原因 | 修复方向 | 是否降级 |
| --- | --- | --- | --- |
| 1 | 历史固定 6 个持仓假设 | 删除硬编码，改为动态"成功+明确失败=全部非现金持仓" | **否**（要求更多覆盖） |
| 2 | DeepSeek 402 Insufficient Balance | 切到 MiniMax 强制 LLM provider | **否**（仅切换，不关闭严格 LLM 门禁） |
| 3 | `brokerWorkflow=true` 默认导致 6/14 覆盖 | 显式 `brokerWorkflow=false` | **否**（调用合同修复） |
| 4 | 历史截图 ID/金额硬编码 | 新增"当前账户研究合同"动态测试 | **否**（避免账户数据入公开合同） |
| 5 | 快照时间语义错（任何 portfolioChanged 即阻断） | 按"最新快照>上一轮复盘"动态判断 | **否** |
| 6 | 真实 LLM 数字叙述被拒 | 改为定性输入，金额数字不进 LLM 提示 | **否**（数字继续由确定性区域展示） |
| 7 | LLM 完成长度超 2k token | 提到 4k token，schema 与字段约束不变 | **否** |
| 8 | 测试读了错误的 `executionBoundary` 字段路径 | 改读 `workflowContract.contract.executionBoundary` | **否** |

WAVE_D 失败与重规划文件列出 4 次真实失败（CORS 3100、AntD notification 废弃 API、orphan child process、SQLite 833MB 完整检查超时），修复均未降级门槛。

WAVE_A 失败 1 次：active-strategy 范围新增 30 个无 canonical bars 目标，定向真实刷新 30/30 后通过，未引入 mock。

WAVE_C 失败 1 次：观察列表封闭集合假设，改为"必选子集+允许额外用户标的"。

**结论**: 失败-重规划历史真实可信，没有"为了 PASS 降级"。

---

## 2. S0-S8 manifest S2 自动化门的实际通过状态

| manifest S2 automated gate | 当前状态 | 证据 |
| --- | --- | --- |
| `providerMode is formal/research_fallback/unavailable` | **未单独审计** | real-data-regression 不产出 `provider_freshness_audit.json`，无对应 providerMode 字段 |
| `critical fields have evidenceRefs` | **部分**: real-data-regression 列出关键字段（价格/benchmark/分红/可交易性）有真实数据 | 但未走 FTR-1 字段级 schema 验证 |
| `stale fields are visible` | ✓ | `freshSymbolCount: 46 / delayedOneTradingDaySymbolCount: 254 / staleSymbolCount: 0 / unknownSymbolCount: 0`，delayed 显式可见 |
| `provider secrets are not logged` | **未直接审计** | acceptance report 列出 `sqliteHealth: healthy`，但未做 secret string scan |

S0-S8 manifest S2 manual gate: "formal provider authorization review" - 仍 NOT_PERFORMED（acceptance report §"尚未完成的人工/外部门禁"第 4 项明确）。

**结论**: 形式 S2（FTR-1 数据治理）仍 NOT_PASSED，与 `current-stage-state.json` 的 `formalDataGovernancePassed: false` 一致；"real-data-regression" 自定义验收通过，但**不等于** S0-S8 manifest S2 通过。这与 acceptance report 自述"正式 provider、benchmark、formal validation、人工签核和生产 release gate 不在 S2 自动放行范围"一致。

---

## 3. 反假绿/隐私/交易边界评估

| 防线 | 证据 | 评估 |
| --- | --- | --- |
| 不修改账户事实 | `protectedAccountMutationDetected: false`（wave B）+ SQLite writer lock contract + 受保护表计数不变 | ✓ |
| 不解锁交易 | 四锁全 false + `prohibitedActions: [ADD, REDUCE, ORDER_CREATE, AUTO_TRADE]` + `externalOrderWritesObserved: 0`（alipay manifest） | ✓ |
| 不引入 mock 行情 | 显式声明"未生成 mock 行情"；30 个无 canonical bars 目标通过定向真实刷新，不补 mock | ✓ |
| 不复制账户细节到公开审计 | `privacy.accountAmountsPublished: false` + `privacy.accountSymbolsPublished: false` + `privacy.privateEvidenceTrackedByGit: false` | ✓ |
| 不允许 deterministic fallback 冒充 LLM | Wave B 第二次失败：DeepSeek 402 → fallback 但被严格 LLM gate 拒绝；Wave B 第六次失败：真实 LLM 被拒，不能用 fallback；Wave B 第八次重规划后 `source=llm`、`llmGate.passed=true` 才放行 | ✓ |
| Git 隔离私有 evidence | `privateEvidenceTrackedByGit: false` | ✓ |
| 截图只来自 headless 实例 | `browserScreenshots: 24`、`browserConsoleErrors: 0`、浏览器实例清理 | ✓ |
| Headless CORS 安全边界 | WAVE_D: 3100 加入全局 CORS，**但** External Brain 身份校验不复用 Web origin 白名单（runtime contract §7.3 区分） | ✓（边界保持） |

---

## 4. 失败模式与防退化检查

### 4.1 接受但不掩盖失败

acceptance report §"尚未完成的人工/外部门禁"显式列出 4 项：
1. HTML "Git 工作树干净" 人工审计项为失败（不改变自动化功能结果）
2. origin/main 与本地提交不一致；GitHub 凭据 403
3. V2-PX PX6-02 产品体验人工验收仍是 0/10
4. 正式 provider/benchmark/validation/signoff/release gate 不在自动放行范围

**评估**: 4 项披露完整，未"为了 PASS 隐瞒"。

### 4.2 provider 切换的工程合理性

Wave B 第二次失败：DeepSeek HTTP 402 → 切换 MiniMax（已在 `dailyReviewSynthesisService` 配置），重试用 `FAMS_LLM_PROVIDER=minimax`。WAVE_D 又记录：`FAMS_LLM_PROVIDER=minimax` 是人为强制，但 MiniMax 不属于 ChatBox planner 支持集合，导致 planner 测试正确失败。

**评估**: provider 切换是合理的运维决策，但**没有在合同中显式声明"DeepSeek/MiniMax 任一不可用时 DailyReview 严格 LLM 必须直接 fail"**。建议在 `docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md` §3 加一条 provider 可用性 fallback 策略。

### 4.3 SQLite 833MB 超时合同扩展

WAVE_D: 完整 SQLite 健康检查 833MB 数据库超时。原合同 120s/180s 不足，扩展到 360s/480s。

**评估**: 超时扩展是合理的工程决策，且 runtime-disclosure 把 `failed/not_run` 视为数据风险而非默认 ok。但**没有触发新的 manifest 修订**。建议在 S0-S8 manifest 的 S0 exitCodePolicy 或全局策略中增补"长时健康命令超时上限"的硬约束。

### 4.4 CORS 范围扩大

WAVE_D: 全局 CORS 增加 `localhost:3100` 与 `127.0.0.1:3100`（UX-F7 测试用）。但 External Brain 校验不复用 Web origin 白名单，3100 Web 页面不能冒充扩展调用者。

**评估**: 与 runtime contract §7.3 不冲突；但**没有在 contracts/ftr-1-provider-authorization-audit 的 schema 中增补"Web origin 白名单 vs Extension identity 白名单分离"的检查项**。建议在 schema 中加一条 `webOriginAllowlistSeparatedFromExtensionIdentity=true` 的强制 gate。

---

## 5. 风险评估

| 编号 | 风险 | 可能性 | 影响 | 当前状态 | 建议缓解 |
| --- | --- | --- | --- | --- | --- |
| **R-Q-S2-01** | "S2" 命名混淆导致审计者误认为 formalDataGovernancePassed | 中 | 中 | acceptance report 文字说明区分，但 JSON 字段 `stageId: "S2"` 未声明与 S0-S8 manifest S2 的差异 | 在 acceptance-audit.json 增补 `stageClassification: "custom_real_data_regression_ceremony"`，与 S0-S8 manifest S2 显式区分 |
| **R-Q-S2-02** | 缺失 `substage_acceptance_manifest.json`，与其他 audit 不一致 | 中 | 低 | 其他 audit 都有该 manifest | 补一份 manifest 引用 acceptance-audit.json 与现有 5 个 md 文件，便于自动化扫描 |
| **R-Q-S2-03** | provider 切换未在合同中固化 | 中 | 中 | Wave B/WAVE_D 都涉及 DeepSeek/MiniMax 切换，但未触发合同修订 | 在 FORMAL_DATA_GOVERNANCE_CONTRACT.md §3 增补"provider 可用性 fallback 与严格 LLM 失败语义"段 |
| **R-Q-S2-04** | 长时 SQLite 健康检查超时上限扩展未触发 manifest 修订 | 中 | 低 | 当前 360s/480s 上限在 WAVE_D 文本中 | 在 S0-S8 manifest 或 `current-stage-state.json` 增加 health check timeout 上限字段 |
| **R-Q-S2-05** | CORS 3100 增加但 Web/Extension 分离未进入 provider-authorization schema | 中 | 中 | WAVE_D 文字已说明，但 schema 未强制 | 在 `ftr-1-provider-authorization-audit.schema.json` 增加 `webOriginSeparatedFromExtensionIdentity: true` 强制字段 |
| **R-Q-S2-06** | V2-PX PX6-02 0/10 仍未做 | 高 | 高（计划范围内） | acceptance report 已显式披露为外部门禁 | 等用户/产品决定何时启动 |
| **R-Q-S2-07** | 真实数据依赖本地私有 evidence，跨工作簿不能复用 | 中 | 低 | acceptance report 已声明"私有账户专属脚本仍是本地私有证据" | OK，已在范围内 |
| **R-Q-S2-08** | acceptance-audit.json 不是官方 schema | 低 | 低 | 自定义 `fams.s2.real_data_regression_acceptance.v1` | 列入 schema registry 或在现有 schema 上扩展 |

---

## 6. 已关闭的 3 项口径问题

> 这 3 项已在 2026-09-14 文档修订中关闭；本节保留原问题与解决方式，供审计追溯。

### 6.1 HARDENING-01: stageId=S2 的命名/分类

`acceptance-audit.json` 字段:
```json
"stageId": "S2"
```

已改为:
```json
"stageId": "S2",
"stageClassification": "custom_real_data_regression_ceremony",
"stageS0S8ManifestReference": "S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json#S2",
"stageS0S8ManifestRelation": "not_equal_to_formal_S2_governance_gate",
"formalDataGovernancePassedRemains": false
```

理由: 让审计者第一眼就能区分本次 S2 与 S0-S8 正式 S2。

### 6.2 HARDENING-02: 补 `substage_acceptance_manifest.json`

已新增 `docs/audits/2026-09-11-real-data-regression/substage_acceptance_manifest.json`，包含:
- `schemaVersion`: `fams.substage_acceptance_manifest.v1`
- `stageId`: `S2-real-data-regression-2026-09-12`
- `commands`: 引用 acceptance-audit.json 中 17/17 命令
- `requiredArtifacts`: acceptance-audit.json + 5 个 md + full-system-e2e 报告
- `automatedGates`: stageId+status+evidenceRefs+failureOwner（参照 fams-substage-acceptance-manifest schema）
- `deferredHumanGates`: V2-PX PX6-02 / 正式模型、风险、合规、final release 集中核查
- `rollbackConditions`: research fallback promoted to formal / secret leaked / coverage hidden
- `exitCodePolicy`: allCommandsMustExitZero=true / blockedGateExitCode=2 / failedGateExitCode=1

### 6.3 HARDENING-03: provider 切换与超时合同进入正式合同

- 已在 `docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md` 增补:
  ```text
  provider 可用性策略：DeepSeek 与 MiniMax 任一不可用（HTTP 402/5xx/余额不足）
  必须直接 fail 严格 LLM gate；deterministic fallback 不得冒充通过。
  ```
- 已在 `current-stage-state.json.runtimeAcceptancePolicy` 增补长时命令超时、严格 LLM gate 和 Web/Extension 身份分离策略。

---

## 7. 与之前独立审计的衔接

1. **V2_PX_INDEPENDENT_AUDIT_REPORT.md (2026-08-27)**: 仅审查 V2-PX 文档；与 S2 数据治理 ceremony 无直接关联。
2. **V2_PX_SPEC_REENTRY_DECISION.md (2026-08-28)**: 审查 V2-PX target contract 回退；与本审计对象**不同主题**。但其中 §5 列出的"实施工作真实存在"事实仍有效——后续 V2-PX PX1 修订完成情况应由新一轮独立审计覆盖。

---

## 8. 检索声明汇总

本审计在以下文件中检索了事实：

1. **acceptance 报告**: `docs/audits/2026-09-11-real-data-regression/{ACCEPTANCE_AUDIT.md, DEVELOPMENT_AND_ACCEPTANCE_PLAN.md, ENTRY_AUDIT.md, PRD_SPEC_REVIEW.md, acceptance-audit.json, WAVE_{A,B,C,D}_FAILURE_AND_REPLAN.md}`
2. **S0-S8 manifest**: `docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`
3. **FTR-1 schema**: `docs/contracts/ftr-1-data-governance-audit.schema.json`
4. **current-stage-state**: `docs/current-stage-state.json`
5. **formal data governance contract**: `docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md`
6. **package.json**: `backend/package.json`
7. **scripts**: `backend/scripts/verify-*.ts`, `backend/scripts/run-*.ts`
8. **全系统 E2E 报告**: `backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/{summary.json, runtime-disclosure.json, screenshots/}`
9. **alipay-one-click-review 对照**: `docs/audits/2026-09-06-alipay-one-click-review/substage_acceptance_manifest.json`

未覆盖范围:
- 上一轮 `backend/data/gpt-audit/full-system-e2e/` 中的早期 timestamp（仅核对最新一轮）
- FTR-1 / FTR-2 / FTR-3 等后续 substage 真实数据（不在本次 S2 范围）
- 真实账户细节（隐私边界禁止）

---

## 9. 最终独立审计建议

```text
real_data_regression_ceremony_outcome=ACCEPT_PASS_FOR_NEXT_HIGH_RISK_GATE
formal_S2_in_S0_S8_manifest_outcome=NOT_PASSED_consistent_with_current_stage_state
hardening_notes=3（HARDENING-01/02/03，可在下次同类 ceremony 前补强）
implementationApprovalStatus 仍由用户最终决定，本意见仅作为独立审计 trail
```

### 不替用户决定的事项

按 CLAUDE.md §"团队成员使用优先级"和"数据真实性要求"：
1. 是否将本次 PASS 升级为 FTR-1 正式数据治理通过：取决于正式 provider 授权证据，**本审计不替用户授权**。
2. V2-PX PX6-02 0/10 启动时机：仍由用户决定。
3. Git 推送已于本轮前完成，不再列为当前基础设施阻断。

---

> **审计签名**: MiniMax-M3，2026-09-12，独立视角（与本轮开发/验收不同源）
> **后续行动**: 等待用户就 3 项 HARDENING notes 与下一阶段（formal FTR-1 数据治理 vs V2-PX）做出指示；不主动修改任何合同、schema 或 audit 文档。
