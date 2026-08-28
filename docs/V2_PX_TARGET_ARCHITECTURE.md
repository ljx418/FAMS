# V2-PX 目标架构与当前架构差异

更新时间：2026-08-27

## 1. 架构结论

V2-PX 采用 Route A.1：`独立 Workspace Page + 轻量 Side Panel + Background 单写者 + FAMS 有界查询/问答适配层`。该设计优先复用现有 FAMS 的 Chat、Daily Review、Operation 与 workflow 能力，不复制投资计算逻辑，不引入第二套业务数据库，也不改变交易锁。GET 类 intent 是只读查询；Quick Ask 可以写入现有 FAMS Chat 会话，但只允许 `read_only_direct/compute_quick_run`，不允许扩展自动确认操作。

```text
architectureReviewStatus=EXTERNAL_AUDIT_CONDITIONAL_PASS_REMEDIATION_APPLIED_PENDING_REAUDIT
implementationStatus=NOT_STARTED
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
routeAAdrStatus=ACCEPTED_FOR_SPIKE
productAuthorityStatus=FROZEN
routeAImplementationReadiness=DOCUMENTATION_EXTERNAL_AUDIT_CONDITIONAL_PASS_REMEDIATION_APPLIED_PENDING_REAUDIT
routeATechnicallyValidated=false
routeAProductionApproved=false
```

架构的 8 页中文可视化位于 `docs/v2-px-target-architecture-gap.drawio`，页级职责和防退化检查位于 `docs/V2_PX_DRAWIO_SUMMARY.md`；实现级 API、消息、状态、存储、错误与权限决策以 `docs/V2_PX_API_RUNTIME_CONTRACT.md` 为准。

状态图例：

- 绿色 `已开发/直接复用`：仓库中存在并已被当前 FAMS 使用。
- 黄色 `需修改`：实体已存在，但需要增加受控 PX 接入点。
- 橙色 `待新增`：仅在本文定义，代码当前不存在。
- 蓝色 `文档/证据`：合同或验收产物，不是生产功能。
- 红色 `硬边界`：禁止绕过的权限、数据或交易边界。
- 灰色 `不在本阶段`：未来生产化问题，本轮不实现。

## 2. 当前架构事实

### 2.1 已开发且可复用

| 分层 | 真实代码实体 | 当前责任 | V2-PX 复用方式 |
| --- | --- | --- | --- |
| FAMS Web Shell | `frontend/src/App.tsx`、`frontend/src/components/layout/AppLayout.tsx` | 页面路由、导航、ChatBox 宿主 | 增加受控“在外部大脑打开”入口，不重写整个 Shell |
| 对话体验 | `frontend/src/components/chat/FamsChatBox.tsx` | 普通话摘要、结构化结果、页面跳转 | 复用结果协议；Side Panel 不复制全部复杂视图 |
| 复盘体验 | `frontend/src/pages/DailyReviews.tsx` 与 `components/review/*` | 图表、决策摘要、DAG、审计抽屉 | Workspace 的 trace/graph 映射到其只读数据结构 |
| 任务体验 | `frontend/src/pages/Operations.tsx`、`OperationTimeline.tsx` | Operation 状态、产物、时间线 | Workspace 的 source/trace 读取同一 Operation 数据 |
| HTTP API | `backend/src/routes/chat.ts`、`dailyReview.ts`、`operation.ts` | Chat、复盘、Operation 接口 | 由目标有界 Query/Ask facade 编排，不直接复制服务逻辑 |
| 业务服务 | `famsChatService`、`dailyReviewService`、`operationService`、`dailyReviewWorkflowService` | 研究问答、复盘、任务、DAG | 继续作为单一业务事实来源 |
| 数据与审计 | Prisma Operation、Daily Review、artifactRefs | 持久业务结果与证据引用 | extension 只保存路由/恢复索引，不复制业务事实 |
| PX 合同 | `docs/schemas/v2-px-*.schema.json`、`backend/scripts/verify-v2-px-semantic-contract.ts` | PX-0 结构与语义防假绿 | 作为后续实现的合同门禁，不冒充运行能力 |

