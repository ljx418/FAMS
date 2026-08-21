# ADR-2026-07-15：V2-PX Route A Workspace Page 宿主与双容器路线

## 状态

```text
status=proposed
px0GithubReviewGate=FAIL
px1FeasibilitySpikeAllowed=false
routeAStatus=PROPOSED
routeAImplementationReadiness=FAIL
routeAAdrStatus=PROPOSED
```

## 背景

V2-PX External Brain Productization 需要支持三类入口、路由 intent 和真实浏览器双容器生命周期。当前 GitHub main 尚未包含完整 PX 文档、ADR、schemas 和原型增量；旧 V2 evidence 存在静态 mock HTML 截图，不能作为真实 Chrome 证据。

## 决策

提议选择 Route A：

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

当前 ADR 仍是 `proposed`。Route A 状态必须按以下顺序推进：

```text
PROPOSED -> ACCEPTED_FOR_SPIKE -> TECHNICALLY_VALIDATED -> PRODUCTION_APPROVED
```

只有以下内容全部补齐，才允许升为 `ACCEPTED_FOR_SPIKE`：

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
pxCoreDomainPolicy=UNRESOLVED
domainSpecificTradingGateLivesInAdapter=true
```
