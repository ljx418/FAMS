# V2-PX PX4-B 实施后 PRD 规格检视

日期：2026-08-29

审计对象：生产 commit `4b4d3a808382c7522c25be1d316889441bd8cf54`；验收 commit `a0758b4980b01739ead5abff0bc2029a66716964`

结论：PASS_FOR_NEXT_ROUTER_IDEMPOTENCY_ENTRY_DOCUMENTATION

## 要求映射

| PRD/合同 | 结论 | 边界 |
| --- | --- | --- |
| PX-REQ-001 三入口 | PASS（入口闭环） | Side Panel、Workspace 与 FAMS Host 三页均有真实入口；完整 3×3×5 压力矩阵留下一阶段 |
| PX-REQ-002 三动作 | PASS（Host 子集 + runtime 矩阵） | Host UI 的 open workspace/open in workspace 已真实走通；Host view_source->Workspace 由 target contract/router 正负例锁定 |
| PX-REQ-009 幂等 | PASS（导航切片） | 每次动作唯一 route/correlation，重复点击 tab=1；dispatch ledger reload/storage fault 完整矩阵未提前声明 |
| PX-REQ-013 FAMS 适配 | PASS | review/operation 与真实 SQLite/生产 route handler 同源；Host 不直接调用 4000 |
| PX-REQ-015 最小权限 | PASS_AUTOMATED | 3000 allowlist 正例、3001 真实负例、Host question/command 负例；正式 optional permission 人工点击仍 pending |
| PX-REQ-016 摘要分层 | PASS（Host 跳转层） | Host 只显示短状态，复杂结果进入 Workspace；未把完整图/DAG 塞入按钮区 |
| PX-REQ-017 降级状态 | PASS（配置/阻断切片） | 缺配置、非法 ID、扩展不存在、timeout、Background blocked 均有中文下一步；完整 lifecycle 留 PX5 |
| PX-REQ-018 交易硬边界 | PASS | mutation/order/broker/storage secret 均为 0，数据库交易相关计数无变化，四锁 false |
| API 合同 §4.2/§4.3/§7.2 | PASS | ask route 不含 question；Host operation command blocked；sender=3000、target=Workspace、ack<1s |

## 架构与文档偏移复核

实施实体与批准方案一致：`pxExternalBrainBridge.ts`、统一按钮、ChatBox/DailyReviews/Operations 三个集成点和真实 Chrome verifier。审计同时发现目标架构中的早期“待新增/实现未开始”状态已经落后于 PX1～PX4-B 事实；本轮已把它改为具体合并实体与已实现/需补强状态，避免后续按不存在的文件拆分开发。该修订不改变 PRD、权限或产品范围。

## 偏移与风险结论

- fatal：0。
- major：0。
- 规格偏移：0 个未闭环。
- 虚假验收风险：0 个未闭环；首轮 404 与 HB-06 证据缺口均先打回、修复、按新 commit 重签。
- 仍未实现但不属于 PX4-B：20 次/多窗口路由矩阵、at-most-once 全 fault/reload、完整恢复与迁移、target evidence/2 汇总、可访问性全路径、最终人类体验。

## 出门决定

PX4-B 可以关闭。下一阶段只允许先编写“产品计划 PX4-01～03 Router/at-most-once/边界集成”的入场、开发与验收文档；在其 fatal/major=0 前不得修改生产实现。
