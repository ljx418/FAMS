# V2-PX External Brain Productization 开发及验收计划

更新时间：2026-08-31

## 1. 阶段定位

V2-PX 的目标是把 External Brain 从当前项目内的研究/工作台能力，产品化为可被真实浏览器验证、可审计、可回放、可人工核查的 PX 体验。文档阶段已经完成且用户已批准方案 A/LC-A 顺序实施；PX1 技术基座、PX2 Workspace、PX3 Side Panel/Host、产品 PX4 Router/at-most-once 与 PX5 生命周期已通过自动化验收。当前只允许进入 PX6-01 全量自动验收，不得跳过该阶段或 PX6-02 人类体验核查直接声明产品化候选完成。

```text
currentStage=PRODUCT_PX6_01_IMPLEMENTED_FORMAL_ACCEPTANCE_PENDING
px0GithubReviewGate=PASS
authorityBaselineStatus=FROZEN
productAuthorityStatus=FROZEN
productGoalApproval=APPROVED_BY_USER
routeAAdrStatus=PRODUCTION_APPROVED
routeAImplementationReadiness=PX1_THROUGH_PRODUCT_PX5_AUTOMATED_ACCEPTED
externalIndependentAuditStatus=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_INTERNAL_REAUDIT_PASSED_REPORT_RETAINED
semanticValidatorImplemented=true
px1FeasibilitySpikeAllowed=true
px1FeasibilitySpikeEligible=true
px1PlanningAllowed=true
px1SixSpikesPassed=true
px2PlusAllowed=true
px4BHostBridgeAutomatedAccepted=true
px5RouterIdempotencyStatus=AUTOMATED_ACCEPTANCE_PASSED
productPx5LifecycleStatus=PX5_AUTOMATED_ACCEPTED_PX6_01_ENTRY
v2PxComplete=false
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
productionCodeChangesAllowedInCurrentPhase=PX6_01_ACCEPTANCE_TOOLING_IMPLEMENTED_NO_RUNTIME_CHANGE
```

产品 PX5 入场审计曾登记的 3 个重大规格冲突已由用户批准 `LC-A` 并闭环。PX5-01 已在提交 `05221ecca4c761a31370ed541d6c4db7f012cc2a` 通过恢复迁移验收；PX5-02 已在提交 `51a9329ec6f8f8af3a4a1fe8888be533580d8993` 通过真实 FAMS 断连、worker suspend、0.1→0.2 update、stale/dual lease 与 2/4/8/10 秒有界 GET polling。M5 已完成；PX6-01 acceptance manifest/report `/2`、collector、真实 Chrome 可访问性验证器和人类验收 HTML 已实现，当前等待精确提交上的 G1～G7 正式重跑，尚未声明自动验收通过。

本计划的架构、运行时合同、原型、追踪和图形入口分别为 `V2_PX_TARGET_ARCHITECTURE.md`、`V2_PX_API_RUNTIME_CONTRACT.md`、`prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md`、`V2_PX_PRD_TRACEABILITY_MATRIX.md` 和 `v2-px-target-architecture-gap.drawio`；自动文档验收记录在 `V2_PX_DOCUMENTATION_ACCEPTANCE.md`。

### 1.0.1 当前阶段硬边界

用户已于 2026-08-28 明确批准本计划 PX1～PX6 的顺序自动实施。每阶段仍须先落盘开发计划与验收审计，致命/重大问题清零后才可修改生产代码；自动通过中间门槛不替代 PX6 最终人工体验确认。

独立审计登记的 3 个阻断项和 8 个高风险项已经转化为实现硬约束，并在 PX1～产品 PX4 的合同、代码和阶段证据中逐项闭环；原始审计报告作为历史证据保留，其 `CONDITIONAL_PASS` 不被篡改。产品 PX5 仍须重新验证这些边界没有回归：

```text
BLK-01 host/workspace view_source target draft + positive/negative fixtures specified
BLK-02 intent ask question forbidden + negative fixture specified
BLK-03 routeAAdrStatus and productAuthorityStatus names separated
HR-01 Chrome evidence/2 requires exactly 360/420/768/1280
HR-02 lifecycle/3 eventType closed set specified
HR-03 status strings defer to docs/current-stage-state.json
HR-04 storage failure before/after effect branches specified
HR-05 ack <=1s and final result/terminal error <=35s
HR-06 seven UI states mapped to ten lifecycle states
HR-07 CORS switch sequence and evidence path frozen
HR-08 eight target fixture filenames frozen
```

