# V2-PX PX4-A 实施后 PRD 规格检视

日期：2026-08-29

审计对象：commit `bc7cc5a45f16538da0d2192d1bb0347bd73576f5`

结论：PASS_FOR_PX4_B_ENTRY_DOCUMENTATION

## 要求映射

| PRD | 结论 | 边界 |
| --- | --- | --- |
| PX-REQ-004 轻量 Side Panel | PASS | 连接、当前摘要、时间、依据、Quick Ask、最近 5 条、打开 Workspace 均真实可用 |
| PX-REQ-009 幂等 | PASS（Side Panel Ask 切片） | ack/final 分离，真实 POST=1，问题/回答不入 storage；跨 reload 完整矩阵留后续 |
| PX-REQ-011 四视口 | PASS（两容器组合自动化） | Side Panel 360/420 与 Workspace 768/1280 均通过；最终 evidence/2 汇总留 PX6 |
| PX-REQ-013 FAMS 适配 | PASS | Side Panel 只经 Background/Adapter 读取 SourcePage 与 Ask；无 UI 直连、无复制计算 |
| PX-REQ-015 最小权限 | PASS_AUTOMATED | 4000 optional、正式安装权限为空、caller ID 匹配；正式点击仍是人类门槛 |
| PX-REQ-016 摘要分层 | PASS_AUTOMATED | Side Panel 简明层与 Workspace 完整层均有真实像素证据 |
| PX-REQ-017 降级状态 | PASS（Side Panel 切片） | 单元状态矩阵 + 真实 policy blocked；完整十 lifecycle/closed/reload 留 PX5 |
| PX-REQ-018 交易硬边界 | PASS | 无交易动作、请求或数据写入，四锁恒 false |

## 独立偏移判断

- fatal：0。
- major：0。
- 虚假验收风险：0 个未闭环 major；真实成功与真实 blocked 两条 Ask 结果都被观察，shell/ack 不计为 final。
- 规格未完成但不属于本子阶段：Host App bridge、三入口相关链、完整跨入口幂等、生命周期、PX6 汇总与人类验收。

## 出门决定

PX4-A 可以关闭并进入 PX4-B Host Bridge 的文档入场审计。Host Bridge 若需要向 route payload 写入 question、完整业务对象、截图或 secret，必须立即停止；交易四锁不得改变。
