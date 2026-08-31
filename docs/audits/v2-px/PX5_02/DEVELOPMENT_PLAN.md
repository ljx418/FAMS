# V2-PX PX5-02 中断生命周期开发计划

日期：2026-08-31

状态：`APPROVED_FOR_IMPLEMENTATION_AFTER_ENTRY_AUDIT`

## 1. 用户结果

FAMS 暂停、MV3 worker 被 CDP 终止或 extension 从 0.1.0 更新到 0.2.0 时，用户在 5 秒内看到 disconnected/recovering/restored/blocked 的诚实结论；最后一个容器关闭后状态为 closed，后台不再轮询。

## 2. 实现实体与顺序

1. `lifecycleCoordinator.ts`：补 `connection_lost→disconnected`、`reconnect→recovering→ready|blocked`；清理 seed 为 5 分钟以前的 stale lease 并发出 `lease_expired→closed`；一个容器关闭而另一个仍活跃时不得 closed。
2. `lifecyclePortManager.ts`：Port 非正常断开登记 connection_lost；显式 close 只移除对应 lease；storage snapshot 仍由 Background 推送。
3. `lifecycleClient.ts`：断开后仅一次、250ms 有界重连；重连发送 recover_request/subscribe，不发送 heartbeat，不用 alarms，不无限重试。
4. 新增 `operationPoller.ts`：只对已存在 `activeOperationId` 调用真实 `GET /traces/:id`，延迟严格为 2/4/8/10 秒；terminal、blocked/disconnected、无 lease 或四轮结束立即停止；禁止 POST。由于 MV3 不保证事件结束后的内存 timer 存活，Trace 页面在真实读取成功后只发送一次严格校验的 `operation_poll` 内部 Runtime Message；Background 在该单次消息的待响应生命周期内拥有调度与 FAMS GET，页面不循环发消息、不直接访问 FAMS。
5. `background.ts`：startup/update/订阅时执行 stale lease 清理；依据活动 lease 启停 poller；保持 Background 单写。
6. `WorkspaceApp.tsx`、`SidePanelApp.tsx`：把断连、恢复、阻断映射到已有中文状态和下一步，不自行推导成功。
7. `package.json`/manifest：只在 update 验收原子阶段将 extension 版本从 0.1.0 提升到 0.2.0；权限集合不得变化。
8. 新增 `verify-lifecycle-interruption-chrome.mjs`：真实 Chrome/CDP、真实 SQLite backup、真实 IPv6 4000 服务；覆盖服务停启、worker terminate、update、双容器 lease、poll stop。

## 3. 不变项

- 不修改 FAMS 投资计算、业务 schema、Router/Command envelope、Host Bridge 或 CORS authority。
- GET 可使用 FamsApiClient 既有有限重试；Ask/ingest POST 自动重发仍为 0。
- 无 heartbeat、alarms、content script、remote origin；交易四锁保持 false。
- `operation_poll` 不是心跳：一次 Trace 打开/恢复只发送一次，不更新 lease、不按间隔向 Background 发消息；2/4/8/10 秒循环完全在 Background 内执行。相同 workspace/operation 的并发启动必须合并为一条 run。
