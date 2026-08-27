# V2-PX API、消息、状态与安全运行时合同

更新时间：2026-08-27

## 1. 文档定位与约束优先级

本文冻结 V2-PX 在本地单用户范围内的实现级合同，解决 PRD、原型、现有 PX-0 schema 与目标架构之间原先存在的技术留白。本文是开发前规格，不是实现文件；当前不得据此创建扩展包或修改前后端代码。

```text
contractStatus=TARGET_DECISIONS_FROZEN_DOCUMENTATION_ONLY
implementationStatus=NOT_STARTED
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
currentIntentRouteSchema=v2-px-intent-route/2
targetIntentRouteSchema=v2-px-intent-route/3
currentOperationCommandSchema=v2-px-operation-command/1
targetOperationCommandSchema=v2-px-operation-command/2
currentLifecycleAuditSchema=v2-px-dual-container-lifecycle/2
targetLifecycleAuditSchema=v2-px-dual-container-lifecycle/3
currentRealChromeEvidenceSchema=v2-px-real-chrome-evidence/1
targetRealChromeEvidenceSchema=v2-px-real-chrome-evidence/2
currentAcceptanceSchemas=v2-px-acceptance-manifest/1,v2-px-acceptance-report/1
targetAcceptanceSchemas=v2-px-acceptance-manifest/2,v2-px-acceptance-report/2
runtimeContractImplemented=false
```

发生冲突时按以下顺序处理，不允许开发者静默自行选择：

1. `V2_PX_PRD.md` 决定产品目标、非目标和用户出门体验。
2. `ADR-2026-07-15-v2-px-route-a.md` 决定 Route A.1、双容器和权限路线。
3. 本文决定 API、消息、状态、错误、存储、幂等和本地安全合同。
4. `V2_PX_TARGET_ARCHITECTURE.md` 决定代码实体和依赖方向。
5. `V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md` 决定实施顺序、阶段门和验收证据。
6. 原型规格决定信息层级、文案、状态和视口体验，不得反向改变业务合同。

仍不能按上述顺序解决的冲突必须返回文档评审，禁止在代码中“合理猜测”。

## 2. 已关闭的合同冲突

| 编号 | 原冲突 | 冻结决策 | 实施归属 |
| --- | --- | --- | --- |
| CT-GAP-01 | 架构称“只读聚合”，但快速问答会写入本地 Chat 会话并可能创建 Operation | 分为只读 Query Facade 与受控 Ask Facade；Ask 只允许 `read_only_direct/compute_quick_run`，禁止自动确认 | PX-2/PX-4 |
| CT-GAP-02 | `intent-route/2` 强制全部 `view_source -> sidepanel`，与 Workspace 原地查看和 Host 跳转冲突 | 目标 `intent-route/3` 使用入口动作矩阵；Host 的 `view_source` 进入 Workspace，Workspace 原地查看 | PX-1 |
| CT-GAP-03 | `ask` route payload 同时承担导航和提交问题 | Intent Route 只导航到 Ask View；问题只放在 `operation-command/2 query` | PX-1 |
| CT-GAP-04 | 扩展 optional host 权限错误包含前端 3000 | 扩展网络权限只含后端 4000；3000 只属于 `externally_connectable.matches` | PX-1 |
| CT-GAP-05 | API 只有 URL，没有 DTO、错误、分页、身份和幂等规则 | 本文冻结五端点、统一 envelope、错误码和本地用户策略 | PX-2 |
| CT-GAP-06 | session/local 存什么、多久、如何迁移没有定论 | 冻结 WorkspaceState、30 天恢复索引、24 小时 dispatch ledger 和未知版本阻断策略 | PX-1/PX-5 |
| CT-GAP-07 | 计划命令没有明确在哪个 package 执行 | 所有命令按 backend/frontend/extension 三个实际 package 归属 | PX-1～PX-6 |

当前 JSON schema 与 semantic validator 是已提交的 PX-0 历史基线，不能被描述为目标 v3/v2 已实现。用户批准实施后，PX-1 必须把 schema、validator、正负 fixture 和类型绑定作为一个原子变更完成；任一部分缺失则 G2/G3 失败。

## 3. 标识与规范化规则

