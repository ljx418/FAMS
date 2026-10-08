# C3 LLM 运行态可观测验收计划

日期：2026-10-08

## 自动门槛

1. `chat_planner` 与 `chat_summary` 独立记录 `not_attempted/available/degraded/unavailable`。
2. 401/403、402、429、timeout、network、invalid response 和其他 provider error 仅暴露固定分类码。
3. 最近调用失败后不得显示 available；后续成功可恢复 available 并清零连续失败。
4. provider 失败时确定性 planner/summary 仍返回结构化业务结果。
5. 状态 JSON 不包含 API key、Bearer token、完整原始错误或 request id。
6. ChatBox 工具范围不增加，四项交易锁保持 false。

## 命令

```text
cd backend
node node_modules/typescript/bin/tsc
npm run test:llm-runtime-observability
npm run test:chat-llm-planner
cd ../frontend
npm run build
```

## 打回条件

- 402/429/timeout 后仍显示 available。
- deterministic fallback 被标记为 LLM source。
- 任何 secret 或原始 provider 错误进入公共状态。
- 交易工具或权限发生变化。
