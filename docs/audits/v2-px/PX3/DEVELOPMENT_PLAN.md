# V2-PX PX3 Workspace 与 Adapter 开发计划

日期：2026-08-28
状态：BLOCKED_SPEC_REENTRY_REQUIRED

## PRD 目标

本阶段实现 PX-REQ-003/005/009/013/014/016/017 的完整 Workspace 垂直切片，并为 PX-REQ-007/008 的后续完整恢复保留诚实状态。用户在 768/1280 页面能看到来源库、详情、问答、任务追踪和关系图谱的真实 FAMS 数据；问题只由扩展 UI 发起，POST 不重试；内容只放 React memory。

## 实现顺序

1. 把 extension DTO 改为精确 common envelope；客户端逐字段验证，只对网络/503 重试 GET。
2. Domain Adapter 只按 WorkspaceState 的明确 sourceRef/operationId/graphScope+graphId 取数，禁止从字符串猜 scope/id。
3. Background 作为唯一网络与状态写者：refresh 取 read model；query 经过 dispatch ledger；结果只以临时响应进入 React memory。
4. Workspace 实现五视图、普通话摘要、数据时间/可信状态/下一步、默认折叠证据，以及未连接/加载/空/失败/恢复/阻断六状态。
5. 增加 adapter 网络故障与 `test:workspace`；再以真实后端、真实扩展、真实 Chrome 采集 768/1280 五视图同源证据。

## 禁止事项

- UI 直接 fetch 后端、保存回答正文或问题到 Chrome storage。
- GET 对 500/4xx 重试，POST 自动重试，unknown_result 显示 success。
- graph scope/id、operationId 或 sourceRef 通过字符串前缀猜测。
- 用 mock/stub DOM 代替真实 Prisma/API/extension 页面，或出现订单/broker 请求。

## 自动停止点

真实 Chrome 152 已证明 MV3 Background GET 不发送 `Origin`，与 PX2“扩展调用必须携带 allowlist Origin”的冻结合同冲突。候选实现保留，但在调用方识别合同重新批准并闭环前，禁止继续 PX3 出门及 PX4+ 开发。详见 `ACCEPTANCE_AUDIT.md` 与 `REAL_CHROME_FAILURE_EVIDENCE.json`。
