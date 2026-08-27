# V2-PX External Brain Productization 开发及验收计划

更新时间：2026-08-27

## 1. 阶段定位

V2-PX 的目标是把 External Brain 从当前项目内的研究/工作台能力，产品化为可被真实浏览器验证、可审计、可回放、可人工核查的 PX 体验。用户已认可产品规划和目标，但本轮明确回到文档开发阶段：先补齐 PRD、原型、目标架构、里程碑、验收门槛和 draw.io，再等待用户单独批准实际开发。PX-1 尚未启动，不允许直接进入 PX-2+ 生产实现。

```text
currentStage=DOCUMENTATION_REDESIGN_COMPLETE_AWAITING_USER_IMPLEMENTATION_APPROVAL
px0GithubReviewGate=PASS
authorityBaselineStatus=FROZEN
productGoalApproval=APPROVED_BY_USER
routeAStatus=ACCEPTED_FOR_SPIKE
routeAImplementationReadiness=DOCUMENTATION_REDESIGNED_AWAITING_USER_APPROVAL
semanticValidatorImplemented=true
px1FeasibilitySpikeAllowed=false
px1FeasibilitySpikeEligible=true
px1PlanningAllowed=true
px2PlusAllowed=false
v2PxComplete=false
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
productionCodeChangesAllowedInCurrentPhase=false
```

本计划的架构、原型、追踪和图形入口分别为 `V2_PX_TARGET_ARCHITECTURE.md`、`prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md`、`V2_PX_PRD_TRACEABILITY_MATRIX.md` 和 `v2-px-target-architecture-gap.drawio`；自动文档验收记录在 `V2_PX_DOCUMENTATION_ACCEPTANCE.md`。

### 1.0.1 当前文档阶段硬边界

本轮只允许修改 `.md`、`.drawio` 和权威文档状态源。此前 PX-0 允许的 validator/fixture 范围不构成本轮授权；没有用户新的明确批准，不得创建 extension package、修改 FAMS 生产源码、调整 schema 行为或运行 PX-1 spike。

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

进入条件：PX-0 全部通过，并经单独启动确认。当前为 eligible，但尚未启动。

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

当前阶段状态：

```text
px0GithubReviewGate=PASS
px1FeasibilitySpikeEligible=true
px1SixSpikesPassed=false
realChromeEvidencePassed=false
v2PxComplete=NO_GO
```

## 7. 实现实体与阶段边界

完整分层和交互关系以 `docs/V2_PX_TARGET_ARCHITECTURE.md` 为准。下表是阶段级变更清单；所有目标实体在用户批准前均保持“未开发”。

| 阶段 | 允许触碰的目标实体 | 明确不允许 | 阶段完成后的用户效果 |
| --- | --- | --- | --- |
| 当前文档阶段 | PRD、计划、原型规格、ADR、traceability、draw.io、文档状态源 | 任何生产源码、extension package、schema 行为和 runtime test | 人类能正确判断目标、实体、风险、里程碑和验收 |
| PX-1 | 最小 `wxt.config.ts`、三个 entrypoint、最小 router/store、Chrome evidence collector | 五 intent 完整业务 UI、FAMS 生产聚合 API | 真实 Chrome 证明双容器、连接、路由和证据路线可行 |
| PX-2 | `WorkspaceApp/Router`、五视图外壳、RecoveryBanner、EvidenceDrawer | 完整 Side Panel 和复杂 router 生产化 | 用户可在完整页面查看分层结果并刷新恢复 |
| PX-3 | `SidePanelApp`、ConnectionGate、FAMS host bridge/button | 将复杂图表/DAG 塞入侧栏 | 用户可从轻入口或 FAMS 页面进入同一工作区 |
| PX-4 | intentRouter、tab manager、idempotency、FAMS read facade/adapter | 复制投资计算或绕过现有服务 | 三入口和五 intent 真正连接现有 FAMS 事实 |
| PX-5 | lifecycle store、恢复、断连退避、reload/update | 由 UI 自报成功或无限轮询 | 用户跨刷新、重开和断连仍能恢复或看见明确阻断 |
| PX-6 | acceptance collector、manifest、HTML、G1～G7、人工清单 | 修复中顺带扩大产品范围 | 人类可按 commit、截图、trace 和步骤完成最终体验核查 |

## 8. 详细开发顺序与阶段出门

### D0 文档重构（当前阶段）

开发内容：