上述任一条在产品 PX5 的 schema、validator、fixture、types、真实 Chrome 或 storage fault 证据中回归，均视为相应工作包失败；不得靠历史阶段通过获得绿灯。

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
| Intent Router | `pxIntentRoute/3` | 将 `entryContainer / entryAction / routeIntent / targetContainer / routePayload` 规范化为只导航的可审计 route |
| Command Dispatcher | `pxOperationCommand/2` | 承担 query/refresh/ingest，使用 local dispatch ledger 保证 at-most-once |
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
routeAAdrStatus=ACCEPTED_FOR_SPIKE
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
threeEntryContainerContractReady=true
threeEntryActionContractReady=true
fiveRouteIntentContractReady=true
prototypeImplementationRequiredAtPx0=false
realChromeEvidenceRequiredAtPx0=false
px0ContractFixturesImplemented=true
px0ContractTraceabilityPassed=true
prdRequirementTraceabilityReadyForPx1=true
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
ADR 仍为 proposed 或错误宣称 technically validated
schema 只检查文件存在或非空字符串
README 仍为 documentation_stub_only
真实 Chrome 证据只由报告自称
PX-2..PX-6 或 G1..G7 未定义
PX-0 validator 代码越界成生产功能
```

### PX-1 Route A 受限 feasibility spike

进入条件：PX-0 全部通过，并经单独启动确认。该条件已满足，PX-1 已完成并通过自动化验收。

六项 spike：

1. Workspace Page 独立宿主能启动。
2. sidepanel 能打开并跳转 Workspace Page。
3. background 能路由 intent，并记录 `runtime-message/1` envelope。
4. schema/validator/fixture/type 原子迁移至目标 `intent-route/3`、`operation-command/2`，校验三入口、三动作和五 intent。
5. 双容器生命周期能记录启动、恢复、关闭、重连。
6. 真实 Chrome 自动化证据能生成截图和事件日志。

验收标准：

```text
workspacePageHostStarted=true
sidepanelEntryWorks=true
backgroundIntentRouteWorks=true
targetRuntimeContractMigrationPassed=true
intentSchemaValidationPassed=true
dualContainerLifecycleAuditPassed=true
realChromeEvidenceGenerated=true
semanticValidatorPassed=true
```

PX-1 完成后仍不得进入 PX-2+，除非六项 spike、四视口少项负例、target eventType、Ask-question 负例、Host view_source 正负例及 storage 失败分支全部通过且人工审核通过。

### PX-2 Bounded API + Workspace Page 最小宿主产品化

进入条件：PX-1 六项 spike 全绿，人工批准。

目标文件：

```text
extension workspace entrypoint
backend externalBrain route / types / read service / ask service / policy
extension FamsApiClient / FamsDomainAdapter
workspace route shell
workspace state restore module
workspace evidence panel
```

计划验收命令：

```text
npm --prefix backend run test:v2-px-api-contract
npm --prefix backend run test:v2-px-policy
npm --prefix packages/fams-v2-px-extension run test:workspace
npm --prefix packages/fams-v2-px-extension run verify:real-chrome
```

验收证据：

```text
workspace_host_audit.json
external_brain_api_contract.json
external_brain_policy_audit.json
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

### PX-3 Sidepanel 轻入口、Host Bridge 与工作台跳转

目标：sidepanel 只做轻入口、任务摘要和跳转，不承载完整 External Brain 主体验。

计划验收命令：

```text
npm --prefix packages/fams-v2-px-extension run test:sidepanel
npm --prefix frontend run verify:v2-px-host-bridge
```

验收证据：

```text
sidepanel_entry_audit.json
sidepanel_to_workspace_trace.json
host_bridge_audit.json
mobile_420_sidepanel.png
mobile_360_sidepanel.png
```

失败归属：

```text
同一打开动作交接时 routeId 被改写或 correlation 断裂 -> PX-3
sidepanel 误承载完整体验导致不可用 -> PX-3
```

### PX-4 Background Intent Router 与幂等

目标：background 统一路由三入口 intent，处理 tab 查询、创建、复用、聚焦、多窗口和 idempotency。

计划验收命令：

```text
npm --prefix packages/fams-v2-px-extension run test:router
```

验收证据：

```text
background_intent_router_audit.json
idempotency_audit.json
dispatch_ledger_reload_audit.json
multi_window_tab_reuse_trace.json
```

失败归属：

```text
重复 ingest 无幂等键 -> PX-4
多窗口复用错误标签页 -> PX-4
同一业务对象 canonical/correlation 断裂或不同动作错误复用 routeId -> PX-4
```

### PX-5 双容器生命周期与恢复

目标：按 LC-A 在真实 Chrome 中验证 Side Panel 与 Workspace Page 的 start、resume、reconnect、close、extension reload/update 恢复。Router/Command 继续使用既有 `runtime.sendMessage`；状态订阅只使用 `v2-px-lifecycle/1` Port，禁止 heartbeat/alarms 保活。

