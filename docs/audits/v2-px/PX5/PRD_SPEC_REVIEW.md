# V2-PX PX5 Router/at-most-once PRD 规格检视

日期：2026-08-29

检视结论：`PASS_NO_FATAL_OR_MAJOR_DRIFT_NEXT_STAGE_DOCUMENTATION_ALLOWED`

代码锚点：`4e752a652afb63cacc89f42638e66307b2ca13be`

## 1. PRD 对齐结论

| PRD/架构约束 | 实现事实 | 偏移判断 |
| --- | --- | --- |
| 三入口、三动作、五 intent 语义一致 | `intentRouter.ts` 生成稳定 route；真实 Chrome 3×3=9/9、intent=5/5 | 无偏移 |
| 同工作区只保留一个 Workspace tab | `workspaceTabManager.ts` 对 workspace 排队、去重、聚焦；20 串行/20 并发/多窗口均 tab=1 | 无偏移 |
| canonical 不依赖瞬时 token | SHA-256 只覆盖稳定合同字段；URL 排除 route/correlation/question/answer | 无偏移 |
| POST Ask at-most-once | `idempotencyRegistry.ts` 在同一 storage 上串行 prepared/dispatched/network/completed；20 并发 POST=1 | 无偏移 |
| 不确定结果不得伪装失败前可重试 | dispatched、结果后 storage 失败均映射 `unknown_result`，重放 POST=0 | 无偏移 |
| Background 单写 | `runtimeHandler.ts` 按 workspace 串行 route/load/query 状态；renderer/Host 不直接写状态 | 无偏移 |
| 最小 recoveryIndex 与隐私 | 仅存 ID、view/ref、时间/version；真实存储扫描 question/answer=0 | 无偏移 |
| 交易硬边界 | 仅 Read/Ask；broker/order=0、三个表差分=0、四锁=false | 无偏移 |

## 2. 关键设计合理性

1. 内部 sender 不只检查 extension ID，还把 Side Panel 绑定到 `/sidepanel.html`、Workspace 绑定到 `/workspace.html`；这是落实既有入口真实性合同，不是新增产品权限。
2. 并发导航的 0/40/160ms 重试只作用于 `chrome.tabs.update` 这一无业务副作用的 GET/tab 导航；Ask POST 仍为自动重试 0。
3. `finalize` 与 ledger 操作共用 storage 队列，使 recovery/session 无法在 completed ledger 回读前抢写；结果后写失败保留 unknown，避免诱导用户安全重试。
4. 多窗口去重优先保留发起 Workspace tab，避免用户所在标签被移除；没有改变“同 workspace 单 tab”的 PRD 语义。

## 3. 代码—需求覆盖

- PX-REQ-001/002/003：完整 3×3 与五 intent 已由真实三入口证明。
- PX-REQ-006：串行、并发、跨窗口标签复用已完成。
- PX-REQ-009：并发、replay、service-worker restart、dispatched unknown、result-after-storage-fault 已完成。
- PX-REQ-012/014/018：最小存储、Background 单写、交易边界在本阶段通过。
- PX-REQ-007/008/017：本阶段只提供其底层 ledger/recoveryIndex 与事件顺序，不声明完整生命周期体验完成。
- PX-REQ-010/011/019/020：本阶段产生真实 Chrome 证据，但最终四视口、可访问性和 acceptance/2 聚合仍留 PX6。

## 4. 剩余风险与下一阶段准入

致命偏差：0。重大规格偏差：0。自动验收虚假通过风险：0 个未闭环。

剩余风险属于已冻结的后续阶段范围：

- session 丢失或 browser close 后需从 recoveryIndex 诚实恢复；未知 storage 版本必须 blocked，不能静默清空。
- FAMS disconnect/reconnect、Background suspend/restart、extension update 必须形成 `lifecycle/3` 可推导事件与用户下一步。
- TTL/LRU 需要在真实启动/恢复路径验证，而不只是 helper/存储单测。
- closed 状态不得继续渲染活动 UI；最终人类 permission 点击仍不可由自动化代替。

因此只批准进入产品 PX5 生命周期/恢复的“文档准入与独立审计”，不提前批准该阶段实现完成或 V2-PX 最终出门。