| 字段 | 目标格式 | 生成者 | 稳定性 |
| --- | --- | --- | --- |
| `workspaceId` | `px-ws-<uuid>` | Background | 同一研究任务跨 route、刷新和重开保持不变 |
| `routeId` | `px-route-<uuid>` | 每次路由动作的接收方 Background | 每次新动作生成，重放同一动作不生成第二个 |
| `correlationId` | `px-corr-<uuid>` | 首个入口或继承父任务 | 一条跨入口因果链保持不变 |
| `commandId` | `px-command-<uuid>` | 命令发起容器 | 单次命令唯一 |
| `idempotencyKey` | `px-idem-<base64url>` | 命令发起容器 | 同一用户动作重试必须复用 |
| `sourceRef` | `op-artifact:<operationId>:<base64url(ref)>` 或 `review-evidence:<reviewId>:<base64url(ref)>` | Query Facade | opaque；UI 不解析业务内容 |

`canonicalRouteKey` 是下列稳定 JSON 经字段名排序、UTF-8 编码和 SHA-256 后得到的十六进制摘要：

```json
{
  "workspaceId": "...",
  "routeIntent": "source_library|source_detail|ask|trace|graph",
  "targetContainer": "sidepanel|workspace_page",
  "sourceRef": "optional",
  "operationId": "optional",
  "reviewId": "optional",
  "graphScope": "optional"
}
```

不得把 `routeId`、`correlationId`、`idempotencyKey`、question、时间戳或 UI 展开状态加入 canonical key。

Workspace canonical URL 为：

```text
chrome.runtime.getURL('/workspace.html')
  ?workspaceId=<encoded>
  &view=<source_library|source_detail|ask|trace|graph>
  &ref=<optional encoded opaque ref>
```

标签页身份只比较 extension origin、`workspace.html` 和 `workspaceId`；切换 view/ref 不创建新标签页。URL 禁止携带 question、摘要、截图、token、cookie、账户值或完整业务对象。

## 4. 目标运行时消息合同

### 4.1 外层消息 envelope

所有容器到 Background 的内部消息使用 `v2-px-runtime-message/1`：

```ts
type RuntimeMessage = {
  schemaVersion: 'v2-px-runtime-message/1'
  messageId: `px-message-${string}`
  kind: 'intent_route' | 'operation_command' | 'state_subscribe' | 'state_snapshot' | 'command_result'
  sourceContainer: 'sidepanel' | 'workspace_page' | 'host_app' | 'background'
  targetContainer: 'sidepanel' | 'workspace_page' | 'background'
  sentAt: string
  payload: unknown
}
```

Background 的处理顺序必须固定为：sender 校验 → envelope schema → payload schema → secret-like 扫描 → policy → idempotency/route 规范化 → 状态事件 → 网络或 tab 动作 → command result。任何一步失败都不得继续执行后续副作用。

### 4.2 `intent-route/3` 只负责导航

目标 v3 保留三入口、三动作和五 intent，但 `ask` payload 不再包含 question。五种 payload：

| Intent | 必填 | 可选 | 禁止 |
| --- | --- | --- | --- |
| `source_library` | `workspaceId` | `filter` | 原始 artifact 内容 |
| `source_detail` | `workspaceId, sourceRef` | 无 | source body |
| `ask` | `workspaceId` | `conversationId` | `question` |
| `trace` | `workspaceId, operationId` | `sourceRef` | Operation 完整 JSON |
| `graph` | `workspaceId, graphScope, graphId` | `focusNodeId` | DAG 完整 JSON |

入口动作矩阵是目标 v3 的唯一合法映射：

| 入口 | `view_source` | `open_workspace` | `open_in_workspace` |
| --- | --- | --- | --- |
| Side Panel | `sidepanel` 内显示来源摘要 | 打开/聚焦 `workspace_page` | `workspace_page` 定位 view/ref |
| Workspace Page | 当前 `workspace_page` 原地切换详情 | 聚焦当前 `workspace_page` | 当前 `workspace_page` 定位 view/ref |
| FAMS Host App | `workspace_page` 打开来源详情 | 打开/聚焦 `workspace_page` | `workspace_page` 定位 review/operation/source |

Host App 不要求自动打开 Side Panel。原因是 Chrome 对 `sidePanel.open()` 的用户手势传递存在可行性风险；PX-1 可以验证能力，但产品正确 fallback 已冻结为 Workspace Page，不得让 Host 操作静默无响应。

