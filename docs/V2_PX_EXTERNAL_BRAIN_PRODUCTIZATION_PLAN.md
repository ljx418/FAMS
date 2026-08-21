# V2-PX External Brain Productization 开发及验收计划

更新时间：2026-07-15

## 1. 阶段定位

V2-PX 的目标是把 External Brain 从当前项目内的研究/工作台能力，产品化为可被真实浏览器验证、可审计、可回放、可人工核查的 PX 体验。当前只允许进入 PX-0 文档门禁修复；不允许直接进入 PX-2+ 生产实现。

```text
currentStage=PX-0_DOCUMENTATION_REVIEW_GATE
px0GithubReviewGate=FAIL
authorityBaselineStatus=UNRESOLVED
routeAStatus=PROPOSED
routeAImplementationReadiness=FAIL
semanticValidatorImplemented=false
px1FeasibilitySpikeAllowed=false
px1PlanningAllowed=true
px2PlusAllowed=false
v2PxComplete=false
```

## 1.1 PX-0 允许和禁止的代码类型

PX-0 是文档门禁修复阶段，但为关闭 anti-false-green 风险，允许编写非生产验证工具；这些工具不得成为生产 External Brain 功能。

PX-0 允许：

```text
schema validator
semantic validator
negative fixture generator
prototype review script
non-production Chrome probe
documentation consistency scanner
```

PX-0 禁止：

```text
production Workspace Page business implementation
production Side Panel refactor
production background router
PX-2+ External Brain capability
user-facing production feature release
```

## 2. Route A 目标架构

Route A 采用“独立 Workspace Page 宿主 + WXT background / sidepanel 复用路由 + intent route contract + 双容器生命周期验收”的方向。

目标实体：

| 层级 | 目标实体 | 责任 |
| --- | --- | --- |
| Extension Shell | `WXT background` | 负责扩展生命周期、消息分发、权限边界和审计事件 |
| User Entry | `sidepanel` | 轻量入口，承接快速查询、状态提示和跳转 |
| Workspace Host | `Workspace Page` | 独立完整宿主，承载 External Brain 主体验、任务、图表和审计证据 |
| Intent Router | `pxIntentRoute` | 将 `entryContainer / entryAction / routeIntent / targetContainer / routePayload` 规范化为可审计 route |
| Container Lifecycle | `dualContainerLifecycle` | 验证 sidepanel 与 Workspace Page 的启动、恢复、关闭、重连 |
| Evidence Layer | `realChromeEvidence` | 只接受真实 Chrome 自动化截图、trace 和事件日志 |
| Anti-False-Green | `pxAntiFalseGreenContract` | 阻断 mock HTML、静态截图、状态漂移和未提交对象 |

## 3. PX 阶段划分

### PX-0 GitHub 可复核门禁

目标：让审计对象可以按 commit、文档、ADR、schema、原型和合同验收复核。

开发内容：

```text
docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_AUDIT_BASELINE.md
docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md
docs/V2_PX_AUTHORITY_BASELINE.md
docs/V2_PX_SEMANTIC_VALIDATOR_PLAN.md
docs/adr/ADR-2026-07-15-v2-px-route-a.md
docs/schemas/v2-px-intent-route.schema.json
docs/schemas/v2-px-dual-container-lifecycle.schema.json
docs/schemas/v2-px-real-chrome-evidence.schema.json
docs/schemas/v2-px-acceptance-manifest.schema.json
docs/schemas/v2-px-acceptance-report.schema.json
docs/schemas/v2-px-operation-command.schema.json
docs/V2_PX_PRD.md
docs/V2_PX_PRD_TRACEABILITY_MATRIX.md
docs/prototypes/v2-px/README.md
```

验收标准：

```text
pxDocsCommittedToReviewableBranch=true
authorityBaselineStatus=FROZEN
routeAAdrStatus=accepted
routeAImplementationDetailsFrozen=true
intentSchemaMetaValidation=PASS
intentSchemaFalseGreenDefense=PASS
lifecycleSchemaMetaValidation=PASS
lifecycleSchemaFalseGreenDefense=PASS
realChromeEvidenceSchemaMetaValidation=PASS
realChromeEvidenceFalseGreenDefense=PASS
acceptanceManifestSchemaMetaValidation=PASS
acceptanceReportSchemaMetaValidation=PASS
semanticValidatorImplemented=true
semanticValidatorNegativeFixturesPassed=true
prototypeThreeEntryActionsImplemented=true
prototypeFiveRouteIntentsImplemented=true
prototypeStateMatrixComplete=true
prototypePrdTraceabilityPassed=true
prdRequirementTraceabilityReady=true
activeV2StatusDriftCount=0
legacyMockEvidenceExcluded=true
antiFalseGreenAcceptanceContractPassed=true
```

