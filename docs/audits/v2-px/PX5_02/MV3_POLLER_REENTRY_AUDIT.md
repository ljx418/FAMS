# PX5-02 MV3 轮询修复再入审计

日期：2026-08-31

结论：`PASS_FOR_REPAIR_IMPLEMENTATION`

## 1. 失败事实

真实 Chrome 连续三次在 PX5-02 开发验收中只观察到 Trace 首次读取，没有任何 2/4/8/10 秒 GET。SQLite 中的真实 Operation 为 `running`，WorkspaceState 同时具备 `activeOperationId`、`ready` 和两个有效 lease。临时 worker 内存探针在失败时已消失，证明事件结束后 MV3 Service Worker 被回收，内存 Map/timer 不能作为可靠调度依据。上述失败不得计为验收通过。

## 2. 修复合同

1. `v2-px-runtime-message/1` 增加仅内部使用的 `messageType=operation_poll` 分支；payload 严格为 `workspaceId, operationId, controlId`。
2. 只允许 `workspace_page → background`；sender 必须是本 extension 的 `/workspace.html`；Host、Side Panel、额外字段、错误 ID 全部阻断且 FAMS 调用为 0。
3. Trace 首次真实读取或中断恢复成功后，页面只发送一次消息。该消息保持待响应，Background 在同一处理生命周期内执行 2/4/8/10 秒有界循环；页面不直接请求 FAMS，也不发送周期消息。
4. Background 必须读取权威 WorkspaceState，核对 workspace、operation、有效 lease 和非阻断状态；相同 workspace/operation 的并发启动合并；terminal、断连、无 lease、四次结束或 GET 失败即停止。
5. 失败和停止返回既有 `command-result/1`，不新增权限、业务 schema、持久事实、heartbeat、alarm、POST 或交易能力。

## 3. 风险与门槛

| 风险 | 控制 | 出门证据 |
| --- | --- | --- |
| 用 UI timer 冒充 Background 轮询 | UI 只发一次；所有等待和 GET 在 `operationPoller` | Chrome network + control-message 计数 |
| 重复 GET | Background 按 workspace/operation 合并 run | 单元并发测试 + 真实 GET 恰为四次轮询 |
| worker 仍被回收 | 单次 `runtime.sendMessage` 的响应保持 pending，直至循环停止 | 无 DevTools 保活条件下真实 Chrome 2/4/8/10 证据 |
| unpacked 更新继续执行旧 Worker 缓存 | 旧 Chrome 完全退出后仅删除验收临时 profile 的 Worker/JS 代码缓存；保留同 profile、extension local storage、固定加载路径与 ID | 0.1→0.2、session 为空、RecoveryIndex 恢复、ID/权限不变 |
| Worker 初始化与双 Port 订阅读写竞争 | Background 建立单一 initialization gate；migration/stale lease/ledger 清理完成前 Port 与 Runtime 消息不得处理；禁止 onInstalled/onStartup 重复初始化 | CDP 终止 Worker 后 5 秒内主 workspace ready 且 stale seed 必为 lease_expired/closed |
| 合同扩权 | 严格内部 sender/payload；Host 拒绝；权限 diff=0 | 负例测试与 manifest diff |
| 停止不及时 | 每轮等待后、GET 前读权威 state；close/connection lost 同时 cancel | 最后 lease 后新增 GET=0 |

致命问题：0。重大规格偏差：0。该修复不改变用户目标、FAMS authority、权限和安全边界，可进入 PX5-02 修复实现；若真实 Chrome 仍不能维持 pending message，则停止并作为平台冲突请求人类决策，禁止用 DevTools、heartbeat 或 alarm 伪造通过。