1. 将对话中认可的目标写入权威 PRD。
2. 固化 Side Panel 与 Workspace 的原型、六种状态和四视口。
3. 盘点现有 FAMS 实体，定义待修改、待新增和直接复用实体。
4. 关闭 host permission 与 FAMS 数据接入冲突。
5. 把 20 项 requirement 映射到实体、阶段、计划测试、证据和人类核查。
6. 生成不超过 8 页的中文 draw.io gap 文档。

出门：文档自动审计通过后只可请求用户批准 PX-1，不自动进入实现。

### PX-1 Route A.1 feasibility spike

开始条件：D0 全部通过，且用户在新指令中明确批准进入实际开发。

最小范围：

1. unpacked MV3 extension 能在真实 Chrome 启动。
2. Side Panel 与独立 Workspace 空壳能启动。
3. 用户主动授予本地 FAMS optional host permission，background 只读访问 `/health`。
4. 三入口最小 command 能通过统一 schema 进入 background。
5. workspace tab query/create/focus 和同 key 去重可验证。
6. lifecycle event、真实截图、trace、extension ID、Chrome 版本、hash 和 commit 可导出。

PX-1 不实现完整五 intent 业务结果。任一关键路径不可行则 `routeAStatus=RETURN_TO_ADR`，不进入 PX-2。

### PX-2 Workspace 产品化

先实现完整页面框架、五 intent 页面状态和信息分层，再接 read model。用户看到的是可理解的 Workspace，而不是技术字段集合。必须先通过 768/1280、刷新恢复和六状态验收。

### PX-3 Side Panel 与 Host App 入口

Side Panel 只保留快速提问、当前摘要、连接状态、最近任务和打开工作台。FAMS ChatBox、Daily Review、Operations 使用同一个 bridge/button 传递受控 ID；扩展缺失时给出可理解降级，不抛原始异常。

### PX-4 Router、幂等与 FAMS Adapter

实现 Background 单写者、标签复用、五 intent read facade 和 policy。所有业务结果继续由现有 FAMS service 生成；adapter 只转换 read model。此阶段必须证明重复动作无副作用、五 intent 不漂移、交易端点请求为 0。

### PX-5 生命周期与恢复

依次验证 Back、Forward、Refresh、关闭重开、FAMS 断连、background suspend/reconnect、extension reload/update。每次恢复必须由 event log 推导；失败时进入 blocked 并给下一步。

### PX-6 完整候选验收

汇总 PX-1～PX-5 的真实证据，生成 JSON + HTML 报告和人类体验检查表。自动化只负责准备证据，不能代替人工体验结论，也不能开放交易。

## 9. 项目里程碑

| Milestone | 依赖 | 自动化出门门槛 | 人类看到的结果 | 当前状态 |
| --- | --- | --- | --- | --- |
| M0 Documentation Review Ready | 无 | 20/20 traceability；8 页图可解析；文档状态一致；代码 diff=0 | 能评估目标体验、架构风险和验收风险 | 当前进行中 |
| M1 Route A Technically Validated | M0 + 用户批准 | 六项 spike、真实 Chrome、权限和负例全部通过 | Side Panel/Workspace 空壳真实可运行 | 未开始 |
| M2 Workspace Host Accepted | M1 + 人工确认 | 768/1280、五视图、六状态、刷新恢复通过 | 完整工作台可理解、可浏览 | 未开始 |
| M3 Side Panel Entry Accepted | M2 | 360/420、简明摘要、连接、跳转和 host app 入口通过 | 随时快速提问并进入完整页 | 未开始 |
| M4 Intent & FAMS Adapter Accepted | M3 | 三入口、五 intent、20 次 tab/idempotency、交易边界通过 | 同一任务不重复，结果来自现有 FAMS | 未开始 |
| M5 Lifecycle Accepted | M4 | 必测 lifecycle 场景 100% 可推导 | 刷新、重开、断连可恢复或明确阻断 | 未开始 |
| M6 Productization Candidate | M5 | G1～G7、四视口、隐私、HTML、人工体验通过 | 可作为本地浏览器产品化候选使用 | 未开始 |

## 10. 用户场景验收目录

每个场景同时包含前置条件、操作、通过阈值、证据和失败归属，禁止用“页面正常”“体验良好”等不可复核描述代替。

