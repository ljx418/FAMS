# C3 LLM 运行态可观测验收审计

日期：2026-10-08

## 结论

```text
C3=PASS
realProviderAttempted=true
realProvider=deepseek
realProviderOutcome=QUOTA_EXHAUSTED
deterministicFallbackTruthful=true
failureClassificationCases=7/7
secretLeakCount=0
fatalFindingCount=0
majorFindingCount=0
```

## 真实运行结果

DeepSeek 配置存在，但 planner 和 summary 的真实调用均返回配额耗尽。系统当前公开状态为：

```text
plannerRuntimeAvailability=unavailable
summaryRuntimeAvailability=unavailable
plannerMode=deterministic_planner_fallback_after_provider_failure
summaryMode=deterministic_summary_fallback_after_provider_failure
```

ChatBox 仍返回 `portfolio_summary` 的结构化真实账户结果，摘要来源明确为 `deterministic`；交易请求仍进入 `trade_action_blocked`。

失败分类覆盖 AUTH_FAILED、QUOTA_EXHAUSTED、RATE_LIMITED、TIMEOUT、NETWORK_ERROR、INVALID_RESPONSE、PROVIDER_ERROR，恢复到成功态后连续失败归零。

审计产物：`backend/data/gpt-audit/llm-runtime-observability/2026-10-08T10-37-18-977Z/llm_runtime_observability_audit.json`。

公共状态与日志均只保留固定失败码，不含 API key、Bearer token、request id 或完整 provider 错误。前端构建通过。
