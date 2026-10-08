# C3 LLM 运行态可观测与降级开发计划

日期：2026-10-08

## 目标

修复“配置存在即显示可用”的假绿。ChatBox planner 与 summary 分别记录最近一次真实调用结果；失败时继续使用确定性 planner/summary，但不得把 fallback 表述成 LLM 成功。

## 实现实体

1. `LlmRuntimeStatusService`：内存运行态、脱敏失败分类、连续失败、最近尝试/成功/失败和 fallback 标志。
2. `ChatLlmPlannerService`：对 planner/summary 的 provider 调用记录 success/failure；无效 payload 计为失败。
3. `/api/v1/llm/status` 与 ChatBox `agentCore.llm`：返回静态配置和动态运行态。
4. `FamsChatBox.tsx`：技术折叠区显示增强状态与确定性降级，不显示原始错误。
5. `verify-llm-runtime-observability.ts`：验证 401/402/429/timeout/network/invalid/provider error 分类、恢复、脱敏和交易边界。

## 非目标

- 不改变白名单工具和确认 gate。
- 不允许 LLM 直接执行工具或交易。
- 不把确定性摘要降级视为功能失败；结构化业务结果仍是权威输出。
