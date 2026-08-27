# V2-PX 目标架构与当前架构差异

更新时间：2026-08-27

## 1. 架构结论

V2-PX 采用 Route A.1：`独立 Workspace Page + 轻量 Side Panel + Background 单写者 + FAMS 只读领域适配层`。该设计优先复用现有 FAMS 的 Chat、Daily Review、Operation 与 workflow 能力，不复制投资计算逻辑，不引入第二套业务数据库，也不改变交易锁。

```text
architectureReviewStatus=DOCUMENTATION_READY_FOR_HUMAN_REVIEW
implementationStatus=NOT_STARTED
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
routeAStatus=ACCEPTED_FOR_SPIKE
routeAImplementationReadiness=DOCUMENTATION_REDESIGNED_AWAITING_USER_APPROVAL
routeATechnicallyValidated=false
routeAProductionApproved=false
```

架构的 8 页中文可视化位于 `docs/v2-px-target-architecture-gap.drawio`，页级职责和防退化检查位于 `docs/V2_PX_DRAWIO_SUMMARY.md`。

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
| HTTP API | `backend/src/routes/chat.ts`、`dailyReview.ts`、`operation.ts` | Chat、复盘、Operation 接口 | 由目标只读聚合层编排，不直接复制服务逻辑 |
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
| 待新增 | `entrypoints/sidepanel/index.html`、`main.tsx` | 360/420 轻量入口 | 只向 background 发命令并订阅状态 |
| 待新增 | `entrypoints/workspace/index.html`、`main.tsx` | 768/1280 完整工作台宿主 | 只向 background 发命令并订阅状态 |

### 4.2 PX Core 路由与状态层

| 状态 | 目标实体 | 责任 | 关键不变量 |
| --- | --- | --- | --- |
| 待新增 | `src/contracts/intentRoute.ts` | 绑定 `v2-px-intent-route/2` 类型和校验 | 不允许额外字段或 secret-like 字段 |
| 待新增 | `src/contracts/operationCommand.ts` | 绑定 operation command | 所有写动作必须带 idempotencyKey |
| 待新增 | `src/background/intentRouter.ts` | 规范化三入口、三动作、五 intent | 同语义产生相同 canonicalRouteKey |
| 待新增 | `src/background/workspaceTabManager.ts` | query/create/reuse/focus Workspace tab | 重复点击不创建重复标签页 |
| 待新增 | `src/background/idempotencyRegistry.ts` | 同 key 去重、冲突拒绝 | 同 key 不同 payload 必须 blocked |
| 待新增 | `src/state/workspaceStateStore.ts` | session 状态、local 恢复索引 | background 单写；容器只订阅 |
| 待新增 | `src/state/lifecycleAuditStore.ts` | start/resume/reconnect/close/blocked 事件 | 汇总状态必须由事件推导 |

### 4.3 UI 体验层

| 状态 | 目标实体 | 用户结果 |
| --- | --- | --- |
| 待新增 | `src/sidepanel/SidePanelApp.tsx` | 快速提问、最近任务、连接状态、打开工作台 |
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
| 需修改 | `frontend/src/services/pxExternalBrainBridge.ts` | host app 向 extension 发受控 route command | `chrome.runtime.sendMessage(extensionId, ...)`，缺扩展时降级 |
| 需修改 | `frontend/src/components/external-brain/OpenInExternalBrainButton.tsx` | ChatBox/复盘/任务中心统一入口 | 传递 workspaceId/sourceId/operationId，不传原始账户数据 |
| 待新增 | `backend/src/routes/externalBrain.ts` | 五 intent 的只读聚合 API | 注册在 `/api/v1/external-brain` |
| 待新增 | `backend/src/services/external-brain/externalBrainReadService.ts` | 把现有 Chat/Review/Operation 输出转换为统一 read model | 不创建第二份投资计算 |
| 待新增 | `backend/src/services/external-brain/externalBrainPolicyService.ts` | 只读/计算/确认/永久禁止策略 | 继续保持四项交易权限 false |
| 待新增 | `src/adapters/fams/FamsApiClient.ts` | background 唯一网络访问者 | 用户授权 origin、超时、退避、取消 |
| 待新增 | `src/adapters/fams/FamsDomainAdapter.ts` | PX core intent 到 FAMS read API 映射 | PX core 不出现交易域字段 |

