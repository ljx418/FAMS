# S2 Wave B 失败与重规划

日期：2026-09-11

## 首次失败

```text
command=FAMS_REAL_E2E_REQUIRE_LLM=1 npm run test:daily-review-real-data-e2e
result=FAIL
failureCategory=stale_acceptance_fixture_assumption
expectedNonCashPositionCount=6
actualNonCashPositionCount=14
businessExecutionStarted=false
protectedAccountMutationDetected=false
```

失败发生在运行前基线断言，尚未创建本轮 DailyReview。真实账户持仓数量已经变化，验收脚本仍把历史 6 个持仓写成固定规格，违背 PRD 的“覆盖当前全部非现金持仓”要求。

## 修订方案

1. 删除固定数量 6，仅要求当前至少存在一个非现金持仓。
2. 保留并继续强化动态覆盖合同：`成功资产数 + 明确失败资产数 = 运行前全部非现金持仓数`。
3. 保留 symbol 集合逐项相等、每个失败项有原因、至少一个真实资产成功、保护表前后哈希一致。
4. 重新从头执行真实 E2E，并把当前覆盖数量作为本轮证据，不修改账户事实以迎合旧 fixture。

```text
replanDecision=APPROVED_FOR_RETRY
fatalSpecificationDeviationCount=0
majorFalseAcceptanceRiskClosedByDynamicCoverage=true
```

## 第二次失败与 provider 切换

移除固定数量假设后，真实业务计算进入 LLM 门禁，但首选 DeepSeek 返回 HTTP 402 `Insufficient Balance`。系统按规格降级为 deterministic fallback，强制 LLM 模式据此将 DailyReview 标记为 failed；该结果不得验收为通过。

本地配置审计确认 MiniMax 凭据存在，且 `dailyReviewSynthesisService` 已实现受控 MiniMax provider。下一次重验仅通过进程环境切换 `FAMS_LLM_PROVIDER=minimax`，不修改业务结果、不关闭强制 LLM 门禁、不输出任何密钥。

```text
secondAttempt=FAIL
failureCategory=external_provider_balance
deepseekHttpStatus=402
fallbackCorrectlyBlocked=true
alternateConfiguredProvider=minimax
retryPolicy=switch_to_configured_provider_and_rerun_full_e2e
```

## 第三次失败与模式显式化

MiniMax 强制汇总已真实通过，业务运行状态为 completed，但 API 当前默认 `brokerWorkflow=true`，只处理已确认券商持仓。全账户 E2E 未显式传入模式，导致报告覆盖 6 个券商标的而运行前保护快照包含 14 个全部非现金持仓。

重验请求必须显式设置 `brokerWorkflow=false`。这是调用合同修复，不降低“覆盖当前全部非现金持仓”的验收标准，也不改变产品默认券商工作流。

```text
thirdAttempt=FAIL
failureCategory=implicit_api_mode_drift
brokerWorkflowRunStatus=completed
minimaxStrictLlmGate=passed
fullAccountCoverage=failed_6_of_14
repair=explicit_brokerWorkflow_false_in_full_account_e2e
```
## 第四次失败：支付宝验收绑定旧快照

- 失败：历史脚本硬编码旧截图 ID、总额、持仓金额和草案金额，当前已确认快照更新后必然失败。
- 风险：直接替换为新的金额字面量仍会在下次真实数据变化时产生同类 false negative，并可能把私有账户明细带入公开仓库。
- 重规划：新增动态“当前账户研究合同”测试，从最新已确认快照读取基线，验证账实精确对账、5/25/25/45 分桶、严格 LLM、持久化研究比较、人工计划草案和受保护交易表零变化。
- 公开证据：仅记录日期、行数、覆盖数、状态和锁定边界；不记录金额、标的或内部 ID。

## 第五次失败：快照变化分支的时间语义错误

- 失败：新动态合同把 `portfolioChangedSinceLastCapture=true` 一律视为应阻断。
- 实际规格：若已确认快照晚于上一轮复盘，说明用户已经提供新快照，此时允许运行；仅当本轮复盘后用户再次声明变化但未提供更新快照时阻断。
- 修复：按“最新快照时间 > 上一轮复盘时间”动态判断首次结果；完成本轮复盘后再次执行变化声明，要求 `new_alipay_portfolio_capture_required`。
- 数据影响：失败发生在调用业务执行前，未创建复盘、建议、交易或外部订单记录。

## 第六次失败：真实 LLM 数字叙述合同拒绝

- 失败：真实行情、组合比较和资产分析均完成，但 MiniMax 首次响应触发 `llm_numeric_narrative_rejected`。
- 正确行为：严格 LLM gate 将报告标记为 failed，未用 deterministic fallback 冒充真实模型通过。
- 重规划第一步：通过产品已有 `retryLlm` 工作流最多重试两次；每次重试仍执行同一输出合同，不放宽数字叙述约束。
- 复验结果：三次相同提示均被同一规则拒绝，判定为系统性提示冲突，而不是瞬时模型抖动。
- 重规划第二步：模型输入改为定性状态投影，只提供分桶触发状态、草案状态、轮动门禁、流水存在性和证据引用；金额、比例、日期及内部版本号继续由确定性区域展示，不进入 LLM 摘要提示。
- 退出规则：受控重试后必须为 `source=llm`、`llmGate.passed=true`、`readyForHumanReview=true`；否则 Wave B 继续失败。

## 第七次失败：真实 LLM 完成长度不足

- 失败：定性输入修复后不再触发数字叙述拒绝，但 MiniMax 推理与结构化响应达到原两千 token 完成上限，返回 `llm_request_failed`。
- 修复：完成上限提高到四千 token；输出 schema、字段长度上限和无数字叙述验证保持不变。
- 重试策略：仅 `llm_numeric_narrative_rejected / llm_request_failed / llm_json_invalid / llm_schema_invalid` 可最多重试两次；其他失败立即终止。
- 退出规则：最终必须是实际 LLM 结构化结果，deterministic fallback 不得进入验收通过证据。

## 第八次失败：测试读取了错误的边界字段路径

- 失败：真实复盘、严格 LLM 和持久化组合比较均已完成，测试却从精简比较摘要读取不存在的 `executionBoundary`。
- 修复：零外部订单断言改为读取权威 `workflowContract.contract.executionBoundary`；比较摘要单独断言完整禁止动作集合。
- 风险控制：修订只校正字段所有权，没有删除交易隔离断言；受保护表前后计数仍必须完全一致。

## 审计意见

以上失败均已打回测试设计或运行配置层重规划；没有降低真实数据、严格 LLM 或交易隔离门槛。动态合同复验通过前，Wave B 不得声明完成。