### 4.3 `operation-command/2` 负责真实动作

目标 v2 命令保持三个 command type，但重新冻结其边界：

| Command | payload | 权限 | 副作用边界 |
| --- | --- | --- | --- |
| `query` | `workspaceId, question, contextRefs[], conversationId?` | `compute_quick_run` | 可追加本地 FAMS Chat 会话；不可自动确认工具、创建订单或启用交易 |
| `refresh_index` | `workspaceId` | `read_only_direct` | 只重取 read model 与更新 session route state |
| `ingest_source` | `workspaceId, sourceRef, contentDigest` | `read_only_direct` | 只把已存在 FAMS sourceRef 加入 PX 最小索引；不上传网页正文，不创建第二业务库 |

所有命令必须附带 `payloadDigest=sha256(stableJson(payload))`。同 key 同 digest 按 ledger 状态重放；同 key 不同 digest 返回 `PX_IDEMPOTENCY_CONFLICT`，不得调用后端。

Host App 外部消息只允许 `intent_route`，禁止发送 `operation_command`。快速问题只能从扩展自己的 Side Panel/Workspace UI 提交，防止任意本地网页借 bridge 触发计算。

### 4.4 Command result

Background 返回：

```ts
type CommandResult = {
  schemaVersion: 'v2-px-command-result/1'
  commandId: string
  routeId: string
  correlationId: string
  status: 'accepted' | 'completed' | 'empty' | 'blocked' | 'failed' | 'unknown_result'
  resultRef?: { conversationId?: string; messageId?: string; operationId?: string; sourceRef?: string }
  error?: { code: PxErrorCode; userMessage: string; recoverable: boolean }
  completedAt: string
}
```

UI 只根据该 result 与 WorkspaceState 渲染，不根据 HTTP 文本自行猜测 success。

## 5. Workspace 状态、存储和幂等合同

### 5.1 WorkspaceState v1

```ts
type WorkspaceStateV1 = {
  schemaVersion: 'v2-px-workspace-state/1'
  workspaceId: string
  lifecycleStatus: 'uninitialized' | 'connecting' | 'ready' | 'loading' | 'empty' | 'failed' | 'disconnected' | 'recovering' | 'blocked' | 'closed'
  currentView: 'source_library' | 'source_detail' | 'ask' | 'trace' | 'graph'
  routeId: string
  correlationId: string
  selectedRef?: string
  conversationId?: string
  activeOperationId?: string
  connection: { status: 'not_connected' | 'connecting' | 'connected' | 'disconnected' | 'blocked'; lastHealthAt?: string }
  recovery: { status: 'not_needed' | 'recovering' | 'restored' | 'blocked'; reasonCode?: PxErrorCode }
  containerLeases: Array<{ container: 'sidepanel' | 'workspace_page'; instanceId: string; lastSeenAt: string }>
  lastEventSeq: number
  updatedAt: string
}
```

WorkspaceState 不保存问题文本、回答正文、持仓值、截图或完整业务 read model。页面重开后按 conversationId/operationId/sourceRef 从 FAMS 重取。

### 5.2 存储分配

| 存储 | 允许内容 | 上限/TTL | 清理 |
| --- | --- | --- | --- |
| `chrome.storage.session` | WorkspaceState、容器 lease、lifecycle events、非敏感 result refs | 最多 20 workspace；事件最多 1000 条 | 浏览器会话结束；超过上限 LRU |
| `chrome.storage.local.recoveryIndex` | workspaceId、currentView、selectedRef、conversationId/operationId、updatedAt、schemaVersion | 最多 20 条；30 天 | 启动和每次写入时删除过期并 LRU |
| `chrome.storage.local.dispatchLedger` | idempotencyKey、payloadDigest、dispatchState、resultRef、createdAt、expiresAt | 最多 500 条；24 小时 | 启动和每次写入时清理过期 |
| React memory | 当前 read model 和摘要正文 | 容器生命周期 | 容器关闭即清理 |

任何存储项都不得包含 cookie、token、Authorization、账户原图或原始网页正文。`question` 只存在于命令内存和 FAMS Chat 的既有本地会话文件中，dispatch ledger 只存 digest。

### 5.3 at-most-once dispatch