首期只读聚合 API 计划：

```text
GET  /api/v1/external-brain/sources
GET  /api/v1/external-brain/sources/:sourceRef
POST /api/v1/external-brain/ask
GET  /api/v1/external-brain/traces/:operationId
GET  /api/v1/external-brain/graphs/:scope/:id
```

这些是计划实体，当前不存在。PX-1 可只使用 `/health` 完成连接可行性验证，不得提前实现完整 API。

### 4.5 验收与证据层

| 状态 | 目标实体 | 责任 |
| --- | --- | --- |
| 已开发 | `backend/scripts/verify-v2-px-semantic-contract.ts` | PX-0 schema/语义正反例 |
| 待新增 | `packages/fams-v2-px-extension/tests/intent-route.spec.ts` | 三入口和五 intent 路由 |
| 待新增 | `tests/workspace-host.spec.ts` | 独立宿主、视口、刷新恢复 |
| 待新增 | `tests/sidepanel-entry.spec.ts` | 360/420 Side Panel |
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
 -> intentRouter（schema + policy + idempotency）
 -> FamsDomainAdapter
 -> externalBrainReadService
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
| route/correlation/idempotency | PX background | `chrome.storage.session` | Side Panel/Workspace 不直接写 |
| workspace 最小恢复索引 | PX background | `chrome.storage.local` | 不保存原始账户截图、cookie、token |
| 当前容器视图 | 各容器本地 | React memory | 不作为审计真相 |
| lifecycle audit | PX background | session + 验收导出 | 汇总状态不得脱离事件自报 |
| Chrome 证据 | acceptance collector | `.verification/private/v2-px` | 不提交隐私和浏览器 profile |

background 是 PX 状态单写者，也是唯一 FAMS 网络访问者。容器不直接轮询后端。仅 background 在存在活动任务时做有界轮询：初始 2 秒、失败指数退避、终态停止、容器全部关闭时停止。

## 7. 权限、安全与交易边界

### 7.1 本地权限

```text
requiredPermissions=sidePanel,tabs,storage
hostPermissions=[]
optionalHostPermissions=
  http://localhost:3000/*
  http://127.0.0.1:3000/*
  http://localhost:4000/*
  http://127.0.0.1:4000/*
permissionGrantTrigger=用户点击“连接本地 FAMS”
allUrlsForbidden=true
remoteExecutableCodeAllowed=false
```

“hostPermissions 为空”指安装时不默认获得主机访问权；运行时只允许用户主动授予 manifest 中列出的精确本地地址。

### 7.2 身份边界

PX-1 仅验证本地单用户连接和路由，不把当前默认 JWT secret 或 query userId 当作生产安全能力。生产多用户身份、Chrome Web Store 发布和远程 origin 必须另立里程碑并重新安全评审。

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
| optional host permission / CORS 不兼容 | 中 | 高 | 精确 origin、用户触发、只读 `/health` 起步 | PX-1 连接场景 hard gate |
| 三入口状态漂移 | 中 | 高 | background 单写者、统一 envelope | 三入口同任务 route matrix 100% |
| 当前 FAMS API 粒度不适合五 intent | 高 | 中 | 只读聚合 facade，不复制业务服务 | PX-2/PX-4 contract test |
| Workspace 复制现有复杂页面 | 中 | 中 | 只复用 read model 与小型 UI 组件 | 原型和四视口人工检查 |
| 本地单用户被误写为生产安全 | 中 | 高 | PRD 明确非目标和状态字段 | PX-6 文案与 manifest 扫描 |

## 10. 实现许可边界

本文完成后只能声明架构文档已具备受控开发支撑。没有用户新的明确批准，不得创建 `packages/fams-v2-px-extension`、不得新增 `externalBrain.ts`、不得修改 `App.tsx/FamsChatBox.tsx`，也不得运行 PX-1 真实扩展 spike。
