# V2-PX PX5-01 恢复与迁移开发计划

日期：2026-08-31

状态：`APPROVED_FOR_IMPLEMENTATION`

## 1. 用户结果

Back/Forward/Refresh、关闭重开及完整 Chrome 重启后，用户在 5 秒内看到 `recovering/restored/blocked`，并恢复同一 workspace 的 view/ref；未知 storage major 不被静默清空。

## 2. 代码实体与顺序

1. `chromeStorage.ts`：RecoveryIndex `/1→/2` 显式迁移、activeGraph、20 条/30 天、启动和每次写入 TTL/LRU、原始未知版本只读保留。
2. `idempotencyRegistry.ts`：启动执行独立 500 条/24 小时 cleanup。
3. `lifecycleCoordinator.ts`：session 优先、local fallback、URL/state 调和、恢复事件与 snapshot。
4. `lifecyclePortManager.ts`：首包订阅、sender/方向/secret 校验、container lease、Background 单写和 snapshot 广播。
5. `lifecycleClient.ts`：Side Panel/Workspace Port 客户端；无 heartbeat/alarms，最多一次有界重连留 PX5-02。
6. `background.ts`：startup/install coordinator、Port 和 storage change listener。
7. `WorkspaceApp/SidePanelApp`：先取得 Background snapshot 再加载；UI 不自行宣称 restored。
8. `runtimeHandler.ts`：route 固定写序 `recoveryIndex→session→tab`；session 缺失时允许 local 恢复。

## 3. 不变项

- Router/Command envelope、Host Bridge、4000/3000 allowlist 不变。
- 不新增权限、content script、remote origin、业务数据库或投资计算。
- POST Ask 自动重试=0，交易四锁 false。