打回条件：

```text
PX 审计对象未提交
状态字段 pending / passed 冲突
静态 mock evidence 被写成真实 Chrome evidence
Route A 未明确宿主、路由和生命周期
ADR 仍为 proposed
schema 只检查文件存在或非空字符串
README 仍为 documentation_stub_only
真实 Chrome 证据只由报告自称
PX-2..PX-6 或 G1..G7 未定义
PX-0 validator 代码越界成生产功能
```

### PX-1 Route A 受限 feasibility spike

进入条件：PX-0 全部通过，并经人工确认。

六项 spike：

1. Workspace Page 独立宿主能启动。
2. sidepanel 能打开并跳转 Workspace Page。
3. background 能路由 intent，并记录 message envelope。
4. intent route schema 能校验三入口请求、三类用户动作和五类 route intent。
5. 双容器生命周期能记录启动、恢复、关闭、重连。
6. 真实 Chrome 自动化证据能生成截图和事件日志。

验收标准：

```text
workspacePageHostStarted=true
sidepanelEntryWorks=true
backgroundIntentRouteWorks=true
intentSchemaValidationPassed=true
dualContainerLifecycleAuditPassed=true
realChromeEvidenceGenerated=true
semanticValidatorPassed=true
```

PX-1 完成后仍不得进入 PX-2+，除非六项 spike 全部通过且人工审核通过。

### PX-2 Workspace Page 最小宿主产品化

进入条件：PX-1 六项 spike 全绿，人工批准。

目标文件：

```text
extension workspace entrypoint
workspace route shell
workspace state restore module
workspace evidence panel
```

验收命令：

```text
npm run test:v2-px-workspace-host
npm run test:v2-px-real-chrome-workspace
```

验收证据：

```text
workspace_host_audit.json
real_chrome_workspace_evidence.json
desktop_1280_workspace.png
tablet_768_workspace.png
```

失败归属：

```text
Workspace Page 无法独立启动 -> PX-2
canonical URL 不稳定 -> PX-2
刷新后状态丢失 -> PX-2
```

### PX-3 Sidepanel 轻入口与工作台跳转

目标：sidepanel 只做轻入口、任务摘要和跳转，不承载完整 External Brain 主体验。

验收命令：

```text
npm run test:v2-px-sidepanel-entry
npm run test:v2-px-sidepanel-to-workspace
```

验收证据：

```text
sidepanel_entry_audit.json
sidepanel_to_workspace_trace.json
mobile_420_sidepanel.png
mobile_360_sidepanel.png
```

失败归属：

```text
sidepanel 与 Workspace Page routeId 不一致 -> PX-3
sidepanel 误承载完整体验导致不可用 -> PX-3
```

### PX-4 Background Intent Router 与幂等

目标：background 统一路由三入口 intent，处理 tab 查询、创建、复用、聚焦、多窗口和 idempotency。

验收命令：

```text
npm run test:v2-px-background-router
npm run test:v2-px-idempotency
```

验收证据：

```text
background_intent_router_audit.json
idempotency_audit.json
multi_window_tab_reuse_trace.json
```

失败归属：

```text
重复 ingest 无幂等键 -> PX-4
多窗口复用错误标签页 -> PX-4
routeId/correlationId 不一致 -> PX-4
```

### PX-5 双容器生命周期与恢复

目标：真实 Chrome 中验证 sidepanel 与 Workspace Page 的 start、resume、reconnect、close、extension reload/update 恢复。

验收命令：

```text
npm run test:v2-px-dual-container-lifecycle
npm run test:v2-px-extension-reload-recovery
```

验收证据：

```text
dual_container_lifecycle_audit.json
extension_reload_recovery_audit.json
real_chrome_lifecycle_trace.json
```

失败归属：