计划验收命令：

```text
npm --prefix packages/fams-v2-px-extension run test:lifecycle
npm --prefix packages/fams-v2-px-extension run verify:lifecycle-recovery-chrome
npm --prefix packages/fams-v2-px-extension run verify:lifecycle-interruption-chrome
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

计划验收命令：

```text
npm --prefix packages/fams-v2-px-extension run verify:acceptance
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
| G1 | 权威基线 | repository / branch / commit / productId / extensionPackage | collector 的 in-scope Git 门禁 + `test:current-stage-consistency` | 全字段冻结且 commit 可复核 | PX-0 |
| G2 | Route A/运行时合同 | ADR / entrypoints / manifest / CSP / API/runtime contract | extension `typecheck`、`test`、`build` + backend semantic contract | 目标 v3/v2 schema、validator、fixtures、types 原子一致 | PX-0/PX-1 |
| G3 | 三入口语义 | entryContainer / entryAction / routeIntent / targetContainer | extension contracts/router tests + `verify:router-idempotency-chrome` | 3×3 目标矩阵；同任务 canonical key/correlation 一致 | PX-1/PX-4 |
| G4 | Workspace/API | Workspace URL / API DTO / restore / viewport | backend API/policy + extension tests + `verify:workspace-chrome` | 五端点合同；1280/768 可用；刷新恢复 | PX-2 |
| G5 | Sidepanel/Host | sidepanel / Host bridge / Workspace / tab reuse | extension tests/policy + `verify:sidepanel-chrome` + 既有 PX4B 证据 | 420/360 可用，三页 Host fallback 正确 | PX-3 |
| G6 | 双容器生命周期 | target lifecycle/3、Chrome evidence/2、storage migration | extension tests + recovery/interruption 两套真实 Chrome 验证器 | sequence/state/reason、TTL/未知版本均可推导 | PX-5 |
| G7 | Anti-false-green | target acceptance manifest/report/2 + semantic validator | backend semantic/current-stage + `verify:accessibility-chrome` + collector 防假绿突变 | 20 requirements、AC01～10、正例/负例、artifact/commit 可复核 | PX-6 |