### 2.2 当前不存在

以下实体当前均为 `未开发`：

```text
packages/fams-v2-px-extension
WXT background entrypoint
Side Panel production UI
Workspace Page production UI
Background intent router
Workspace tab reuse manager
PX workspace state store
FAMS host app bridge
FAMS External Brain read facade
FAMS External Brain bounded Ask facade
intent-route/3 与 operation-command/2 runtime 绑定
真实 unpacked Chrome PX evidence
PX-1～PX-6 runtime acceptance commands
```

## 3. 方案选择与取舍

| 方案 | 优点 | 代价/风险 | 决策 |
| --- | --- | --- | --- |
| A.1 独立 extension Workspace + Side Panel + 可选本地权限 | 完整体验不受侧栏尺寸限制；三入口、恢复和审计可统一 | 需要明确本地 origin 授权、CORS 和状态单写者 | 选用，先 PX-1 验证 |
| B 只在 Side Panel 承载全部体验 | 开发较少 | 图表、DAG、来源和审计拥挤，直接重复当前 ChatBox 问题 | 拒绝 |
| C 只新增 FAMS Web Workspace，不做扩展 | 复用 React 最多，权限简单 | 无法实现浏览器轻入口和真实 extension 生命周期目标 | 拒绝 |
| D content script 大量注入 FAMS 页面 | 可以读取当前页面上下文 | 权限更大、与页面 DOM 强耦合、升级易破坏 | 不作为主路线 |

选择 A.1 放弃了一部分实现简洁性，换取可用的完整工作台、浏览器入口和可审计恢复。为控制权限风险，主机访问必须是用户主动授予的精确本地 origin，PX-1 不得使用 `<all_urls>`。

## 4. 目标分层与具体代码实体

### 4.1 浏览器容器层

| 状态 | 目标实体 | 责任 | 上下游 |
| --- | --- | --- | --- |
| 待新增 | `packages/fams-v2-px-extension/wxt.config.ts` | MV3 manifest、CSP、Side Panel、可选本地权限 | 输出 `.output/chrome-mv3` |
| 待新增 | `entrypoints/background.ts` | 唯一消息入口和状态写入者 | 接收三个入口；调用 router/store/adapter |
| 已实现 | `entrypoints/sidepanel/index.html`、`main.tsx`、`SidePanelApp.tsx` | 360/420 轻量入口、真实摘要、Quick Ask、最近任务 | 只向 background 发命令；PX4A Chrome 自动验收 PASS |
| 待新增 | `entrypoints/workspace/index.html`、`main.tsx` | 768/1280 完整工作台宿主 | 只向 background 发命令并订阅状态 |

### 4.2 PX Core 路由与状态层

| 状态 | 目标实体 | 责任 | 关键不变量 |
| --- | --- | --- | --- |
| 待新增 | `src/contracts/intentRoute.ts` | 绑定目标 `v2-px-intent-route/3` 类型和校验 | route 只导航；ask route 不携带 question |
| 待新增 | `src/contracts/operationCommand.ts` | 绑定目标 `v2-px-operation-command/2` | query/refresh/ingest；所有潜在副作用带 idempotencyKey |
| 待新增 | `src/contracts/runtimeMessage.ts`、`commandResult.ts`、`errors.ts` | 内部 envelope、结果与错误分类 | Host 外部消息只允许 intent route |
| 待新增 | `src/background/intentRouter.ts` | 规范化三入口、三动作、五 intent | 同语义产生相同 canonicalRouteKey |
| 待新增 | `src/background/workspaceTabManager.ts` | query/create/reuse/focus Workspace tab | 重复点击不创建重复标签页 |
| 待新增 | `src/background/idempotencyRegistry.ts` | local dispatch ledger、同 key 重放、冲突拒绝 | POST dispatch 后不自动重试；未知结果 blocked |
| 待新增 | `src/state/workspaceStateStore.ts` | session 状态、local 恢复索引 | background 单写；容器只订阅 |
| 待新增 | `src/state/lifecycleAuditStore.ts` | 绑定 lifecycle/3 封闭 eventType、previous/next state、sequence 与 reason | 汇总状态必须由事件推导；状态名不得临时充当事件名 |
| 待新增 | `src/state/workspaceStateMigrator.ts` | WorkspaceState 版本迁移与 TTL/LRU | 未知 major 不静默清空 |

