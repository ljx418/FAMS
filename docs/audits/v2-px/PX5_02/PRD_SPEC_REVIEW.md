# V2-PX PX5-02 PRD 规格检视

日期：2026-08-31

结论：`PASS_FOR_PX6_01_ENTRY`

## 1. 需求结论

| 需求/场景 | PX5-02 结论 | 后续边界 |
| --- | --- | --- |
| PX-REQ-008 / AC-PX-07 中断恢复 | FAMS 断连 2680ms 可见、恢复 108ms；Worker suspend 315ms；0.1→0.2 update 276ms；均恢复或给出诚实状态 | PX6-01 汇总 G1～G7；PX6-02 人工体验复核 |
| PX-REQ-014 Background 单写 | initialization gate、全局 lifecycle 写队列、5 分钟 stale lease、双容器 lease 与 session/local authority 已由真实事件链验证 | 不引入第二状态权威 |
| PX-REQ-017 降级状态 | disconnected/recovering/ready/closed/lease_expired 映射和下一步可见；异常不自报成功 | 人类仅核对可理解性，不重写状态结论 |
| PX-REQ-020 防漂移 | 93 单测、语义/API/策略合同、精确 commit/hash、真实 Chrome/network/storage/SQLite 证据一致 | PX6-01 实现 acceptance manifest/report/2 聚合防假绿 |
| AC-PX-09 安全边界 | 控制消息一次；Background GET 有界；POST/交易请求/Transaction 差分/secret/error 均为 0；四锁 false | 最终发布仍需人类 gate，不能自动解锁 |

## 2. 规格偏移审计

- `operation_poll` 是 `v2-px-runtime-message/1` 的严格内部控制分支，只允许 Workspace→Background；页面一次发送，2/4/8/10 调度与 FAMS GET 均由 Background 完成。它不更新 lease、不循环发消息，不是 heartbeat。
- 未增加 manifest 权限、origin、content script、alarm、远程依赖、POST 自动重试、业务数据库或交易路径。
- unpacked 更新验收只清理临时 profile 的 Service Worker/JS 代码缓存，保留同一 profile、extension local storage、固定加载路径与 ID；这是为模拟正式更新器的代码缓存失效，不构成产品运行时依赖。
- 初始化 gate 与全局 lifecycle writer 消除了 startup/subscription 的整表覆盖竞争，并满足启动、更新、新订阅 stale 清理要求。
- PX5-02 的真实失败均保留在开发过程记录中，最终 PASS 只引用精确提交 `51a9329` 的正式证据。

## 3. 结论

PX5-02 对 PRD、目标架构和 LC-A 无致命或重大偏移，M5 可关闭并进入 PX6-01。剩余自动开发是 acceptance manifest/report `/1→/2`、G1～G7、20 requirements、AC01～10 与人类验收 HTML 聚合；PX6-02 的权限点击和十项体验判断继续由人类执行。
