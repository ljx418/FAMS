# ADR-2026-07-15：V2-PX Route A Workspace Page 宿主与双容器路线

## 状态

```text
status=accepted_for_spike
px0GithubReviewGate=PASS
px1FeasibilitySpikeAllowed=false
px1FeasibilitySpikeEligible=true
routeAStatus=ACCEPTED_FOR_SPIKE
routeAImplementationReadiness=READY_FOR_SPIKE
routeAAdrStatus=ACCEPTED_FOR_SPIKE
```

## 背景

V2-PX External Brain Productization 需要支持三类入口、路由 intent 和真实浏览器双容器生命周期。当前 GitHub main 尚未包含完整 PX 文档、ADR、schemas 和原型增量；旧 V2 evidence 存在静态 mock HTML 截图，不能作为真实 Chrome 证据。

## 决策

选择 Route A 作为 PX-1 受限 feasibility spike 路线：

```text
Independent Workspace Page Host
+ WXT background / sidepanel route reuse
+ intent route contract
+ dual-container lifecycle audit
+ real Chrome evidence only
```

## 选择理由

1. Workspace Page 可以承载完整 External Brain 主体验，不被 sidepanel 尺寸限制。
2. sidepanel 保持轻量入口，适合快速唤起和状态提示。
3. background 作为受控消息和权限边界，便于记录审计事件。
4. intent route contract 可以让三入口走同一套路由语义，降低状态漂移。
5. 双容器生命周期可以用真实 Chrome 自动化验证，避免 mock evidence false green。

## 进入 accepted 前必须冻结的实现细节

Route A 状态必须按以下顺序推进：

```text
PROPOSED -> ACCEPTED_FOR_SPIKE -> TECHNICALLY_VALIDATED -> PRODUCTION_APPROVED
```

以下内容是升为 `ACCEPTED_FOR_SPIKE` 的冻结条件，现已完成：

| 类别 | 必须冻结 |
| --- | --- |
| 权威基线 | `productId / repository / branch / commitSha / hostApplication / extensionPackage` |
| WXT entrypoint | background、sidepanel、Workspace Page 的实际 entrypoint 路径 |
| 构建产物 | Workspace Page 最终 HTML 路径、asset 路径和构建命令 |
| URL 规则 | `chrome.runtime.getURL()` 生成的 canonical Workspace URL |
| Manifest/CSP | manifest 权限、side_panel 配置、host permissions、CSP 修改 |
| Message envelope | background message 的 `type / routeId / correlationId / idempotencyKey / source / target` |
| 打开方式 | sidepanel 到 Workspace Page 的 `tabs.create / tabs.query / tabs.update` 规则 |
| 标签页复用 | 单窗口、多窗口、已存在标签页、聚焦和重复点击规则 |
| 浏览器导航 | Back、Forward、Refresh、关闭重开和 extension reload/update 恢复 |
| 状态交接 | `workspaceId / sourceId / operationId / routePayload` 的归属和交接 |
| 状态所有权 | sidepanel 与 Workspace Page 是否同时轮询、谁拥有写入权、如何去重 |
| 幂等 | duplicate ingest 的 `idempotencyKey` 规则 |
| 证据 | 真实 Chrome screenshot、trace、event log、SHA-256 和 commitSha |

上述 PX-1 spike 合同与 authority baseline SHA 已在 PX-0 基线中冻结，ADR 现为 `ACCEPTED_FOR_SPIKE`。这不是 `TECHNICALLY_VALIDATED` 或 `PRODUCTION_APPROVED`。

### Entrypoint 与构建合同

```text
extensionPackage=packages/fams-v2-px-extension
backgroundEntrypoint=packages/fams-v2-px-extension/entrypoints/background.ts
sidepanelEntrypoint=packages/fams-v2-px-extension/entrypoints/sidepanel/index.html
workspacePageEntrypoint=packages/fams-v2-px-extension/entrypoints/workspace/index.html
buildCommand=npm --prefix packages/fams-v2-px-extension run build
chromeMv3Output=packages/fams-v2-px-extension/.output/chrome-mv3
workspaceOutput=workspace.html
canonicalWorkspaceUrl=chrome.runtime.getURL('/workspace.html')
```

这些是 spike 的目标路径，不表示 PX-0 已创建或验证该包。

### Manifest 与权限合同

