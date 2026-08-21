# DRV1-6 PRD 规格检视

日期：2026-08-21
结论：`PARTIAL — REAL_PERSISTENCE_GATE_PENDING`

| 规格 | 结论 | 证据 |
| --- | --- | --- |
| DPR-012 | CONTRACT PASS / REAL BLOCKED | 单次调用路径、严格校验与 fallback 已实现；真实新报告持久化未完成。 |
| DPR-013 | CONTRACT PASS / RUNTIME BLOCKED | 关注汇总只接受白名单标的和证据；真实页面正文/审计分层待浏览器验收。 |
| DPR-014 | PASS | LLM 不生成也不修改订单数字；订单表读取确定性 decisionSummary。 |
| DPR-010 | PASS | LLM 路径没有订单创建或交易权限变更能力。 |

DeepSeek 余额不足是允许降级条件，不得通过切换供应商重试来伪造“单次请求”通过。当前主库已恢复；后续维护窗口应使用当前配置完成一轮，接受 available 或带明确 failureCode 的 fallback。