```text
事件顺序不合法 -> PX-5
reload 后无法恢复 -> PX-5
状态由报告自称且无法由事件推导 -> PX-5
```

### PX-6 完整 PX 验收包与人工体验核查

目标：汇总 PX-2 到 PX-5 证据，形成 V2-PX 产品化候选验收包。

验收命令：

```text
npm run test:v2-px-acceptance
npm run test:v2-px-anti-false-green
```

验收证据：

```text
v2_px_acceptance_manifest.json
v2_px_acceptance_report.html
v2_px_acceptance_report.json
g1_g7_gate_audit.json
manual_experience_review_checklist.md
```

失败归属：

```text
任一 G gate 非绿 -> PX-6
人工体验核查未通过 -> PX-6
证据无法按 commit 复核 -> PX-6
```

### G1-G7 Gate 定义

| Gate | 名称 | 输入 | 命令 | 通过阈值 | 失败打回 |
| --- | --- | --- | --- | --- | --- |
| G1 | 权威基线 | repository / branch / commit / productId / extensionPackage | `npm run test:v2-px-authority-baseline` | 全字段冻结且 commit 可复核 | PX-0 |
| G2 | Route A 架构冻结 | ADR / entrypoints / manifest / CSP / message envelope | `npm run test:v2-px-route-a-contract` | ADR accepted 且实现细节完整 | PX-0/PX-1 |
| G3 | 三入口语义 | entryContainer / entryAction / routeIntent / targetContainer | `npm run test:v2-px-intent-route` | 三入口同任务 route 一致 | PX-1/PX-4 |
| G4 | Workspace 宿主 | Workspace Page URL / restore / viewport | `npm run test:v2-px-workspace-host` | 1280/768 可用，刷新恢复 | PX-2 |
| G5 | Sidepanel 跳转 | sidepanel / Workspace Page / tab reuse | `npm run test:v2-px-sidepanel-entry` | 420/360 可用，跳转一致 | PX-3 |
| G6 | 双容器生命周期 | Chrome trace / lifecycle events | `npm run test:v2-px-dual-container-lifecycle` | start/resume/reconnect/close 全部可推导 | PX-5 |
| G7 | Anti-false-green | schema + semantic validator + evidence files | `npm run test:v2-px-anti-false-green` | 正向 fixture 通过，负向 fixture 必须失败 | PX-6 |

当前 PX-2..PX-6 与 G1..G7 是文档计划，不允许跳过 PX-1 直接进入实现。

## 4. Anti-False-Green 验收合同

以下情况必须 hard fail：

```text
staticMockHtmlUsedAsChromeEvidence=true
prototypeScreenshotWithoutBrowserTrace=true
pxDocsNotCommitted=true
activeV2StatusDriftCount>0
routeAAdrMissing=true
workspacePageHostMissing=true
dualContainerLifecycleMissing=true
pxThreeEntryPrototypeMissing=true
entryActionRouteIntentMatrixMissing=true
semanticValidatorMissing=true
schemaNegativeFixturesNotFailing=true
px2PlusStartedBeforePx1Passed=true
```

## 5. 用户体验验收路径

PX 完成前必须能被人类按以下路径核查：

1. 从 extension sidepanel 发起 `查看来源 / 打开工作台 / 在工作台中打开`。
2. 从 Workspace Page 独立发起同一组动作。
3. 从 host app 发起同一组动作。
4. 五类 route intent 至少覆盖 `source_library / source_detail / ask / trace / graph`。
5. 对同一任务发起 intent，三入口进入同一可追踪 `routeId / correlationId`。
6. 在真实 Chrome 中观察 sidepanel 与 Workspace Page 生命周期。
7. 查看 audit evidence，确认不是 mock HTML 截图。

## 6. 出门条件

PX-0 出门：

```text
px0GithubReviewGate 必须由 FAIL 变为 PASS，且该变化只能发生在可复核分支提交后
```

PX-1 出门：

```text
px1SixSpikesPassed=true
manualPx1ReviewPassed=true
```

V2-PX 完成：

```text
px6Completed=true
realDualContainerChromeAcceptancePassed=true
g1ToG7AllGreen=true
manualExperienceReviewPassed=true
```

当前仍为：

```text
px0GithubReviewGate=FAIL
v2PxComplete=NO_GO
```