对 `query/ingest_source` 执行：

1. 计算 digest 并先以 `prepared` 原子写入 local ledger。
2. 写入 `dispatched` 后发起一次后端请求；POST 在 dispatch 后禁止自动重试。
3. 成功写 `completed + resultRef`；安全失败写 `failed_before_effect`。
4. reload 后遇到 `prepared` 可安全重试；遇到 `dispatched` 且无结果必须返回 `unknown_result`，不得自动二次调用。
5. 同 key 同 digest 且 completed 返回 resultRef；同 key 不同 digest hard fail。

这保证系统不会为了隐藏不确定性而重复创建 Chat/Operation。用户明确发起一个新动作会生成新 key，不属于自动重试。

### 5.4 状态迁移与版本

```text
uninitialized -> connecting -> ready | blocked
ready -> loading -> ready | empty | failed
ready -> disconnected -> recovering -> ready | blocked
failed -> recovering -> ready | blocked
any live state -> closed (由 lease 失效事件推导)
```

- 已知旧 minor 版本使用显式 migrator 并产生 `state_migrated` event。
- 未知 major 版本进入 `PX_STORAGE_VERSION_UNSUPPORTED` blocked；禁止静默清空。
- 当前无生产 PX 数据，因此 v1 首次上线没有业务数据迁移；仍必须提供旧/未知版本负例测试。

## 6. FAMS External Brain API v1

### 6.1 本地身份和公共 envelope

API base 固定为 `/api/v1/external-brain`。首期 facade 只服务本地用户 `default`：服务端自行注入 `userId='default'`，请求不得接受 userId；出现 userId 字段返回 400。该行为不构成生产身份能力。

所有成功或业务阻断响应使用：

```ts
type ExternalBrainResponse<T> = {
  schemaVersion: 'fams.external-brain.response.v1'
  requestId: string
  generatedAt: string
  status: 'ok' | 'accepted' | 'empty' | 'blocked' | 'unavailable'
  data: T | null
  evidenceRefs: Array<{ ref: string; kind: 'artifact' | 'review' | 'operation' | 'browser'; asOf?: string }>
  warnings: Array<{ code: string; message: string; recoverable: boolean }>
  executionBoundary: {
    researchOnly: true
    formalTradingUnlocked: false
    autoTradeUnlocked: false
    canCreateOrder: false
    orderCreateAllowed: false
  }
}
```

HTTP transport error也必须返回 `error.code/userMessage/recoverable/requestId`，禁止把 stack、SQL、文件路径或 provider secret 发给扩展。

### 6.2 端点与 DTO

#### GET `/sources`

Query：`kind=all|operation_artifact|daily_review_evidence`（默认 all）、`limit=1..50`（默认 20）、`cursor=<opaque>`。按 `asOf desc, sourceRef asc` 稳定排序。

```ts
type SourceListData = {
  items: Array<{
    sourceRef: string
    kind: 'operation_artifact' | 'daily_review_evidence'
    title: string
    summary: string
    asOf: string
    freshnessStatus: 'fresh' | 'stale' | 'unknown'
    trustStatus: 'available' | 'partial' | 'blocked' | 'missing'
    operationId?: string
    reviewId?: string
  }>
  nextCursor: string | null
}
```

空列表返回 HTTP 200、`status=empty`、`items=[]`，不是 404。

#### GET `/sources/:sourceRef`

返回 `sourceRef/kind/title/summary/asOf/sourceSystem/freshnessStatus/trustStatus/relatedOperationId?/relatedReviewId?/evidenceRefs[]/displaySections[]`。artifact 不存在返回 404 `PX_RESOURCE_NOT_FOUND`，但客户端保留 sourceRef 并显示“来源已不可用”。

#### POST `/ask`

Request：

```ts
type AskRequest = {
  schemaVersion: 'fams.external-brain.ask-request.v1'
  workspaceId: string
  conversationId?: string
  question: string // 1..1000
  contextRefs: string[] // 0..20，只允许 sourceRef/reviewId/operationId
  idempotencyKey: string
}
```

External Brain route 调用 `ExternalBrainAskService`，后者只委托现有 `famsChatService`。允许权限 `read_only_direct/compute_quick_run`；遇到 `confirm_before_operation` 返回 blocked 并给出“回到 FAMS 确认”，不得调用 confirmation endpoint；`permanently_blocked` 必须 hard fail。

