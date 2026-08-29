# V2-PX PX5 Router/at-most-once 详细开发计划

日期：2026-08-29

状态：ENTRY_AUDIT_PASSED_READY_FOR_IMPLEMENTATION

## 1. 用户完成后能看到的效果

1. 从 Side Panel、完整 Workspace 或 FAMS 页面重复进入同一任务时，只保留并聚焦一个完整工作台标签。
2. 快速问答即使发生双击、并发消息、worker reload、超时或 storage 故障，也不会自动发送第二次 POST。
3. 能确定未发出时明确允许人类重新提交；请求可能已发出时只显示 `unknown_result` 并要求到 FAMS 复核。
4. URL 只出现 workspace/view/ref，不出现问题、回答、route/correlation、token 或业务对象正文。
5. 所有页面继续保持研究模式、人工计划措辞和订单能力关闭。

## 2. 实施顺序

### PX5-1 Router 与 canonical identity

先补失败用例，再修改：

- `src/background/intentRouter.ts`
  - 按合同稳定 JSON 生成 SHA-256 canonicalRouteKey；
  - daily-review graph 把 graphId 规范为 reviewId，operation graph 规范为 operationId；
  - key 排除 routeId/correlationId/idempotencyKey/question/time/UI 状态；
  - Workspace URL 只生成 workspaceId/view/ref；ref 对 source_detail/trace/graph/ask 使用受控 opaque ID。
- `tests/router.test.ts`
  - 3×3 target 逐项验证；
  - 五 intent 的 canonical 输入/输出；
  - 相同业务语义跨新 routeId/correlation 得到同 key；
  - 不同业务实体不得碰撞；URL 精确字段负例。

### PX5-2 单 tab 串行、并发与多窗口收敛

- `src/background/workspaceTabManager.ts`
  - 以 extension origin + workspace.html + workspaceId 为身份；
  - 同一 storage/browser API 内按 workspace 串行 query/create/update；
  - 多个历史匹配 tab 时保留一个并关闭其余，聚焦保留 tab 所在窗口；
  - view/ref 更新只更新现有 tab。
- `tests/router.test.ts`
  - 20 次串行、20 次 `Promise.all`、两个窗口已有重复 tab 三类用例均断言 tab=1；
  - 不同 workspace 不互相合并。

### PX5-3 at-most-once ledger 强化

- `src/state/idempotencyRegistry.ts`
  - 对同一 `LedgerStorage` 的 cleanup/read/write/dispatch 排队，关闭并发空读竞态；
  - 保持 prepared→回读→dispatched→回读→一次网络→completed→完整回读；
  - completed 完整核对 payloadDigest/state/resultStatus/resultRef/关键时间；
  - 同 key/同 digest replay；不同 digest blocked；dispatched/reload/timeout 恒 unknown；POST 自动重试=0；
  - 500 条/24 小时 cleanup 与 LRU 在队列内执行。
- `tests/idempotency.test.ts`
  - 并发 20 次同 key dispatch=1；
  - prepared/dispatched write 与 readback 失败均 dispatch=0；
  - 网络响应丢失 + reload dispatch=1；
  - completed write/readback/resultRef 漂移均 unknown；
  - 过期清理、501→500 LRU、冲突、blocked replay。

### PX5-4 recoveryIndex 与 Background 单写顺序

- `src/background/chromeStorage.ts`
  - 新增 `recoveryIndex` 的读、清理、写、回读；20 条/30 天；
  - 只保存 workspaceId/currentView/selectedRef/conversationId/operationId/updatedAt/schemaVersion/expiresAt；
  - 禁止 question、answer、cookie、token、Authorization、账户原图；
  - dispatchLedger 与 recoveryIndex 独立清理。
- `src/background/runtimeHandler.ts`
  - query 的 ledger completed/replay 后再写 recoveryIndex，最后写 lifecycle/session；
  - storage fault 显式映射 `storage_write_failed` / `dispatch_result_unknown`；
  - 任何结果后持久化失败都不自动重发、不冒充 failed-before-effect。
- `tests/storage.test.ts` 与必要的 runtime handler 测试
  - 验证固定写序、回读失败、未知版本阻断、20/30d 上限、正文不落盘。

### PX5-5 真实 Chrome/SQLite/生产路由验收器

- 新增 `scripts/verify-router-idempotency-chrome.mjs` 与 package script；
- 使用 production WXT build、真实 Windows Chrome headless CDP、真实 SQLite 和 production External Brain route handler；
- 实际发送 3×3 路由，执行 20 次串行/并发/多窗口 open，执行真实 Ask 同 key replay 与 worker reload；
- 采集 route/correlation/canonical/tab/storage/lifecycle/network/console/DB 差分和截图/trace；
- 负例覆盖 injected storage fault、同 key 不同 digest、Host command、ask route question、未知 dispatch；
- 专属 3000/4000 端口启动与 PID 归属校验，禁止复用不明服务形成假绿。

## 3. 允许修改范围

- `packages/fams-v2-px-extension/src/background/{intentRouter,workspaceTabManager,runtimeHandler,chromeStorage}.ts`
- `packages/fams-v2-px-extension/src/state/idempotencyRegistry.ts`
- `packages/fams-v2-px-extension/tests/{router,idempotency,storage,runtime-handler}.test.ts`
- `packages/fams-v2-px-extension/scripts/verify-router-idempotency-chrome.mjs`
- `packages/fams-v2-px-extension/package.json`
- 本阶段 V2-PX 审计、状态、追踪和架构文档。

若需要修改后端 Ask 业务服务、FAMS Chat 计算、数据库 schema、交易模块或权限范围，立即停止并重新做规格审查。

## 4. 每步回退与停止规则

- canonical key/URL 无法同时满足合同与现有页面恢复：停止，回 API runtime contract 评审。
- 同 key 并发在真实 Chrome 中出现 POST>1：本阶段失败，不进入生命周期阶段。
- 为消除重复而需要远程锁、第二数据库或后端业务复制：停止，找用户确认范围扩大。
- storage fault 后 UI/证据出现 success 或“可安全重试”假象：hard fail。
- 任何 broker/order 请求、Transaction/GridOrderDraft/ExternalOrderObservation 变化或四锁为 true：hard fail。
