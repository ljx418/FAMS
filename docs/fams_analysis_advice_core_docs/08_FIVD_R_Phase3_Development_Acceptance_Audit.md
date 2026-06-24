# FIVD-R Phase 3：统一前端面板开发、验收与审计

版本：v0.1  
日期：2026-06-01

## 1. PRD 规格检视

PRD 对应条款：

- 对外只呈现 FIVD-R 一套入口。
- 用户可从统一视图查看结论、允许/禁止动作、价值评估、交易纪律、内部验证锦标赛、候选处置、证据引用和缺失项。
- P4 只作为 `validation_tournament_agent` 内部机制出现。
- Validation Evidence 未通过时禁止 `ADD / REDUCE / AUTO_TRADE`。

当前状态：

- 后端 `/api/v1/analysis/fivd-r` 已可输出统一结果。
- 前端服务已有 `getFivdRAnalysis`。
- 分析页尚未展示 FIVD-R 统一面板。

## 2. 开发计划

本阶段只实现统一前端面板第一段：

1. 分析页新增 `FIVD-R` 分区。
2. 加载真实 portfolio 级 FIVD-R 结果。
3. 展示：
   - summary 状态、结论、允许动作、禁止动作、blockedReasons。
   - evidenceGate 状态、证据质量、evidenceRefs。
   - strategyValidation 来源和 operationId。
   - candidateDisposition 状态和候选处置摘要。
   - agentTrace 五个内部 Agent 的状态、产物和 blocker。
4. 不新增 mock fallback。
5. 不开放任何交易动作按钮。

非范围：

- 不在本阶段实现收益分布模型。
- 不在本阶段实现人工复核写入。
- 不改变 trade readiness gate。

## 3. 验收计划

真实数据端到端验收：

1. 打开分析页，FIVD-R 分区可见。
2. 页面数据来自 `/api/v1/analysis/fivd-r?userId=default&scope=portfolio`。
3. 页面显示 `validation_evidence` blocker 时，禁止动作包含 `ADD / REDUCE / AUTO_TRADE`。
4. 页面展示 `validation_tournament_agent`，且 operation 来源为真实 Operation。
5. 截图留存到 `.verification/fivd-r-phase3-panel.png`。

命令验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:fivd-r-core` 通过。
- `npm run test:production-readiness -- --strict` 通过。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 保持 `validation_evidence`。

## 4. 审计意见

审计时间：开发前。

结论：允许进入实质开发。

致命风险：无。

重大风险：无。

一般风险：

- 第一段只实现 portfolio 级展示，position 级详情仍由后续阶段补充。
- 前端面板只展示 Expected Return 当前状态，不实现概率分布模型。

闭环意见：

- 在页面显式展示禁止动作和 blocker，避免用户误解为可交易。
- 在验收中检查真实 Operation 来源，避免静态展示伪通过。

## 5. 开发后 PRD 规格复检

复检时间：开发后。

结论：通过。

对照 PRD：

- 单一入口：前端 FIVD-R 分区消费 `/api/v1/analysis/fivd-r?userId=default&scope=portfolio`。
- P4 内化：页面以“内部验证锦标赛”和 `validation_tournament_agent` 展示原 P4 证据，不暴露独立 P4 产品入口。
- 动作边界：页面显式展示 `ADD / REDUCE / AUTO_TRADE` 为禁止动作。
- 证据追溯：页面展示 evidenceRefs、operationId、candidateDisposition 和 agentTrace。
- LLM 边界：页面只展示结构化结果，没有新增交易结论。

## 6. 真实数据端到端验收结果

验收时间：开发后。

结果：通过。

执行命令：

```text
node scripts/verify-fivd-r-phase3-panel.mjs
```

验收事实：

- 真实后端 `/api/v1/analysis/fivd-r?userId=default&scope=portfolio` 返回 200。
- 真实前端 `/analysis?section=fivdr` 渲染 FIVD-R 统一面板。
- 页面包含“内部验证锦标赛”、“禁止动作”、“Agent Trace”。
- 页面包含 `validation_tournament_agent`。
- 页面包含 `ADD / REDUCE / AUTO_TRADE` 禁止动作。
- 截图：`.verification/fivd-r-phase3-panel.png`。

环境说明：

- 首次验收暴露 `npm run dev` 的 tsx shim 问题，已改为直接使用 `node node_modules/tsx/dist/cli.mjs src/index.ts`。
- 首次浏览器验收暴露 WSL Chromium 缺少 `libnspr4.so`，已接入现有 `.verification/playwright-libs/lib`。
- 真实行情 provider 在验收中出现外部源 400/503，但 FIVD-R 面板验收依赖本地真实 Operation evidence 和后端降级链路，未使用 mock 伪通过。

## 7. 开发后审计意见

结论：允许进入下一阶段计划制定。

致命风险：无。

重大风险：无。

一般风险：

- Portfolio 级 FIVD-R 接口在真实持仓较多时耗时约 30-36 秒，后续需要缓存化或拆分刷新。
- 本阶段只完成 portfolio 面板，position 级 FIVD-R 详情仍需后续阶段补齐。
- Expected Return 仍为 placeholder，不能作为收益分布验收依据。
