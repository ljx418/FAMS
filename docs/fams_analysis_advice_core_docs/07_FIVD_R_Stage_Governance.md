# FIVD-R 阶段治理、验收与审计门禁

版本：v0.1  
日期：2026-06-01

## 1. 阶段进入条件

每个 FIVD-R 子阶段进入实质开发前，必须先完成：

1. 阶段开发计划。
2. 阶段验收计划。
3. PRD 规格检视。
4. 审计意见。

若审计意见存在“致命”或“重大”项，不允许进入开发。

## 2. 审计等级

致命：

- 绕过 Validation Evidence 或人工确认 gate。
- 将 `RESEARCH / OBSERVE` 包装成 formal `ADD / REDUCE`。
- 使用 mock、模板或伪造数据冒充真实端到端验收。
- 使用未来行情、未来财报、未来新闻完成 replay 或收益分布。

重大：

- 缺少 PRD 要求的核心输出字段。
- 前后端语义不一致，导致用户误解动作边界。
- 验收样本不足以支撑阶段结论。
- 端到端结果不可复现或缺少 evidenceRefs。

一般：

- 展示字段不完整但不影响动作边界。
- 文档滞后但不影响实现和验收。
- 命名或布局可读性问题。

## 3. 阶段完成条件

每个子阶段完成后必须执行：

1. 后端 TypeScript 检查。
2. 前端 TypeScript 检查。
3. `npm run test:fivd-r-core`。
4. `npm run test:production-readiness -- --strict`。
5. `npm run test:trade-action-readiness`，在 validation 未通过时必须按预期失败。
6. 阶段专属真实数据端到端验收。
7. PRD 规格复检和审计意见更新。

## 4. 打回规则

如果真实数据验收不通过，或 PRD 规格检视发现致命/重大偏差，阶段必须打回开发计划阶段重新审计。不能通过降低 gate、隐藏 blocker 或改验收口径来通过。
