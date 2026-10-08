# 交易事实与计划执行闭环：最终实现与验收审计

**审计日期**：2026-10-08  
**范围**：P0-P7、G0-G6、AC-01 至 AC-20  
**结论**：专项目标已实现并通过验收；真实下单能力继续锁定。

## 1. Spec vs Reality

| 能力 | 实际实现 | 结果 |
| --- | --- | --- |
| 事实采集 | `TradeIngestionBatch` + `TradeIngestionRow`；截图、文件和宿主结构化行统一分阶段确认 | PASS |
| 仓位影响 | `Transaction.positionEffect` 显式保存 `apply|record_only`；历史快照内成交不重放 | PASS |
| 独立对账 | `TradeReconciliationRun` 保存覆盖、差异、输入哈希和 ready/warning/blocked | PASS |
| 策略运行 | `InvestmentStrategyRun` 保存不可变输入/输出；同幂等键复用 | PASS |
| 计划版本 | 新计划关联 `previousPlanId`；旧计划只追加 superseded 事件，不删除 | PASS |
| 执行生命周期 | `GridOrderDraftEvent` 追加式事件，`PlanExecutionLink` 保存 suggested/confirmed/rejected/unmatched | PASS |
| 接口 | REST、workflow/volatility MCP 和前端展示批次、运行、计划、匹配与剩余数量 | PASS |
| 回测 | Grid Replay v3 分离计划触发、模拟成交和已确认实际执行 | PASS |
| 交易边界 | 无券商连接；四项交易权限始终为 false；确认匹配只写本地审计关系 | PASS |

## 2. 迁移证据

- 范围 SQL：`backend/prisma/manual-migrations/20261008_trade_plan_ledger.sql`。
- 迁移器：`backend/scripts/apply-trade-plan-ledger-migration.ts`。
- 应用前一致性备份：`backend/prisma/dev.db.pre-20261008_trade_plan_ledger-1791443790008.bak`，大小 1,160,171,520 bytes。
- 真实开发库首次应用成功；重复执行返回 `already_applied`。
- `integrity_check=ok`，`foreign_key_check=[]`。
- 迁移保持历史 Transaction、Position、GridPlan、GridOrderDraft、ExternalOrderObservation 经济事实不变；历史 926 条 GridOrderDraft 只补 proposed 事件，不生成 confirmed 成交归因。
- FTR-5 源码 hash drift 已经人工审查后重新冻结；证据目录：`backend/data/gpt-audit/formal-release-readiness/FTR-5/2026-10-08T07-42-42-403Z`。

## 3. AC-01 至 AC-20

`npm run test:trade-plan-ledger` 在 SQLite 一致性备份副本执行，20 项全部通过：

- AC-01~04：重复导入、record_only、apply 幂等、外部编号冲突。
- AC-05~06：显式零成交覆盖和缺证据阻断。
- AC-07~10：策略/计划持久化、运行幂等、旧计划复用、替代链。
- AC-11~14：部分成交、歧义候选、计划外成交、撤销/过期。
- AC-15~16：REST/MCP 同源服务和三口径回放。
- AC-17~20：迁移不变量、零券商订单、并发幂等、事务回滚与 failed 诊断。

## 4. 回归结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 后端 TypeScript build | PASS | 新 schema、服务、路由和 MCP 编译通过 |
| 前端 production build | PASS with existing warnings | 仅 Browserslist 和大 chunk 提示 |
| `test:trade-plan-ledger` | PASS | AC-01 至 AC-20 |
| `test:investment-workflow-rotation-strategy` | PASS | 真实日线、运行/计划幂等和交易锁 |
| `test:grid-replay-v2` | PASS | 当前已升级为 v3 合同；四个真实标的诚实返回证据不足 |
| `test:investment-workflow-mcp` | PASS | memory/stdio/HTTP；workflow 29 tools |
| `test:volatility-mcp` | PASS | memory/stdio/HTTP；volatility 25 tools |
| `test:position-consistency` | PASS | positions=16、totalValue=623847.08、bins=7 |
| Daily Review 三项合同 | PASS | workflow、v3 grid、frontend contract |
| `test:daily-review-real-data-e2e` | PASS | 14 个非现金持仓覆盖；受保护的 Position/Transaction/ExternalOrderObservation 哈希不变 |
| `test:volatility-draft-safety` | PASS | 19 项；Position/Transaction/ExternalOrderObservation 不变 |
| SQLite health / writer lock | PASS | 完整性和单写者保护通过 |
| FTR-5 execution isolation | PASS | 重新冻结后合同与执行隔离通过 |

全系统宽口径报告保留了失败和重规划历史。最终自动化复跑位于
`backend/data/gpt-audit/full-system-e2e/2026-10-08T08-51-48-221Z`：文档审计、代码映射、
16/16 自动 PRD 行、命令矩阵、真实 API、39 张 Headless 截图和浏览器控制台均通过；总体状态为
`blocked`，唯一原因是集中人工核验尚未执行。此前失败轮次没有删除：它们分别暴露了服务启动顺序、
数据库重任务并发、readiness 旧断言和全量报告旧口径问题。严格交易命令的非零退出是预期门禁成功，
不代表回归失败。

## 5. 可用接口

- REST：`/api/v1/trade-ledger/ingestion-batches/:id`、`/reconciliations`、`/execution-links/pending`、`/execution-links/:id/decision`、`/plans/:planId/lifecycle`。
- MCP：`trade_ledger.get_ingestion_batch`、`run_reconciliation`、`get_reconciliation`、`list_pending_matches`、`confirm_execution_match`、`get_plan_lifecycle`。
- 策略：`investment_workflow.get_strategy_run`；运行轮动波动策略会保存 StrategyRun/GridPlan/GridOrderDraft。
- 回放：`backtest.run_grid_replay`（兼容别名 `backtest.run_trade_plan_quality_replay`）。

## 6. 有意保留的限制

1. 系统只产生本地人工计划，不连接同花顺或其他券商，不自动挂单、撤单或成交。
2. 自动匹配只生成候选；模糊匹配必须由用户确认。
3. 既有真实成交尚无 confirmed 计划归因时，不纳入实际执行绩效；这会使真实回测返回 `insufficient_attribution`。
4. 缺少分钟行情时，不倒推出日内触发顺序；回放返回 `insufficient_evidence`。
5. 以上证据可检验建议执行质量，但当前数据不能证明策略未来盈利，也不能替代投资判断。