### 4.3 UI 体验层

| 状态 | 目标实体 | 用户结果 |
| --- | --- | --- |
| 已实现 | `entrypoints/sidepanel/SidePanelApp.tsx` | 快速提问、最近任务、连接状态、打开/定位工作台；问题与回答只在 React memory |
| 待新增 | `src/sidepanel/ConnectionGate.tsx` | 解释权限用途并由用户主动连接本地 FAMS |
| 待新增 | `src/workspace/WorkspaceApp.tsx` | 完整 External Brain 页面框架 |
| 待新增 | `src/workspace/WorkspaceRouter.tsx` | 映射 source library/detail/ask/trace/graph |
| 待新增 | `src/workspace/views/SourceLibraryView.tsx` | 按时间和类型浏览研究证据 |
| 待新增 | `src/workspace/views/SourceDetailView.tsx` | 查看单个来源、时间、关联任务 |
| 待新增 | `src/workspace/views/AskView.tsx` | 显示简明摘要、关键依据、下一步和高级详情 |
| 待新增 | `src/workspace/views/TraceView.tsx` | 显示 Operation 时间线或复盘节点链 |
| 待新增 | `src/workspace/views/GraphView.tsx` | 显示复盘 DAG / evidence 关系，不计算新策略 |
| 待新增 | `src/workspace/components/RecoveryBanner.tsx` | 断连、恢复失败和重试说明 |
| 待新增 | `src/workspace/components/EvidenceDrawer.tsx` | 折叠展示 artifactRefs、route 与浏览器证据 |

### 4.4 FAMS 领域适配层

| 状态 | 目标实体 | 责任 | 复用实体 |
| --- | --- | --- | --- |
| 需修改 | `frontend/src/services/pxExternalBrainBridge.ts` | host app 向 extension 发受控 intent route | 读取 `VITE_FAMS_PX_EXTENSION_ID`；缺扩展时普通话降级；禁止 operation command |
| 需修改 | `frontend/src/components/external-brain/OpenInExternalBrainButton.tsx` | ChatBox/复盘/任务中心统一入口 | 传递 workspaceId/sourceRef/reviewId/operationId，不传原始账户数据 |
| 待新增 | `backend/src/routes/externalBrain.ts`、`externalBrainTypes.ts` | 五 intent 的有界 API 与 DTO | 注册在 `/api/v1/external-brain`；服务端固定 local user `default` |
| 待新增 | `backend/src/services/external-brain/externalBrainReadService.ts` | source/detail/trace/graph 统一 read model | 不创建第二份投资计算 |
| 待新增 | `backend/src/services/external-brain/externalBrainAskService.ts` | 将 Quick Ask 委托 `famsChatService` | 只允许 read/quick compute；不自动确认 |
| 待新增 | `backend/src/services/external-brain/externalBrainPolicyService.ts` | origin/本地用户/权限/交易策略 | 继续保持四项交易权限 false |
| 待新增 | `src/adapters/fams/FamsApiClient.ts` | background 唯一网络访问者 | 用户授权 origin、超时、退避、取消 |
| 待新增 | `src/adapters/fams/FamsDomainAdapter.ts` | PX core query/ask 到 FAMS API 映射 | PX core 不出现交易域字段 |

首期有界 API 计划：