```text
manifestVersion=3
requiredPermissions=sidePanel,tabs,storage
optionalPermissions=[]
hostPermissions=[]
sidePanelDefaultPath=sidepanel.html
extensionPagesCsp=script-src 'self'; object-src 'self'
remoteExecutableCodeAllowed=false
```

PX-1 如发现需要新增 permission 或 host permission，必须先修改 ADR 并重新评审，不能在实现中静默扩权。

### Message envelope 与路由合同

background 只接受 `v2-px-operation-command/1` 和 `v2-px-intent-route/2` 合同。消息必须带：

```text
type / routeId / correlationId / idempotencyKey / sourceContainer / targetContainer / payload
```

`payload` 必须通过按 intent/command 分支的严格 schema，禁止附加字段和 secret-like 字段。sidepanel、Workspace Page 与 host app 不直接互相写状态，写操作统一通过 background。

### 打开、复用与多窗口规则

1. sidepanel 或 host app 发出 `open_workspace/open_in_workspace` 后，background 使用 canonical Workspace URL 查询标签页。
2. 当前窗口已有同一 `workspaceId` 的标签页时，复用并聚焦该标签页。
3. 当前窗口没有、其他窗口存在时，聚焦最近活动的匹配窗口和标签页。
4. 不存在匹配标签页时才调用 `tabs.create`。
5. 重复点击共享同一 `idempotencyKey` 时不得重复创建；同 key 不同 payload 必须拒绝并审计。

### 导航、恢复与状态所有权

```text
canonicalIdentity=workspaceId
routeCorrelation=routeId + correlationId
backgroundOwnsWrites=true
sidepanelPollingAllowed=false
workspacePollingAllowed=false
containersSubscribeToBackgroundState=true
duplicateCommandPolicy=deduplicate_same_semantics_reject_conflict
```

Back/Forward 由 Workspace Page URL state 恢复 intent；Refresh 从 `storage.session` 恢复 route/correlation，持久索引只读自 `storage.local`；关闭重开生成新 routeId，但保留 workspaceId；extension reload/update 后由容器 `reconnect` 重新订阅。任何无法恢复的状态必须记录 `blocked`，不得静默展示成功态。

### 真实 Chrome 证据合同

PX-1 必须用真实安装的 unpacked Chrome extension 生成：

```text
chrome-extension:// URL
Chrome version + extensionId + baseline commitSha
360/420/768/1280 viewport screenshots
Playwright trace / lifecycle event log
每个 artifact 的 SHA-256
```

`backend/scripts/verify-v2-px-semantic-contract.ts` 是 PX-1 证据的前置语义门禁；PX-0 fixture 通过不等于真实 Chrome 通过。

## 被拒绝路线

| 路线 | 放弃原因 |
| --- | --- |
| Route B：只用 sidepanel 承载完整体验 | 面板空间不足，难以承载图表、任务、审计和多步工作流 |
| Route C：只用 Web App 页面，不做 extension shell | 无法验证扩展入口、background、sidepanel 和双容器生命周期 |
| Route D：先做生产实现再补 ADR/schema | 容易产生 PX-2+ 先行和 false green 验收 |

## PX-1 Spike 问题

PX-1 必须回答：

```text
workspacePageCanHostFullExperience?
sidepanelCanLaunchAndResumeWorkspace?
backgroundCanRouteIntent?
intentRouteSchemaCanValidateThreeEntries?
dualContainerLifecycleCanBeAudited?
realChromeEvidenceCanBeGenerated?
```

PX-1 仍是 feasibility spike，不得顺带实现 PX-2+ 生产能力。

## 放弃条件

以下任一失败，Route A 需要重新评审：

```text
workspacePageHostCannotStartInTargetBrowser=true
sidepanelToWorkspaceLifecycleCannotBeTracked=true
backgroundIntentRouteCannotBeAudited=true
realChromeEvidenceCannotBeGenerated=true
```

## 领域安全边界

Route A 是 External Brain 产品化路线，不得在 PX core schema 中内置具体业务域的交易、投资建议或订单字段。若权威产品基线最终确认属于 FAMS，则 FAMS adapter 必须在外层 policy 中继续执行既有交易 gate；若最终确认属于 Navia/mercury，则相关 FAMS 字段必须完全移除。

```text
pxCoreDomainPolicy=DOMAIN_NEUTRAL
domainSpecificTradingGateLivesInAdapter=true
```
