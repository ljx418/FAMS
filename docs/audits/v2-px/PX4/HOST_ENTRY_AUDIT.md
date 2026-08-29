# V2-PX PX4-B Host Bridge 入场审计

日期：2026-08-29

结论：PASS_FOR_CONTROLLED_IMPLEMENTATION

## 审计范围

本子阶段只实现 FAMS Host App 到 External Brain Workspace 的受控导航桥：ChatBox、每日持仓复盘、任务中心各增加一个始终可见的入口。Host 只发送 `v2-px-intent-route/3`，不发送问题、完整业务对象或 `operation-command/2`，不直接读写 WorkspaceState，也不改变交易能力。

## 当前事实与规格闭环

| 项目 | 当前事实 | 入场判断 |
| --- | --- | --- |
| Extension 外部消息边界 | `wxt.config.ts` 只允许 `localhost:3000`、`127.0.0.1:3000`；Background 先校验 sender origin，再校验严格 runtime/route schema | 可直接复用；禁止扩大 origin 或 permission |
| 路由合同 | `intent-route/3` 已实现 Host `view_source/open_workspace/open_in_workspace -> workspace_page`；Ask route 明确禁止 question | Host 只需构造与扩展同口径的 public DTO |
| Workspace tab 复用 | PX3 真实 Chrome 已证明同一 workspace 只创建或聚焦一个 Workspace tab | 三入口必须共用固定默认 workspaceId |
| 数据实体 | Daily Review 和 Operation 页面均持有真实 UUID v4；ChatBox 不需要传会话正文 | 分别映射 `graph`、`trace`、`ask` |
| 缺扩展降级 | 运行时合同 §7.2 要求按钮仍可见，显示中文配置/恢复步骤，不透出 `runtime.lastError` | 必须作为独立负例验收 |
| 共享工作区 | 三个集成文件当前 clean；`frontend/package.json` 含其他 Agent 未提交的夜间策略脚本 | 只允许窄化暂存本阶段脚本行，不得覆盖或提交他人改动 |
| fatal/major 审计意见 | 0 | 允许进入受控实现 |

## 冻结路由映射

| Host 场景 | entryAction | routeIntent | 严格 payload | 用户看到的结果 |
| --- | --- | --- | --- | --- |
| ChatBox | `open_workspace` | `ask` | `{ workspaceId }` | 打开/聚焦同一 Workspace 的提问视图；不复制 ChatBox 问题 |
| 每日复盘 | `open_in_workspace` | `graph` | `{ workspaceId, graphScope:'daily-review', graphId: reviewId }` | 在 Workspace 定位真实复盘关系图 |
| 任务中心 | `open_in_workspace` | `trace` | `{ workspaceId, operationId }` | 在 Workspace 定位真实任务追踪 |

默认 workspaceId 冻结为 `px-ws-00000000-0000-4000-8000-000000000001`。每次点击生成新的 routeId/correlationId/idempotencyKey；同 workspace 只聚焦一个 tab。

## 不得越界

- 不把 question、answer、截图、cookie、token、持仓明细、完整 Review/Operation 或任意对象放入 Host 消息。
- 不从 Host 直接访问 4000 External Brain API；不写 `chrome.storage`。
- 不发送 `operation_command`，不新增订单、券商、自动交易或交易解锁入口。
- 不将“按钮渲染”“页面打开”或 mock state 冒充路由合同与真实实体匹配通过。
- 不修改 3000 origin allowlist、Extension required/optional host permissions 或方案 A caller 身份策略。

## 停止条件

出现下列任一情况必须停止实现并回到计划/找人确认：真实 Chrome 不向 Host 页面暴露 externally-connectable messaging；路由必须携带问题或完整业务对象才能工作；现有 UUID 不满足冻结合同且不能只读映射；需要扩大 origin/权限；交易相关数据库或请求出现变化；fatal/major 规格偏差或虚假验收风险大于 0。

## 入场决定

当前文档、合同、实现基座和真实验收路径能够完整支撑 PX4-B。允许严格按 `HOST_DEVELOPMENT_PLAN.md` 开始；出门声明上限为 `hostBridgeAutomatedAccepted=true`，不得提前声明 PX5/PX6、最终人工体验或交易能力完成。