Response data：`conversationId/messageId/summary/keyEvidence[]/dataAsOf/confidence/nextActions[]/operationId?/artifactRefs[]/prohibitedActions[]/notTradingAdvice=true`。同步完成返回 200；后台 Operation 已受理返回 202 `status=accepted`。Side Panel 在 1 秒内显示已接收状态，最终结果允许在本地 LLM 超时合同内完成；不得把“shell 已显示”冒充回答已完成。

#### GET `/traces/:operationId`

返回 `operationId/type/status/progressPct/requestedAt/startedAt?/completedAt?/tasks[]/artifactRefs[]/errorSummary?/recoverySummary?`。只暴露脱敏展示字段，不返回 `inputJson/errorJson` 原文。

#### GET `/graphs/:scope/:id`

`scope` 只允许 `daily-review|operation`。返回 `graphId/scope/status/nodes[]/edges[]/evidenceRefs[]`；node 固定字段为 `id,label,status,sequence?,inputsSummary[],outputsSummary[],evidenceRefs[]`。不新建图数据库，Daily Review 复用 `dailyReviewWorkflowService`，Operation 图由 tasks/artifacts 派生。

### 6.3 超时、重试和轮询

| 请求 | 超时 | 自动重试 | 规则 |
| --- | ---: | ---: | --- |
| `/health` | 3 秒 | 1 次 | 只用于连接与恢复探测 |
| GET read model | 8 秒 | 最多 2 次 | 250ms/1000ms 退避，仅网络/503 |
| POST `/ask` | 35 秒 | 0 次 | dispatch 后禁止自动重试 |
| 活动 Operation trace | 单次 8 秒 | 有界轮询 | 2s→4s→8s，最大 10s；终态或无容器停止 |

“5 秒恢复目标”表示 5 秒内必须显示 restored 或带原因的 blocked/recovering 结论，不表示外部 LLM 或长任务必须在 5 秒完成。

## 7. 权限、Host Bridge、CORS 与配置

### 7.1 Manifest

```text
requiredPermissions=sidePanel,tabs,storage
hostPermissions=[]
optionalHostPermissions=http://localhost:4000/*,http://127.0.0.1:4000/*
externallyConnectableMatches=http://localhost:3000/*,http://127.0.0.1:3000/*
allUrlsForbidden=true
contentScripts=[]
cookiePermission=false
extensionPagesCsp=script-src 'self'; object-src 'self'; connect-src http://localhost:4000 http://127.0.0.1:4000
```

3000 是 Host App 的消息来源，不是扩展网络访问目标，因此不得出现在 optional host permissions。用户拒绝授权时 API 请求数必须为 0，UI 保留连接说明和重试动作。

### 7.2 Host App bridge

`frontend/src/services/pxExternalBrainBridge.ts` 从 `VITE_FAMS_PX_EXTENSION_ID` 读取扩展 ID。未配置、ID 格式错误、扩展未安装或消息超时时，按钮仍可见，但显示普通话降级说明和配置步骤，不抛原始 `chrome.runtime.lastError`。

Host 只发送 `intent-route/3`，payload 允许 `workspaceId/sourceRef/operationId/reviewId/graphId`，禁止 question、截图、cookie、token、完整持仓或任意对象。Background 校验：

```text
sender.url origin ∈ {http://localhost:3000,http://127.0.0.1:3000}
sourceContainer=host_app
targetContainer=workspace_page
payload strict schema passed
secretLikeFieldCount=0
```

外部消息在 1 秒内返回 accepted/blocked ack。最终 tab 打开结果通过 correlationId 可追溯；Host 不直接写 WorkspaceState。

### 7.3 后端 origin 与本地身份

目标 External Brain route pre-handler 只接受 `Origin=chrome-extension://<id>` 且 `<id>` 位于 `FAMS_V2_PX_EXTENSION_IDS` 逗号分隔 allowlist。未配置 allowlist 时该 facade 返回 `PX_EXTENSION_ALLOWLIST_NOT_CONFIGURED`，不得默认接受任意扩展 origin。

现有全局 CORS `origin:true` 是当前仓库事实，不得被文档误写为生产安全。V2-PX 的 route-level origin policy 是新增目标；远程 origin、JWT、多用户和 Chrome Store 发布另立安全里程碑。