```text
GET  /api/v1/external-brain/sources
GET  /api/v1/external-brain/sources/:sourceRef
POST /api/v1/external-brain/ask
GET  /api/v1/external-brain/traces/:operationId
GET  /api/v1/external-brain/graphs/:scope/:id
```

请求/响应 DTO、分页、错误、身份、超时和重试规则见 `V2_PX_API_RUNTIME_CONTRACT.md`。这些是计划实体，当前不存在。PX-1 可只使用 `/health` 完成连接可行性验证，不得提前把完整 API 写成已通过。

### 4.5 验收与证据层

| 状态 | 目标实体 | 责任 |
| --- | --- | --- |
| 已开发 | `backend/scripts/verify-v2-px-semantic-contract.ts` | PX-0 current schema/语义正反例；不代表 target 版本已验证 |
| 待修改 | lifecycle/2→3、Chrome evidence/1→2 | PX-1 增加 sequence/state/reason、四视口、manifest/network/console |
| 待修改 | acceptance manifest/report/1→2 | PX-6 增加 20 requirements、AC01～10、stage manifests 和人工证据 |
| 待新增 | `packages/fams-v2-px-extension/tests/intent-route.spec.ts` | 三入口和五 intent 路由 |
| 待新增 | `tests/workspace-host.spec.ts` | 独立宿主、视口、刷新恢复 |
| 已实现 | `tests/sidepanel.test.ts`、`scripts/verify-sidepanel-chrome.mjs` | 360/420 Side Panel 单元与真实 Chrome/DB/API/LLM 证据 |
| 待新增 | `tests/tab-idempotency.spec.ts` | 多窗口复用和重复点击 |
| 待新增 | `tests/lifecycle-recovery.spec.ts` | 断连、reload、reconnect、close |
| 待新增 | `scripts/collect-real-chrome-evidence.mjs` | Playwright + Chrome CDP 真实证据 |
| 待新增 | `.verification/private/v2-px/**` | 本地私有截图、trace、事件和哈希 |

## 5. 关键交互关系

### 5.1 Side Panel 快速提问

```text
用户
 -> SidePanelApp
 -> background.ts
 -> operation-command/2 query（schema + policy + dispatch ledger）
 -> FamsDomainAdapter
 -> externalBrainAskService
 -> famsChatService / operationService
 -> background workspaceStateStore
 -> SidePanelApp（简明摘要）
```

### 5.2 打开或复用完整工作台

```text
SidePanel / FAMS host app
 -> background intentRouter
 -> workspaceTabManager
 -> tabs.query(canonical workspace URL + workspaceId)
 -> 已存在：tabs.update 聚焦
 -> 不存在：tabs.create
 -> WorkspaceApp 订阅 background 状态
```

### 5.3 刷新和恢复

```text
Workspace Refresh
 -> WorkspaceApp start
 -> background 读取 storage.session
 -> 缺失时读取 storage.local 最小索引
 -> FamsApiClient 重取服务器业务事实
 -> 成功：resume event + 恢复视图
 -> 失败：blocked event + RecoveryBanner，不显示成功态
```

## 6. 状态与数据所有权

| 数据 | 权威所有者 | 存储位置 | 禁止事项 |
| --- | --- | --- | --- |
| 持仓、复盘、Operation、artifact | FAMS 后端 | Prisma / artifact store | extension 不复制为业务事实 |
| route/correlation/live container | PX background | `chrome.storage.session`，最多 20 workspace | Side Panel/Workspace 不直接写 |
| workspace 最小恢复索引 | PX background | `chrome.storage.local`，最多 20 条/30 天 | 不保存问题、回答、原始账户截图、cookie、token |
| idempotency dispatch ledger | PX background | `chrome.storage.local`，最多 500 条/24 小时 | 只存 digest/state/resultRef；不存 payload 原文 |
| 当前容器视图 | 各容器本地 | React memory | 不作为审计真相 |
| lifecycle audit | PX background | session + 验收导出 | 汇总状态不得脱离事件自报 |
| Chrome 证据 | acceptance collector | `.verification/private/v2-px` | 不提交隐私和浏览器 profile |

