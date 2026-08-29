# V2-PX PX6 生命周期/恢复入场审计

日期：2026-08-29

阶段映射：自动化子阶段 `PX6` = 产品计划 `PX5-01 恢复与迁移 + PX5-02 中断生命周期`；产品最终汇总仍是产品 PX6，不在本子阶段。

审计结论：`STOP_REQUIRED_MAJOR_RUNTIME_CONTRACT_DRIFT`

生产代码准入：`FORBIDDEN_PENDING_HUMAN_DECISION`

## 1. 已确认的可复用基座

- lifecycle/3 schema、封闭 eventType、`appendLifecycleEvent/deriveLifecycleState` 已存在，当前窄基线 2 files/14 tests 通过。
- `WorkspaceStateV1`、session events/states、local dispatch ledger、20 条/30 天 recoveryIndex 已存在。
- 产品 PX4 已证明 Background 对 route/load/query 的 workspace 单写队列、固定 ledger→recoveryIndex→session 顺序和 service-worker restart 下 at-most-once。
- Workspace 已有 recovering/blocked 中文状态壳；FAMS GET 与 `/health` 已具有限时/有限重试能力。

上述基座只证明“能记录部分状态”，不能证明 Back/Forward/Refresh、关闭重开、断连重连、update/migration、lease/polling 已实现。

## 2. 必须先闭环的重大规格问题

| 编号 | 权威文档/当前代码事实 | 风险 | 状态 |
| --- | --- | --- | --- |
| MJR-LC-01 | `V2_PX_API_RUNTIME_CONTRACT.md` §4.1 冻结 `messageId + kind`，并含 `state_subscribe/state_snapshot/command_result`；生产 `RuntimeMessage` 实际是 `routeId/correlationId/idempotencyKey + messageType`，仅支持 intent/command | 生命周期阶段必须增加状态握手；若直接在任一版本上开发，会让合同、validator、Host、已签证据出现双真相 | OPEN，需人类选择 LC-A/LC-B |
| MJR-LC-02 | 权威合同 §5.4/§8 使用 `PX_STORAGE_VERSION_UNSUPPORTED`；生产类型和 runtime 返回 `PX_STORAGE_VERSION_BLOCKED` | 未知 major 的用户状态、事件 reason 和负例无法按同一错误码验收 | OPEN，随合同重入选择统一 |
| MJR-LC-03 | 运行时合同页首仍自报 target v3/v2 “planned_not_implemented”、`runtimeContractImplemented=false`，但 current state 与生产代码已声明 target runtime implemented | 自动化可同时接受互斥阶段状态；本轮 semantic validator 仍返回 PASS，说明它没有覆盖该内联 metadata/envelope 漂移 | OPEN，合同重入时更正 metadata 并给 semantic validator 增加跨文档断言 |

致命问题：0。未闭环重大问题：3。依据用户规则，未清零前不得编写生产代码。

## 3. 已定位的计划内实现缺口

| 编号 | 当前事实 | 产品 PX5 目标/出门要求 |
| --- | --- | --- |
| GAP-LC-01 | `refresh_index` 在 session state 缺失时，Workspace 来源直接 blocked；不会从 local recoveryIndex 重建 | 浏览器新会话、关闭重开、session 丢失后按最小索引恢复并重取真实 FAMS 事实 |
| GAP-LC-02 | recoveryIndex 只在写入时清过期；Background 启动不清 recoveryIndex/ledger | 启动与每次写入均执行独立 TTL/LRU，未知版本 blocked、不静默清空 |
| GAP-LC-03 | 没有 container register/lease/close 协议，`containerLeases` 始终为空 | Side Panel/Workspace 打开、关闭、崩溃可推导；最后容器关闭后进入 closed 并停止轮询 |
| GAP-LC-04 | API 失败只写 `load_failed`；没有生产 `connection_lost→reconnect→connected/blocked` 路径 | FAMS 断连/恢复 5 秒内显示 recovering 或 blocked，事件链 100% 可推导 |
| GAP-LC-05 | UI 仅按命令 response 自行映射状态，没有 Background snapshot/subscription | UI 展示必须与 Background 权威 WorkspaceState/事件一致，不能自报 restored |
| GAP-LC-06 | `onInstalled` 只设置 Side Panel；没有 startup/update migration coordinator | service-worker restart、extension reload/update 和已知/未知 storage version 都有确定结果 |
| GAP-LC-07 | 没有 active Operation 有界 polling 或终态/无容器停止机制 | 2s→4s→8s、最大 10s；终态或全部容器关闭即停止；POST 永不进入轮询 |
| GAP-LC-08 | 当前 `test:lifecycle` 仅 3 个纯状态机用例并复用幂等测试；没有真实 Chrome lifecycle verifier | 必须用真实 unpacked Chrome、真实 SQLite/4000，覆盖导航、重开、断连、worker restart、版本负例、网络/DB/交易边界 |

## 4. 防虚假验收判断

当前 `npm run test:lifecycle` 为 2 files/14 tests PASS，但其中 lifecycle 专属测试只有 3 个，且不启动 Chrome、不打开双容器、不停止 FAMS、不读真实 recoveryIndex。当前 semantic contract 也返回 PASS，却没有识别运行时合同页首状态和 §4.1 envelope 与代码冲突。把任一结果写成 M5 Lifecycle Accepted 都会构成明确假绿。

可接受的下一步只有：先完成 `SPEC_REENTRY_DECISION.md` 中的合同路线选择，更新运行时合同/架构/开发与验收计划并重新审计，重大问题清零后再进入代码。
