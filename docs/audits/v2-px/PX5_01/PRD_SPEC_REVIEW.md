# V2-PX PX5-01 PRD 规格检视

日期：2026-08-31

结论：`PASS_FOR_PX5_02_ENTRY`

## 1. 需求结论

| 需求/场景 | PX5-01 结论 | 未完成边界 |
| --- | --- | --- |
| PX-REQ-007 / AC-PX-07 刷新恢复 | Back、Forward、Refresh、关闭重开、完整 Chrome 重启全部恢复同一 workspace/view/ref；115～585ms 可见 | FAMS 断连、worker suspend、extension update 留 PX5-02 |
| PX-REQ-014 Background 单写 | lifecycle Port、workspace 队列、RecoveryIndex/2、session event/state、写入回读与未知 major 阻断均由 Background 执行 | stale lease 与断连事件留 PX5-02 |
| PX-REQ-017 降级状态 | recovering/restored/blocked 已在真实 Chrome 可见；未知 `/99` 103ms 内 blocked，未伪装成功 | disconnected/closed 全矩阵留 PX5-02 |
| PX-REQ-020 防漂移 | 5 组目标合同、80+ 单测、语义合同、commit/hash/真实证据一致 | acceptance manifest/report/2 与 G1～G7 留 PX6-01 |
| AC-PX-09 安全边界 | 真实全路径 POST=0、订单请求=0、Transaction 差分=0、四锁 false、storage secret-like=0 | 最终汇总留 PX6-01 |

## 2. 规格偏移审计

- 未新增权限、origin、content script、heartbeat、alarm、交易能力或第二份业务数据。
- Side Panel 只观察规范 Workspace route，不用自己的来源库视图覆盖恢复索引。
- Router/Command 继续使用 `messageType` runtime envelope；生命周期只走 `v2-px-lifecycle/1` Port。
- 首次两轮正式 E2E 均在关闭重开路径真实失败并被打回；修复 tab-close race 和 Side Panel recovering→ready 归并后才生成最终通过证据，未把失败证据冒充通过。

## 3. 结论

PX5-01 对其文档支持范围无致命或重大规格偏移，可以进入 PX5-02。M5 仍未完成，不得声明生命周期整体出门。