| 场景 | 前置条件 | 人类/自动化操作 | 量化通过阈值 | 必须证据 | 失败打回 |
| --- | --- | --- | --- | --- | --- |
| AC-PX-01 首次连接 | extension 已安装，FAMS 3000/4000 已启动，未授予主机权限 | 打开 Side Panel，点击连接，确认精确 origin | 安装默认 host 权限为空；授权后 `/health` 200；无 `<all_urls>` | permission audit、截图、network log | PX-1 |
| AC-PX-02 快速提问 | 已连接，存在可查询的本地数据 | Side Panel 输入问题并发送 | 2 秒内显示 shell；结果含结论/依据/时间/下一步；原始异常=0 | 360/420 截图、route trace | PX-3/PX-4 |
| AC-PX-03 打开工作台 | Side Panel 有当前 workspace | 连续点击 20 次“在完整工作台打开” | 同 workspace tab=1；重复 operation=0；1 秒内聚焦 | multi-window tab trace | PX-4 |
| AC-PX-04 Host App 跳转 | FAMS ChatBox、Daily Review、Operations 可访问 | 分别点击“在外部大脑打开” | 三入口业务对象一致；route/correlation 链完整 | entry matrix、三处截图 | PX-3/PX-4 |
| AC-PX-05 五 intent | 存在 review、operation 和 artifact | 依次进入来源库、详情、问答、追踪、图谱 | 5/5 有真实 read model；不存在数据时显示 empty，不用 mock | intent audit、五视图截图 | PX-2/PX-4 |
| AC-PX-06 四视口 | Side Panel/Workspace 已构建 | 360/420/768/1280 运行 | `scrollWidth<=clientWidth`；关键动作可见；console errors=0 | 四视口截图、DOM audit | PX-2/PX-3 |
| AC-PX-07 生命周期 | 工作区已打开 | Back/Forward/Refresh/关闭重开/reload/断连重连 | 每个场景 100% 为 restored 或 blocked；5 秒内显示结果 | lifecycle events、Chrome trace | PX-5 |
| AC-PX-08 状态降级 | 可注入连接失败、空数据、schema 冲突 | 触发未连接/加载/空/失败/恢复/阻断 | 6/6 有原因和下一步；伪 success=0 | state matrix audit、截图 | PX-2/PX-3/PX-5 |
| AC-PX-09 隐私与交易边界 | 使用脱敏测试账户 | 运行全路径并扫描证据和网络 | secret/cookie/token/账户原图=0；broker order 请求=0；四锁恒 false | redaction + trade boundary audit | 全阶段 |
| AC-PX-10 防假绿 | 完整候选证据已生成 | 删除截图、改 hash、换 mock URL、制造事件乱序 | 所有负例必须失败；正例全部通过；commit 可复核 | negative fixtures、G1-G7 audit | PX-6/对应来源阶段 |

## 11. 计划验收命令的真实性规则

PX-1+ 的命令当前只是计划，不得在 package script 不存在时声称可执行：

```text
npm run test:v2-px-entry-matrix
npm run test:v2-px-workspace-host
npm run test:v2-px-sidepanel-entry
npm run test:v2-px-background-router
npm run test:v2-px-fams-adapter
npm run test:v2-px-dual-container-lifecycle
npm run test:v2-px-accessibility
npm run test:v2-px-acceptance
```

未来每增加一个命令，必须同时增加真实 package script、测试文件、正负例、输出 schema 和证据路径；否则 gate 保持 `not_implemented`。

## 12. 文档阶段验收与出门条件

### 12.1 自动检查

1. XML 解析得到 V2-PX draw.io 恰好 8 页且每页含节点和交互边。
2. 图中文字以中文为主，所有代码实体使用真实或明确计划路径。
3. PRD 恰好包含 PX-REQ-001～PX-REQ-020，traceability 对应 20/20。
4. `documentation/implementation/realChrome` 状态无 passed/pending 冲突。
5. Git diff 不含 `frontend/src`、`backend/src`、`packages`、schema 或构建配置。

### 12.2 人类文档评审

评审者应能只阅读 PRD、原型和 draw.io 回答：

1. 完成后 Side Panel 与 Workspace 分别是什么样。
2. 哪些现有 FAMS 实体被复用，哪些需要修改，哪些尚未开发。
3. 用户动作如何经过 background、FAMS adapter 和现有服务返回结果。
4. 权限、隐私、状态所有权和交易边界在哪里执行。
5. 每个里程碑的用户结果、测试、证据、失败归属和停止条件是什么。
6. PX-1 失败时为什么必须回到 ADR，而不是继续生产实现。

### 12.3 当前阶段出门声明

文档验收通过后最多声明：

```text
documentationReadyForImplementationReview=true
productGoalApproval=APPROVED_BY_USER
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
px1FeasibilitySpikeAllowed=false
```

只有用户后续明确发出进入实际开发的批准，才能把 `px1FeasibilitySpikeAllowed` 改为 `true`。任何自动化脚本不得代替该批准。
