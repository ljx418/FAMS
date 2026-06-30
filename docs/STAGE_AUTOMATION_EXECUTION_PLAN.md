# 本阶段自动化开发执行计划

生成日期：2026-06-30

## 阶段目标

完成已经被 PRD、目标架构和 UX/ChatBox 文档完整支撑的自动化开发项：

1. UX 出门证据闭环。
2. ChatBox/AgentCore 会话审计、确认卡、任务联动和交易阻断。
3. 阶段性 E2E 验收报告、PRD 规格检视和审计包归档。

本阶段不是正式交易 release。必须保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 子阶段与验收

| 子阶段 | 开发内容 | 出门验收 |
| --- | --- | --- |
| S0 基线审计 | 落盘执行计划与 preflight audit，冻结边界 | 文档明确 dirty worktree、交易锁定、不可自动化项 |
| S1 UX 证据闭环 | 保持普通/专家模式、红利低波、回测、任务中心可读性 | `npm run test:frontend-ux-consistency`、前端 build |
| S2 ChatBox 完整业务入口 v1 | 会话审计、确认卡、operationId、交易阻断、审计 JSON | `npm run test:chat-agent-core` 生成 `chatbox_agentcore_audit.json` |
| S3 E2E 报告 | 生成全系统验收报告，包含截图和 PRD 对照 | `npm run run:full-system-e2e-acceptance-report` |
| S4 最终验证 | 后端 tsc、核心合同测试、前端 build | 所有命令通过；失败则打回对应子阶段 |

## 不自动化项

- 正式数据授权接入。
- 官方 total-return benchmark 授权。
- 真实人工签核。
- 正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。
- 自动交易和自动再平衡。

## 失败处理

若任何验收失败：

1. 不进入下一子阶段。
2. 先记录失败命令、失败原因和是否属于规格偏差。
3. 若失败来自真实数据或授权缺口，写入 blocker，不伪造通过。
4. 若失败来自 UI/接口/测试实现，修复后重新验收。
