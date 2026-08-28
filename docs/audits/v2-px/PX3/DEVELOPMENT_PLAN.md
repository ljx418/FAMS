# V2-PX PX3 Workspace 与 Adapter 开发计划

日期：2026-08-29
状态：IMPLEMENTED_AUTOMATED_ACCEPTANCE_PASSED

## PRD 目标

本子阶段实现 PX-REQ-003/005/009/013/015/016/018 的 Workspace 垂直切片，并为 PX-REQ-007/008/014/017 的后续完整恢复保留诚实状态。用户在 768/1280 页面能看到来源库、详情、问答、任务追踪和关系图谱的真实 FAMS 数据；问题只由扩展 UI 发起，POST 不重试；问题和回答正文只放 React memory。

## 已执行顺序

1. Extension DTO 使用精确 common envelope；客户端逐字段验证，只对网络/503 重试 GET。
2. Domain Adapter 只按 WorkspaceState 的明确 sourceRef/operationId/graphScope+graphId 取数，禁止猜测 scope/id。
3. Background 作为唯一网络与状态写者；query 经过 dispatch ledger；结果只以临时响应进入 React memory。
4. Workspace 实现五视图、普通话摘要、数据时间/可信状态/下一步、默认折叠证据，以及未连接/加载/空/失败/恢复/阻断状态。
5. 方案 A 经用户批准后，每个 External Brain API 请求携带公开扩展 ID；服务端以 caller ID allowlist 和可选 Origin 一致性矩阵 fail closed。
6. 修复 Chrome Service Worker 原生 `fetch` receiver 的 `Illegal invocation`；以回归测试锁定全局 receiver。
7. 以真实 Prisma、真实 FAMS API、真实 LLM、真实 unpacked Chrome 152 采集 768/1280 五视图证据。

## 禁止事项复核

- UI 直接 fetch 后端：未发生。
- 保存回答正文或问题到 Chrome storage：未发生，自动扫描为 0。
- POST 自动重试或 unknown_result 显示 success：未发生，真实 Ask POST=1。
- 通过字符串猜 graph/operation/source：未发生。
- 使用 mock/stub DOM 代替真实业务数据：未发生。
- 订单、broker 或交易写入：请求=0，Transaction 变更=0，四锁恒 false。

## 子阶段出门

代码提交：`6c8714ed6909342f1730746451a8b2aaebc754d4`。

- 真实 API 证据：`.verification/private/v2-px/6c8714ed6909342f1730746451a8b2aaebc754d4/PX2`
- 真实 Chrome 证据：`.verification/private/v2-px/6c8714ed6909342f1730746451a8b2aaebc754d4/PX3`
- 自动化子阶段结论：PASS，可进入下一子阶段的文档入场审计。
- 人类最终门槛：正式构建首次连接时的 optional host permission 点击仍未执行；headless 验收只在私有构建副本预授予 4000，不得冒充人类授权通过。

历史 MV3 无 Origin 阻断及方案 A 合同重入保留在 `CALLER_IDENTITY_REENTRY.md` 与 `REAL_CHROME_FAILURE_EVIDENCE.json`，它们是已关闭问题的审计证据，不再是当前 blocker。