配置项：

| 位置 | 配置 | 允许值 |
| --- | --- | --- |
| Extension | `WXT_PUBLIC_FAMS_API_BASE` | 仅 `http://localhost:4000` 或 `http://127.0.0.1:4000` |
| Frontend | `VITE_FAMS_PX_EXTENSION_ID` | 32 位 `[a-p]` extension ID |
| Backend | `FAMS_V2_PX_EXTENSION_IDS` | 一个或多个 32 位 `[a-p]` ID |

这些都不是 secret；token、私钥和浏览器 profile 不得写入配置或 evidence。

## 8. 错误分类与用户动作

| Code | HTTP/来源 | UI 状态 | 用户可执行动作 |
| --- | --- | --- | --- |
| `PX_NOT_CONNECTED` | 本地权限未授权 | 未连接 | 连接、查看隐私说明 |
| `PX_PERMISSION_DENIED` | Chrome permission 拒绝 | blocked | 重新授权、保持只读离线索引 |
| `PX_EXTENSION_ALLOWLIST_NOT_CONFIGURED` | 503 | blocked | 按本地配置指南填 extension ID |
| `PX_FAMS_UNAVAILABLE` | 503/网络 | disconnected | 重试、保留最近任务索引 |
| `PX_RESOURCE_NOT_FOUND` | 404 | empty/blocked | 回来源库、保留失效 ref |
| `PX_SCHEMA_INVALID` | 400/422 | blocked | 返回入口、导出脱敏诊断 |
| `PX_ROUTE_CONFLICT` | 409 | blocked | 聚焦 canonical workspace、重新发起 |
| `PX_IDEMPOTENCY_CONFLICT` | 409 | blocked | 不自动重试，生成新的人类动作 |
| `PX_UNKNOWN_DISPATCH_RESULT` | timeout/reload | unknown_result | 查看 FAMS 任务/会话，不自动二次调用 |
| `PX_STORAGE_VERSION_UNSUPPORTED` | local state | blocked | 导出索引后清理，不静默迁移 |
| `PX_POLICY_BLOCKED` | 403 | blocked | 回 FAMS 处理需确认操作 |
| `PX_TRADE_ACTION_FORBIDDEN` | 403 | blocked | 无解锁动作；保持研究模式 |
| `PX_INTERNAL` | 500 | failed | 重试一次 GET 或导出脱敏诊断 |

任何用户文案都必须同时包含“发生什么、当前保留了什么、下一步是什么”，高级证据抽屉才显示 code/requestId。

## 9. 包、构建和依赖合同

Extension 是独立 npm package，不改造成仓库 workspace：

```text
package=packages/fams-v2-px-extension
packageManager=npm
nodeEngine=>=18（若选定 WXT 明确要求更高版本，PX-1 先回文档记录）
lockfile=packages/fams-v2-px-extension/package-lock.json required
build=npm --prefix packages/fams-v2-px-extension run build
output=packages/fams-v2-px-extension/.output/chrome-mv3
workspaceOutput=workspace.html
```

WXT、Playwright 和 schema validator 必须在 PX-1 选择可运行的明确版本并由 lockfile 固定；`package.json` 中 WXT/Playwright 不使用浮动 `latest`。精确版本属于 PX-1 可行性证据的一部分，不允许文档阶段凭空声称已兼容。

目标脚本归属：

```text
backend:  test:v2-px-api-contract, test:v2-px-policy
frontend: verify:v2-px-host-bridge
extension: test:contracts, test:px1-spike, test:workspace, test:sidepanel,
           test:router, test:lifecycle, verify:real-chrome, verify:acceptance
```

脚本在实际 package.json 和对应测试文件存在前全部是 `PLANNED_NOT_IMPLEMENTED`。

## 10. 实施与验收绑定

### 10.1 Evidence contract 目标版本

现有 evidence/acceptance schema 是 PX-0 结构基线，不足以单独证明最终 PRD 体验。目标迁移分两次完成：

