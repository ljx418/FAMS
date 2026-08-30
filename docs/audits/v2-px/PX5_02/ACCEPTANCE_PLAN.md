# V2-PX PX5-02 中断生命周期验收计划

日期：2026-08-31

## 1. 真实场景与出门门槛

| 场景 | 自动化操作 | 通过门槛 |
| --- | --- | --- |
| FAMS 断连/重连 | 打开真实 active Operation；停止 `[::1]:4000`，再启动同一 SQLite snapshot 服务 | 5 秒内显示 disconnected/失败结论；重启后一次有界恢复到 ready 或诚实 blocked；事件链可推导 |
| worker suspend | 通过 CDP 停止真实 extension service worker，再由页面触发恢复 | 无 UI 自报成功；5 秒内恢复或 blocked；同 workspace/view/ref |
| extension update | 同 profile 从 production 0.1.0 加载到 0.2.0 build | session 可丢失，RecoveryIndex/2 可恢复；权限集合不扩大；migration/update 证据可复核 |
| 双容器 lease | Side Panel + Workspace 同时订阅，依次关闭 | 关闭一个不进入 closed；最后一个关闭后 close/closed；stale seed 产生 lease_expired/closed |
| active Operation poll | 使用真实非终态 Operation，记录 GET 时间；关闭最后容器 | 间隔只允许 2/4/8/10 秒；terminal/断连/无 lease 后新增 GET=0；POST=0 |
| 安全/真实性 | 扫描 manifest、network、storage、SQLite 与 console | heartbeat/alarm=0；订单请求/Transaction 差分/secret=0；四锁 false；console error=0 |

## 2. 证据目录

精确提交的截图、trace、lifecycle event/state、worker target、update 前后 manifest/hash、network 时间线、storage 和 SQLite hash 写入 `.verification/private/v2-px/<commit>/PX5-02/`。现存 IPv4 项目服务不停止；验收服务只绑定 `[::1]:4000`。

## 3. 失败回退

任一场景失败即回到计划/实现修复并全量重跑。若必须增加权限、heartbeat、远程 origin、交易能力、修改业务后端或无法构造真实非终态 Operation，判定为高风险扩展并停止请求人类确认。
