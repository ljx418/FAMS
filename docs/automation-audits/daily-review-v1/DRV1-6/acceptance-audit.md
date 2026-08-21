# DRV1-6 一次性 LLM 证据汇总验收审计

日期：2026-08-21
结论：`REAL_RUN_PENDING — CODE_AND_NEGATIVE_CONTRACT_PASS`

## 已通过

- `DailyReviewSynthesisService` 复用统一 FAMS LLM 配置，支持 OpenAI、OpenAI-compatible、DeepSeek 和 MiniMax；选择单一供应商后只执行一次请求，不进行失败后的跨供应商重试。
- 严格 JSON schema、标的白名单、evidenceRefs 子集和叙述数字门禁专项测试通过。
- LLM 未配置、供应商失败、超时或越权时保存 deterministic fallback、attempted、attemptCount 和脱敏 failureCode。
- 汇总在确定性 decisionSummary 之后生成；完成时间移到汇总之后。GET、页面刷新和导出路径没有 LLM 调用代码。
- 后端构建及 `test:daily-review-v2-contract` 通过。

## 真实供应商与持久化状态

- 既有运行曾观察到当前 DeepSeek 凭证返回 HTTP 402/余额不足；这是外部供应商状态，系统应按 PRD 进入 fallback。
- MiniMax 路径已完成类型构建，但本阶段没有在主库损坏后继续发起付费真实请求。
- SQLite 主库已恢复并通过复检；恢复后尚未生成新的默认组合 v2 复盘，因此“每轮最多一次并持久化、刷新零新增请求”的真实运行证据仍未完成。

未关闭重大产品代码偏差：0。
未关闭重大基础设施风险：0。
外部供应商降级风险：1（有定义 fallback，不解锁交易，不作为致命偏差）。