background 是 PX 状态单写者，也是唯一 FAMS 网络访问者。容器不直接轮询后端。仅 background 在存在活动任务时按 2s→4s→8s、最大 10s 做有界轮询，终态停止、容器全部关闭时停止。GET 最多有限重试；POST Ask dispatch 后自动重试次数恒为 0。

用户可见状态与实现状态使用下列唯一映射；UI 不得直接显示内部枚举，`closed` 没有活动容器，因此不可伪造一个仍可操作的页面：

| 用户可见状态 | `WorkspaceState.lifecycleStatus` | 用户必须看到 | 允许动作 |
| --- | --- | --- | --- |
| 未连接 | `uninitialized`、`disconnected` | 未连接或连接已断开、保留的 workspace 标识 | 连接、重试、查看隐私说明 |
| 加载 | `connecting`、`loading` | 正在连接/读取什么，不能只显示无限 spinner | 取消、等待 |
| 正常 | `ready` | 简明摘要、数据时间、下一步 | 查看、切换、刷新只读数据 |
| 空 | `empty` | 为空原因和可获得数据的 FAMS 入口 | 回来源库、打开对应 FAMS 页面 |
| 失败 | `failed` | 可读原因、已保留内容、重试边界 | 重试 GET 或导出脱敏诊断 |
| 恢复中 | `recovering` | 恢复对象、当前步骤、5 秒状态结论门槛 | 取消恢复、等待结论 |
| 已阻断 | `blocked` | 阻断原因、证据和解除条件；不得显示 success | 人工配置/复核；交易阻断无解锁动作 |
| 不渲染 | `closed` | 无活动容器；下次打开先进入 connecting/recovering 再渲染 | 无 |

目标 lifecycle/3 的 eventType 集合以运行时合同 §5.4 为唯一来源。`connection_lost -> disconnected`、`reconnect -> recovering`、`connected -> ready`、`lease_expired/close -> closed` 等状态转换必须同时保留 previous/next state 与 reasonCode。

local 写入依赖顺序为：dispatch ledger 清理/写入/回读 → recoveryIndex 清理/写入/回读 → session event/WorkspaceState。后台结果已发生但 `completed` 无法持久化时必须进入 `unknown_result` 并提示“结果已收到但未保存”，不得自动重发或谎称 `failed_before_effect`。

## 7. 权限、安全与交易边界

### 7.1 本地权限

```text
requiredPermissions=sidePanel,tabs,storage
hostPermissions=[]
optionalHostPermissions=
  http://localhost:4000/*
  http://127.0.0.1:4000/*
externallyConnectableMatches=
  http://localhost:3000/*
  http://127.0.0.1:3000/*
permissionGrantTrigger=用户点击“连接本地 FAMS”
allUrlsForbidden=true
remoteExecutableCodeAllowed=false
```

“hostPermissions 为空”指安装时不默认获得主机访问权；运行时只允许用户主动授予 manifest 中列出的精确后端地址。3000 只允许向扩展发送受控 intent route，不授予扩展访问前端页面内容的权限。External Brain Background 每次请求必须发送公开的 `X-FAMS-Extension-Id=browser.runtime.id`；route pre-handler 以 `FAMS_V2_PX_EXTENSION_IDS` 验证该 ID。若存在 Origin，只允许与 header 同 ID 的 `chrome-extension://` Origin；任何 Web Origin 即使伪造 header 也拒绝。现有全局 CORS 不能冒充该 route policy 已实现。

PX2-01/PX3 重入先启用 deny-by-default route pre-handler，并完成“无 Origin+正确 header”和“匹配 extension Origin+header”正例，以及缺失/错误 header、Web Origin+伪造 header、Origin/header 不一致、缺 allowlist负例。全局 CORS 继续收紧到 FAMS 本地 Web origin 与配置的 extension origin；切换与重入证据分别记录到 `PX2/cors-switch-audit.json` 和 `PX3/`。失败必须停在 PX3，不能让缺 Origin默认放行成为旁路。