当前 PX1～产品 PX5 生命周期已形成可复核实现和私有证据；PX6-01 G1..G7、target acceptance `/2` 与人类验收 HTML 已实现，正式自动结论仍须在精确 clean 提交上全量重跑。不允许越级或提前声明人类通过、candidate 或交易解锁。

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
targetContractVersionDrift=true
postAskAutomaticRetryCount>0
unknownDispatchResultReportedAsSuccess=true
extensionHostPermissionContainsPort3000=true
px2PlusStartedBeforePx1Passed=true
```

## 5. 用户体验验收路径

PX 完成前必须能被人类按以下路径核查：

1. 从 extension sidepanel 发起 `查看来源 / 打开工作台 / 在工作台中打开`。
2. 从 Workspace Page 独立发起同一组动作。
3. 从 host app 发起同一组动作。
4. 五类 route intent 至少覆盖 `source_library / source_detail / ask / trace / graph`。
5. 对同一任务发起 intent，三入口保持同一 `workspaceId / canonicalRouteKey / correlationId`；每个新动作有独立 `routeId`，不得错误要求 routeId 相同。
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

当前阶段状态：

```text
px0GithubReviewGate=PASS
px1FeasibilitySpikeEligible=true
px1SixSpikesPassed=true
realChromeEvidencePassed=true
px4BHostBridgeAutomatedAccepted=true
v2PxComplete=NO_GO
```

## 7. 实现实体与阶段边界

完整分层和交互关系以 `docs/V2_PX_TARGET_ARCHITECTURE.md` 为准。下表是阶段级变更清单；用户已批准顺序实施，实体的当前状态以目标架构和追踪矩阵为准，不再沿用文档阶段的“全部未开发”历史口径。

| 阶段 | 允许触碰的目标实体 | 明确不允许 | 阶段完成后的用户效果 |
| --- | --- | --- | --- |
| D0 历史文档阶段（已完成） | PRD、计划、原型规格、ADR、traceability、draw.io、文档状态源 | 任何生产源码、extension package、schema 行为和 runtime test | 人类能正确判断目标、实体、风险、里程碑和验收 |
| PX-1 | 最小 `wxt.config.ts`、三个 entrypoint、目标 v3/v2 合同迁移、最小 router/store、Chrome evidence collector | 五 intent 完整业务 UI、FAMS 业务 facade | 真实 Chrome 证明双容器、连接、路由和证据路线可行 |
| PX-2 | External Brain API/Types/Read/Ask/Policy、FAMS adapter、`WorkspaceApp/Router`、五视图、RecoveryBanner、EvidenceDrawer | 完整 Side Panel 和跨入口生产化 | 用户可在完整页面读取真实 FAMS 事实、受控提问并刷新恢复 |
| PX-3 | `SidePanelApp`、ConnectionGate、FAMS host bridge/button | 将复杂图表/DAG 塞入侧栏 | 用户可从轻入口或 FAMS 页面进入同一工作区 |
| PX-4 | intentRouter、tab manager、local dispatch ledger、状态所有权完整集成 | 复制投资计算、POST 自动重试或绕过现有服务 | 三入口和五 intent 同语义；重复动作无副作用 |
| PX-5 | lifecycle store、恢复、断连退避、reload/update | 由 UI 自报成功或无限轮询 | 用户跨刷新、重开和断连仍能恢复或看见明确阻断 |
| PX-6 | acceptance collector、manifest、HTML、G1～G7、人工清单 | 修复中顺带扩大产品范围 | 人类可按 commit、截图、trace 和步骤完成最终体验核查 |

## 8. 详细开发顺序与阶段出门

### D0 文档重构（历史已完成）

开发内容：

1. 将对话中认可的目标写入权威 PRD。
2. 固化 Side Panel 与 Workspace 的原型、六种状态和四视口。
3. 盘点现有 FAMS 实体，定义待修改、待新增和直接复用实体。
4. 关闭 host permission 与 FAMS 数据接入冲突。
5. 把 20 项 requirement 映射到实体、阶段、计划测试、证据和人类核查。
6. 生成不超过 8 页的中文 draw.io gap 文档。
7. 冻结 API/DTO、消息、状态、存储、错误、CORS、Host bridge 与 v2→v3 合同迁移。
8. 完成产品、架构、反伪完成和交叉一致性四轮独立审计。

出门：已通过；用户已于 2026-08-28 批准方案 A 顺序实施。

### PX-1 Route A.1 feasibility spike

开始条件：D0 全部通过，且用户在新指令中明确批准进入实际开发。该条件已满足且 PX-1 已通过。

最小范围：

1. unpacked MV3 extension 能在真实 Chrome 启动。
2. Side Panel 与独立 Workspace 空壳能启动。
3. 用户主动授予 4000 本地 FAMS optional host permission，background 只读访问 `/health`；3000 仅 external connect。
4. 把历史 `intent-route/2`、`operation-command/1` 原子迁移到目标 v3/v2，并让三入口最小 message 通过统一 envelope 进入 background。
5. workspace tab query/create/focus 和同 key 去重可验证。
6. lifecycle event、真实截图、trace、extension ID、Chrome 版本、hash 和 commit 可导出。

PX-1 不实现完整五 intent 业务结果。任一关键路径不可行则 `routeAAdrStatus=RETURN_TO_ADR`，不进入 PX-2。

### PX-2 Bounded API 与 Workspace 产品化

先按运行时合同实现 External Brain types、Read/Ask/Policy service、五端点和 extension adapter，再实现完整页面框架、五 intent、信息分层和恢复。用户看到真实 FAMS read model 与受控 Ask，而不是 mock 或技术字段集合。必须通过 API 同源性、交易 policy、768/1280、刷新恢复和六状态验收。

### PX-3 Side Panel 与 Host App 入口

Side Panel 只保留快速提问、当前摘要、连接状态、最近任务和打开工作台。FAMS ChatBox、Daily Review、Operations 使用同一个 bridge/button，只发送 intent route 与受控 ID；扩展缺失或 extension ID 未配置时给出可理解降级，不抛原始异常。Host 的查看来源以 Workspace 为可靠目标。

### PX-4 Router、幂等与 FAMS Adapter

完成 Background 单写者、标签复用、canonical route、24 小时 dispatch ledger 和跨入口状态集成。所有业务结果继续由现有 FAMS service 生成；adapter 只转换 read model/受控 Ask。此阶段必须证明同 key 重放无副作用、不同 digest hard fail、unknown result 不自动二次 dispatch、五 intent 不漂移、交易端点请求为 0。

### PX-5 生命周期与恢复

依次验证 Back、Forward、Refresh、关闭重开、FAMS 断连、background suspend/reconnect、extension reload/update。每次恢复必须由 event log 推导；失败时进入 blocked 并给下一步。

### PX-6 完整候选验收

汇总 PX-1～PX-5 的真实证据，生成 JSON + HTML 报告和人类体验检查表。自动化只负责准备证据，不能代替人工体验结论，也不能开放交易。

## 9. 项目里程碑

| Milestone | 依赖 | 自动化出门门槛 | 人类看到的结果 | 当前状态 |
| --- | --- | --- | --- | --- |
| M0 Documentation Review Ready | 无 | 20/20 traceability；40/40 决策检查；8 页图；状态一致 | 能评估目标体验、架构/规格/出门风险 | 已完成；独立审计意见已定向闭环并获用户批准实施 |
| M1 Route A Technically Validated | M0 + 用户批准 | 目标合同迁移、六项 spike、真实 Chrome、权限和负例全部通过 | Side Panel/Workspace 空壳真实可运行 | 自动化 PASS；真实 Chrome 证据已生成 |
| M2 Bounded API + Workspace Accepted | M1 + 人工确认 | 五端点 DTO/同源/policy；768/1280、五视图、六状态、刷新恢复 | 完整工作台可读真实结果并受控提问 | 自动化核心切片 PASS（commit `6c8714e`）；正式权限点击留最终人类门槛，深度生命周期留 PX-5 |
| M3 Side Panel Entry Accepted | M2 | 360/420、简明摘要、连接、跳转和 host app 入口通过 | 随时快速提问并进入完整页 | 自动化 PASS；Side Panel=`bc7cc5a`，Host Bridge=`a0758b4`；正式 permission 点击留最终人类门槛 |
| M4 Intent & FAMS Adapter Accepted | M3 | 三入口、五 intent、20 次 tab/idempotency、交易边界通过 | 同一任务不重复，结果来自现有 FAMS | 自动化 PASS（commit `4e752a6`）；3×3、五 intent、20 串行/并发/多窗口与 storage fault 全部重签 |
| M5 Lifecycle Accepted | M4 + LC-A 合同验收 | PX5-01/PX5-02 必测 lifecycle 场景 100% 可推导 | 刷新、重开、断连可恢复或明确阻断 | PASS；PX5-01 `05221ec` + PX5-02 `51a9329` 正式真实 Chrome 证据 |
| M6 Productization Candidate | M5 | G1～G7、四视口、隐私、HTML、人工体验通过 | 可作为本地浏览器产品化候选使用 | 进行中：PX6-01 工具已实现、正式自动重跑待精确提交；PX6-02 人工 0/10 |

## 10. 用户场景验收目录

每个场景同时包含前置条件、操作、通过阈值、证据和失败归属，禁止用“页面正常”“体验良好”等不可复核描述代替。

| 场景 | 前置条件 | 人类/自动化操作 | 量化通过阈值 | 必须证据 | 失败打回 |
| --- | --- | --- | --- | --- | --- |
| AC-PX-01 首次连接 | extension 已安装，FAMS 3000/4000 已启动，未授予主机权限 | 打开 Side Panel，点击连接，只确认后端 4000；授权后读取来源 | 安装默认 host 权限为空；未授权请求=0；授权后 `/health` 200；API 请求含实际 extension ID header；Web Origin+伪造 header=403；无 `<all_urls>` | permission/manifest/caller audit、截图、network log | PX-1/PX-3 |
| AC-PX-02 快速提问 | 已连接，存在可查询的本地数据 | Side Panel 输入问题并发送，再重放同一 key | 点击后 1 秒内显示 ack；35 秒内显示含结论/依据/时间/下一步的最终结果，或明确 `failed/blocked/unknown_result` 与人工复核动作；同 key 后端 dispatch=1；POST 自动重试=0；原始异常=0 | 360/420 截图、command/API trace、ack/final 时间戳 | PX-2/PX-3/PX-4 |
| AC-PX-03 打开工作台 | Side Panel 有当前 workspace | 连续点击 20 次“在完整工作台打开” | 同 workspace tab=1；重复 operation=0；1 秒内聚焦 | multi-window tab trace | PX-4 |
| AC-PX-04 Host App 跳转 | FAMS ChatBox、Daily Review、Operations 可访问且 extension ID 已配置 | 分别点击“在外部大脑打开”；再移除 ID 验证降级 | 三入口业务对象、canonical key/correlation 一致且 routeId 各自可追溯；Host 查看来源进入 Workspace；缺扩展时有配置说明 | entry matrix、三处截图、bridge audit | PX-3/PX-4 |
| AC-PX-05 五 intent | 存在 review、operation 和 artifact | 依次进入来源库、详情、问答、追踪、图谱 | 5/5 有真实 read model；不存在数据时显示 empty，不用 mock | intent audit、五视图截图 | PX-2/PX-4 |
| AC-PX-06 四视口 | Side Panel/Workspace 已构建 | 360/420/768/1280 运行 | `scrollWidth<=clientWidth`；关键动作可见；console errors=0 | 四视口截图、DOM audit | PX-2/PX-3 |
| AC-PX-07 生命周期 | 工作区已打开 | Back/Forward/Refresh/关闭重开/reload/断连重连/未知 storage major | 每个场景 100% 为 restored 或 blocked；5 秒内显示结果；未知版本不静默清空 | lifecycle events、storage audit、Chrome trace | PX-5 |
| AC-PX-08 状态降级 | 可注入连接失败、空数据、schema 冲突 | 触发未连接/加载/空/失败/恢复/阻断 | 6/6 有原因和下一步；伪 success=0 | state matrix audit、截图 | PX-2/PX-3/PX-5 |
| AC-PX-09 隐私与交易边界 | 使用脱敏测试账户 | 运行全路径并扫描证据和网络 | secret/cookie/token/账户原图=0；broker order 请求=0；四锁恒 false | redaction + trade boundary audit | 全阶段 |
| AC-PX-10 防假绿 | 完整候选证据已生成 | 删除截图、改 hash、换 mock URL、制造事件乱序/合同版本漂移/unknown→success | 所有负例必须失败；正例全部通过；commit 可复核 | negative fixtures、G1-G7 audit | PX-6/对应来源阶段 |

## 11. 计划验收命令的真实性规则

下列命令的当前存在性必须以 package script 和测试文件为准；已实现命令也只能按各阶段证据声明其实际覆盖，不得因为命令存在就声称 PX6 完成：

```text
npm --prefix backend run test:v2-px-api-contract
npm --prefix backend run test:v2-px-policy
npm --prefix frontend run verify:v2-px-host-bridge
npm --prefix packages/fams-v2-px-extension run test:contracts
npm --prefix packages/fams-v2-px-extension run test:px1-spike
npm --prefix packages/fams-v2-px-extension run test:workspace
npm --prefix packages/fams-v2-px-extension run test:sidepanel
npm --prefix packages/fams-v2-px-extension run test:router
npm --prefix packages/fams-v2-px-extension run test:lifecycle
npm --prefix packages/fams-v2-px-extension run verify:real-chrome
npm --prefix packages/fams-v2-px-extension run verify:acceptance
```

未来每增加一个命令，必须同时增加真实 package script、测试文件、正负例、输出 schema 和证据路径；否则 gate 保持 `not_implemented`。

## 12. 文档阶段验收与出门条件

### 12.1 自动检查

1. XML 解析得到 V2-PX draw.io 恰好 8 页且每页含节点和交互边。
2. 图中文字以中文为主，所有代码实体使用真实或明确计划路径。
3. PRD 恰好包含 PX-REQ-001～PX-REQ-020，traceability 对应 20/20，运行时关键决策检查 40/40。
4. `documentation/implementation/realChrome` 状态无 passed/pending 冲突。
5. Git diff 不含 `frontend/src`、`backend/src`、`packages`、schema、validator、fixture 或构建配置。

### 12.2 人类文档评审

评审者应能只阅读 PRD、原型和 draw.io 回答：

1. 完成后 Side Panel 与 Workspace 分别是什么样。
2. 哪些现有 FAMS 实体被复用，哪些需要修改，哪些尚未开发。
3. 用户动作如何经过 background、FAMS adapter 和现有服务返回结果。
4. 权限、隐私、状态所有权和交易边界在哪里执行。
5. 每个里程碑的用户结果、测试、证据、失败归属和停止条件是什么。
6. PX-1 失败时为什么必须回到 ADR，而不是继续生产实现。
7. 当前 PX-0 v2/v1 合同与目标 v3/v2 差异是什么、为何必须在 PX-1 原子迁移。

### 12.3 当前阶段出门声明

文档验收通过后最多声明：

```text
documentationReadyForImplementationReview=true
productGoalApproval=APPROVED_BY_USER
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
px1FeasibilitySpikeAllowed=true
```

只有用户后续明确发出进入实际开发的批准，才能把 `px1FeasibilitySpikeAllowed` 改为 `true`。任何自动化脚本不得代替该批准。

## 13. 剩余开发工作包与逐包验收顺序

下列顺序是用户未来批准实施后的唯一默认顺序。每个工作包采用“先失败用例与合同 → 最小实现 → 自动验收 → 原始证据 → 阶段审计”的闭环；不允许通过并行越级把后置能力混入前一阶段的完成声明。

PX1-02 必须新增下列八个 target fixture；文件名和路径均是合同，不得用 current fixture、合并文件或缩写名替代：

```text
docs/prototypes/v2-px/fixtures/intent-route-v3.positive.json
docs/prototypes/v2-px/fixtures/intent-route-v3.negative.json
docs/prototypes/v2-px/fixtures/operation-command-v2.positive.json
docs/prototypes/v2-px/fixtures/operation-command-v2.negative.json
docs/prototypes/v2-px/fixtures/dual-container-lifecycle-v3.positive.json
docs/prototypes/v2-px/fixtures/dual-container-lifecycle-v3.negative.json
docs/prototypes/v2-px/fixtures/real-chrome-evidence-v2.positive.json
docs/prototypes/v2-px/fixtures/real-chrome-evidence-v2.negative.json
```

| Work package | 开发内容与具体实体 | 前置 | 计划自动验收 | 人工核查 | 出门/失败处置 |
| --- | --- | --- | --- | --- | --- |
| PX1-01 构建基线 | 创建独立 npm/WXT package、三 entrypoint、锁定依赖、MV3 manifest/CSP | 用户明确批准 PX-1 | extension `build` + `test:px1-spike` | unpacked 扩展可识别，两个容器不是普通网页 mock | 构建/加载失败即 RETURN_TO_ADR |
| PX1-02 合同原子迁移 | `intent-route/3`、`operation-command/2`、lifecycle/3 封闭 eventType、runtime envelope/result/error；同步 schema/validator/fixtures/types；严格创建本节八个 target fixture，current fixtures 只做回归不改写 | PX1-01 | extension `test:contracts`；Host view_source 正例、错误 sidepanel 负例、intent ask question 负例、未知/额外 eventType 负例全部按预期 | 3×3 矩阵、Ask 导航/提交分离、event 与 state 分离可解释 | 任一 schema/validator/fixture/type 或版本漂移均 G2/G3 fail |
| PX1-03 权限与连接 | optional 4000、external connect 3000、ConnectionGate、background `/health` | PX1-02 | permission/manifest/network 负例 | 人类明确看到访问地址与拒绝后果 | 未授权请求非 0 或需扩权即 RETURN_TO_ADR |
| PX1-04 最小路由/标签 | background、intentRouter、workspaceTabManager、最小 WorkspaceState | PX1-02 | 入口 route、20 次 tab reuse、canonical URL | Side Panel 能打开/聚焦真实 Workspace 空壳 | 重复 tab 或错误窗口为 PX-1 fail |
| PX1-05 真实 Chrome 证据 | lifecycle/2→3、Chrome evidence/1→2；Playwright + CDP collector、trace/event/hash/stage manifest | PX1-01～04 | extension `verify:real-chrome`；少视口、重复视口、字段尺寸与图像实际尺寸不一致均必须失败 | extension URL/ID/version/build、恰好 360/420/768/1280、manifest/network/console 可核查 | 任一 target evidence consumer 漂移不得进入 PX-2 |
| PX2-01/PX3-R1 API caller policy | `externalBrainTypes.ts`、deny-by-default route pre-handler、`FamsApiClient.ts` extension ID header、local user、caller allowlist、错误 envelope、交易四锁；全局 CORS 收紧为本地 Web + 配置 extension origins | M1 + 方案 A 用户批准 | backend policy/API：两正例+八负例；真实 Chrome Background 请求 header 与 server 决策 | blocked 文案无交易解锁/原始错误；核查 PX2 CORS 与 PX3 reentry/Chrome 证据 | 缺 Origin 默认放行、Web Origin+伪造 header 放行或 caller header 缺失均停止 PX3 |
| PX2-02 Read/Ask facade | `externalBrainReadService`、`externalBrainAskService`、五端点、分页、同源映射 | PX2-01 | backend `test:v2-px-api-contract` | 与 FAMS Chat/Review/Operation 同一对象对照 | 字段缺失则修 facade；禁止复制计算 |
| PX2-03 Extension adapter | `FamsApiClient`、`FamsDomainAdapter`、GET 有限重试、POST 0 自动重试 | PX2-02 | adapter contract + network fault tests | 断连/超时不出现伪 success | 无法满足则回 API 合同评审 |
| PX2-04 Workspace 垂直切片 | WorkspaceApp/Router、五 View、RecoveryBanner、EvidenceDrawer、768/1280 | PX2-03 | extension `test:workspace` + real Chrome | 五视图信息层级、六状态、来源/证据一致 | M2 仅在真实 read model 下出门 |
| PX3-01 Side Panel | SidePanelApp、QuickAsk、摘要、最近任务、ConnectionGate、360/420 | M2 | extension `test:sidepanel`；真实 extension DOM 必须包含摘要/时间/下一步/主动作且 `body` 非空，禁止只验 shell/root 节点 | ack 与最终回答可区分；首屏不拥挤 | 空 DOM/骨架、完整图/DAG 挤入侧栏均 fail |
| PX3-02 Host Bridge | bridge/button 接入 ChatBox、Daily Review、Operations；extension ID 配置与降级 | PX3-01 | frontend `verify:v2-px-host-bridge` | 三页入口、Host view_source→Workspace、缺扩展提示 | 发送 question/完整对象即 hard fail |
| PX4-01 Router 完整集成（已验收） | 3×3 动作、五 intent、canonical key、correlation/route chain | M3 | extension `test:router` + `verify:router-idempotency-chrome` | 三入口同对象落在相同工作区/视图 | 自动化 PASS；证据见 PX5 阶段审计 |
| PX4-02 at-most-once（已验收） | idempotency registry、local dispatch ledger、prepared/dispatched/completed/unknown；固定 cleanup→ledger 回读→recoveryIndex→session 顺序；覆盖副作用前/后 storage 写失败 | PX4-01 | 重放、冲突、restart、timeout、prepared/dispatched 写失败、结果后 completed 写失败负例 | 结果后写失败显示“已收到但未保存，刷新后到 FAMS 复核”，不得提示安全重试 | 自动化 PASS；同 key 并发 20 次 POST=1，unknown 重放新增 POST=0 |
| PX4-03 边界集成（已验收） | FAMS adapter/policy、证据脱敏、订单 endpoint 监测 | PX4-02 | policy/redaction/trade boundary audits | 所有页面保持研究/人工计划措辞 | 自动化 PASS；secret 正文=0、order/broker=0、交易表差分=0、四锁=false |
| PX5-01 恢复与迁移 | `lifecyclePortManager/lifecycleCoordinator/lifecycleClient`；Back/Forward/Refresh、关闭重开、Chrome 重启、RecoveryIndex/2、启动 TTL/LRU、已知 v1/未知 major | LC-A 验收 + M4 | `test:lifecycle` + `verify:lifecycle-recovery-chrome` | 5 秒内进入 restored/recovering/blocked；上次 view/ref 可识别 | 静默清空、自报 success、Host Port 或保活消息即 fail |
| PX5-02 中断生命周期 | `operationPoller`；FAMS 断连、worker suspend/reconnect、extension 0.1.0→0.2.0 update、lease/轮询停止 | PX5-01 | `verify:lifecycle-interruption-chrome` + lifecycle event/Chrome trace | 5 秒内显示断连结论；恢复失败有下一步；最后容器关闭后无新增 GET | 事件不可推导、POST 被轮询/重发或无容器仍轮询即 fail |
| PX6-01 全量自动验收 | acceptance manifest/report/1→2；G1～G7、20 requirements、四视口、API、可访问性、隐私、负例、commit/hash | M5 | extension `verify:acceptance` | HTML 汇总能从结论钻取 AC01～10 和原始证据 | 任一 target schema/consumer/gate 非绿不生成候选声明 |
| PX6-02 人类体验验收 | 按 AC-PX-01～10 逐项操作、记录截图和结论 | PX6-01 | 自动化仅准备页面/证据 | 用户逐项 check：通过/失败/截图/备注 | 未完成人工核查不声明 candidate |

## 14. 每阶段交付物和责任归属

这里的“责任”是失败打回的代码模块/阶段，不是要求用户组建五个评审角色。

| 阶段 | 必交付 | 失败归属 | 禁止声明 |
| --- | --- | --- | --- |
| PX-1 | package/lock、contract migration、spike audit、real Chrome manifest | Extension shell / contract / browser harness | “产品可用”“五 intent 完成” |
| PX-2 | API contract audit、policy audit、Workspace evidence | Backend facade / adapter / Workspace | “三入口已完成” |
| PX-3 | Side Panel evidence、Host bridge audit、三页面截图 | Side Panel / frontend bridge | “幂等与恢复已完整” |
| PX-4 | entry matrix、dispatch ledger、trade/redaction audit | Router / state / policy integration | “生命周期已完成” |
| PX-5 | lifecycle/storage/recovery audit、Chrome trace | Lifecycle / migration / reconnect | “产品候选已出门” |
| PX-6 | manifest、JSON/HTML report、G1～G7、人工清单 | Evidence/来源阶段 | “生产安全”“正式交易可用” |

阶段证据目录统一为 `.verification/private/v2-px/<commitSha>/<PX-stage>/`。每个 `stage-manifest.json` 必须记录运行命令、退出码、开始/结束时间、代码 commit、Chrome/extension/build 版本、artifact SHA-256、失败归属和人工状态；未提交到 Git 的私有原始证据只在 manifest 中以相对路径和 hash 被引用。
