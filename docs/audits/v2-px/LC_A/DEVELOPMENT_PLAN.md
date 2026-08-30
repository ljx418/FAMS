# V2-PX LC-A 合同重入开发计划

日期：2026-08-31

状态：`APPROVED_AND_IN_PROGRESS`

## 1. 目的

在不改写已经由真实 Chrome 验证的 Router/Command 主链前提下，为产品 PX5 增加独立生命周期端口，并消除运行时合同、生产类型、阶段状态和语义校验器之间的三处双真相。

## 2. 冻结决策

1. `v2-px-runtime-message/1` 继续使用 `messageType + routeId + correlationId + idempotencyKey + payload`，只承载 `intent_route|operation_command`。
2. 新增 `chrome.runtime.connect({name:'v2-px-lifecycle/1'})`，只承载 `state_subscribe|recover_request|container_close|state_snapshot|lifecycle_error`。
3. 生命周期端口首包必须是 `state_subscribe`；Host、来源不匹配、字段不完整、secret-like 字段均立即断开且零副作用。
4. 端口只由用户打开页面或真实生命周期事件驱动；禁止 heartbeat、alarm 或其他保活机制。
5. 未知 storage major 的唯一错误码为 `PX_STORAGE_VERSION_UNSUPPORTED`；原始 local bytes 必须保留。

## 3. 原子变更

- 校正 `V2_PX_API_RUNTIME_CONTRACT.md` 的版本 metadata 和 §4.1。
- 新增 lifecycle port JSON schema、正例和负例 fixture。
- 语义校验器交叉校验合同 metadata 与 `current-stage-state.json`，并拒绝旧通用 envelope。
- types、runtime error、tests 同批改为 `PX_STORAGE_VERSION_UNSUPPORTED`。
- 同步目标架构、追踪矩阵、产品计划、Draw.io 和阶段状态。

## 4. 禁止范围

本子阶段不实现恢复、lease、reconnect、polling、UI snapshot；不修改 backend 投资业务、frontend Host Bridge、Router/Command envelope 或交易锁。