| Target schema | 迁移阶段 | 相比 current 必须新增/收紧 |
| --- | --- | --- |
| `v2-px-dual-container-lifecycle/3` | PX-1 | eventId、单调 sequence、workspaceId、previous/next state、reasonCode、containerInstanceId、storageVersion、逐场景 derived result |
| `v2-px-real-chrome-evidence/2` | PX-1 | extensionVersion/buildDigest、headless/CDP mode、四个必需 viewport、manifest/CSP/permission audit、console/network/order request audit |
| `v2-px-acceptance-manifest/2` | PX-6 | target contract versions、逐阶段 manifest、真实命令/exit code、20 requirement 状态、G1～G7 唯一集合、人工状态引用 |
| `v2-px-acceptance-report/2` | PX-6 | AC-PX-01～10 结果/截图/备注、known blockers、外部审计结论、可声明/禁止声明分离 |

每次迁移必须同步 JSON schema、semantic validator、正负 fixtures、生成器和 consumer types。PX-1 只迁移 message/lifecycle/Chrome evidence；acceptance manifest/report 留在 PX-6，避免 feasibility spike 被错误要求产出最终候选报告。

`real-chrome-evidence/2` 的四视口必须恰好覆盖宽度 `{360,420,768,1280}`，不是 current v1 的“至少两个”。证据还必须记录 `unexpectedConsoleErrors=0`、`unexpectedFailedRequests=0`、`brokerOrderEndpointCalls=0`；这些不能只存在于 Markdown 自述。

### 10.2 合同—实现—测试绑定

| 合同面 | 实施实体 | 必须测试 | 关键负例 |
| --- | --- | --- | --- |
| intent-route/3 | `contracts/intentRoute.ts`、`intentRouter.ts` | 3×3 动作矩阵、五 intent | v2 冲突组合、额外字段、ask 含 question |
| operation-command/2 | `contracts/operationCommand.ts`、dispatch ledger | query/refresh/ingest、同 key 重放 | 同 key 不同 digest、Host 发 operation command |
| API v1 | `externalBrain.ts`、Read/Ask/Policy services | 五端点 DTO 与现有 FAMS 结果同源 | userId 注入、raw error、确认/订单调用 |
| WorkspaceState v1 | `workspaceStateStore.ts`、`lifecycleAuditStore.ts` | session/local/TTL/LRU/迁移 | 未知 major、silent clear、容器直写 |
| permission/bridge | `wxt.config.ts`、`ConnectionGate`、bridge | 3000/4000 边界、sender allowlist | all_urls、未授权请求、question 外部注入 |
| at-most-once | `idempotencyRegistry.ts` | prepared/dispatched/completed/reload | POST 自动重试、unknown 被写 success |
| evidence | collector + target lifecycle/Chrome/manifest/report | URL/ID/version/build/trace/hash/commit/四视口/人工场景 | mock URL、缺 hash、事件乱序、少视口、报告自称 |

原始验收证据固定输出到：

```text
.verification/private/v2-px/<commitSha>/<PX-stage>/
```

每阶段必须包含 `stage-manifest.json`，列出命令、退出码、开始/结束时间、Chrome/extension/build 版本、artifact hash 和失败归属。没有 manifest 的截图不得计入 gate。

## 11. 文档已决定与必须实测的边界

文档已经决定：产品体验、容器职责、动作矩阵、API/DTO、状态、存储、幂等、权限、身份范围、错误、阶段顺序和出门阈值。开发者不得自行替换。

以下不是文档缺口，只能在获批后的 PX-1/PX-2 用事实回答：

1. 选定 WXT/Chrome 版本在当前 Windows/WSL 环境是否真实支持 headless Side Panel。
2. optional host permission、extension origin 与当前 Fastify/CORS 组合是否按目标运行。
3. 真实 extension ID 的配置流程是否能被自动验收稳定复现。
4. 现有 FAMS 输出映射为五类 read model 时是否出现不可接受的性能或字段缺失。

任一实测失败都按计划回到 ADR/合同，不得通过扩大权限、复制业务数据、改变 intent 名称或使用 mock 来获得绿灯。

## 12. 当前许可边界

```text
documentationDecisionCompleteness=TARGET_SCOPE_COMPLETE
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
px1FeasibilitySpikeAllowed=false
productionSourceChangesAllowed=false
schemaValidatorChangesAllowed=false
```

本文完成只表示后续受控开发不再需要开发者替产品和架构做关键选择，不表示任何 target contract 已实现或真实 Chrome 已验证。