### 7.2 身份边界

PX-1～PX-3 仅验证本地单用户连接和路由，不把公开 extension ID header、当前默认 JWT secret 或 query userId 当作生产身份安全能力。生产多用户身份、本机恶意进程防护、Chrome Web Store 发布和远程 origin 必须另立里程碑并重新安全评审。

### 7.3 交易边界

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
brokerOrderEndpointCalls=0
```

PX Core schema 保持领域无关；FAMS adapter 只能返回研究、观察、比较、提醒和人工计划草案能力。

## 8. 故障模式与降级

| 故障 | 用户可见行为 | 系统行为 | 验收归属 |
| --- | --- | --- | --- |
| 未授权本地 origin | 显示连接说明和授权按钮 | 不发 API 请求 | PX-1/PX-3 |
| FAMS 未启动 | 显示“本地 FAMS 未连接”与重试 | 退避，不清空上次最小索引 | PX-1/PX-5 |
| schema 不合法 | 显示无法打开该任务 | 记录 blocked，拒绝路由 | PX-4 |
| 重复点击 | 聚焦既有工作台 | 同 key 去重 | PX-4 |
| 同 key 不同 payload | 显示冲突提示 | 拒绝并审计 | PX-4 |
| extension reload | 显示正在恢复 | 重新订阅并重取业务事实 | PX-5 |
| artifact 已删除 | 显示来源不可用 | 保留 sourceRef 和失败证据 | PX-5 |
| 任何交易动作请求 | 显示永久禁止 | policy hard fail，不调用订单端点 | 全阶段 |

## 9. 架构风险判断

| 风险 | 可能性 | 影响 | 文档级缓解 | 实现前验证 |
| --- | --- | --- | --- | --- |
| WXT Side Panel 的 headless 自动化能力不足 | 中 | 高 | PX-1 只做可行性 spike | 必须用 unpacked Chrome + CDP 证明 |
| optional host permission / CORS 不兼容 | 中 | 高 | 4000 精确 host；3000 external connect；只读 `/health` 起步 | PX-1 连接场景 hard gate |
| 三入口状态漂移 | 中 | 高 | background 单写者、统一 envelope | 三入口同任务 route matrix 100% |
| 当前 FAMS API 粒度不适合五 intent | 高 | 中 | 有界 Query/Ask facade，不复制业务服务；缺字段先修 facade mapping | PX-2 contract test；仍不满足则回运行时 API 合同/ADR，缩小 read model，禁止改 intent 或用 mock |
| 当前 v2/v1 schema 与目标动作/问答语义不一致 | 高 | 高 | 目标 v3/v2 已在运行时合同冻结 | PX-1 原子迁移 schema/validator/fixtures/types |
| current evidence schema 允许结构通过但不足以证明完整体验 | 高 | 高 | target lifecycle/3、Chrome evidence/2、acceptance/2 字段已冻结 | PX-1/PX-6 分批原子迁移全部 producers/consumers |
| Workspace 复制现有复杂页面 | 中 | 中 | 只复用 read model 与小型 UI 组件 | 原型和四视口人工检查 |
| 本地单用户被误写为生产安全 | 中 | 高 | PRD 明确非目标和状态字段 | PX-6 文案与 manifest 扫描 |

## 10. 实现许可边界

用户已于 2026-08-28 明确批准在本文边界内顺序实施 PX1～PX6。批准允许创建 `packages/fams-v2-px-extension`、新增有界 `externalBrain.ts`、修改指定 Host Bridge 集成点并运行真实扩展验收；仍不等于 `TECHNICALLY_VALIDATED`、正式发布或交易解锁。每阶段必须先通过独立入场审计，PX6 最终人工体验验收仍保留。
