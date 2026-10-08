# 交易事实与计划执行闭环 Schema/API 可实施性审查

**版本**：1.0  
**日期**：2026-10-08  
**状态**：Implemented / Verified（SR-01 至 SR-10 closed）

## 1. 审查结论

本文件记录 P0 时发现的实现歧义和最终决议。SR-01 至 SR-10 已落实到范围迁移、领域服务、REST/MCP 合同和 AC-01 至 AC-20；任何后续改动仍不得通过放宽验收标准绕过这些约束。

## 2. 必须修正的数据模型问题

| 编号 | 当前草案问题 | 风险 | 实施决议 | 验证 |
| --- | --- | --- | --- | --- |
| SR-01 | `PlanExecutionLink.gridOrderDraftId` 必填，但状态包含 `unmatched` | 计划外成交无法留下统一审计记录 | draft 关系改为可空；`unmatched` 必须为 null，其他活动匹配必须非 null | AC-13 + DB CHECK/服务校验 |
| SR-02 | 含可空列的复合 `@@unique` 在 SQLite 中不能阻止多条 NULL 组合 | 并发重试可重复写匹配 | 增加必填、全局唯一的稳定 `linkKey`；复合索引仅用于查询 | AC-12、AC-19 |
| SR-03 | `PlanExecutionLink` 可同时不关联或同时关联委托与成交 | 关系语义不明确 | 强制 `externalOrderObservationId XOR transactionId`；迁移 CHECK + 服务校验 | 负向契约测试 |
| SR-04 | `InvestmentStrategyRun.idempotencyKey` 可空 | 重跑可能复制 StrategyRun/GridPlan | 写入口必须提供或由服务确定性生成非空键；字段改为必填 | AC-07、AC-08、AC-19 |
| SR-05 | `GridOrderDraftEvent` 无幂等键 | 重试可能重复累计 partial/filled | 增加必填 `idempotencyKey` 和 `[gridOrderDraftId,idempotencyKey]` 唯一约束 | AC-11、AC-19、AC-20 |
| SR-06 | `GridPlan` 可同时没有或同时拥有 DailyReviewRun/InvestmentStrategyRun | 计划来源不可证明 | 强制恰好一个来源；现有计划归属 DailyReviewRun，新计划二选一 | AC-07、AC-09、迁移检查 |
| SR-07 | `GridOrderDraft.status` 与“状态从事件派生”并存 | 字段和事件流可能漂移 | 保留字段作为原子更新的状态投影；提供事件重建器及漂移验证 | AC-11、AC-14 |
| SR-08 | 批次直接关联最终实体，没有统一行级实体 | CSV/MCP 行的 duplicate/conflict/blocked 无法审计 | 增加 `TradeIngestionRow`，保存行序号、行哈希、标准化数据、去重键、状态、冲突和结果引用 | AC-01、AC-04、AC-20 |
| SR-09 | 对账运行没有幂等键，显式零成交/零委托只可能藏在 JSON 中 | 覆盖声明不易查证或重复 | 增加非空对账幂等键；批次保存 `coverageKinds`，允许已确认的零行覆盖证明 | AC-05、AC-06 |
| SR-10 | 批次/运行/事件标称不可变，但关系使用 Cascade/SetNull 且现有 Transaction 有 PUT/DELETE | 删除或修改会破坏证据链 | 已确认批次及其事实禁止原地修改/删除；纠错通过新批次和 supersedes 关系；删除 API 对受管事实返回 409 | 审计不可变测试 |

## 3. 数量、价格与状态约束

- `quantity > 0`；价格按资产 tick 规范化，不能直接用浮点全等判断匹配。
- 一条 Transaction 最多只能存在一个 `confirmed` 的人工计划关联，但可存在多个 `suggested` 候选。
- 一条 GridOrderDraft 可关联多笔成交；已确认成交数量累计不得超过草案数量。超量部分保留真实事实并进入 `blocked/unmatched`，不得截断或篡改 Transaction。
- ExternalOrderObservation 可以保留同一券商订单的多次截图观察；去重依据 capture row，聚合依据 externalOrderId。
- `record_only` 必须在写前后验证 Position/Cash 哈希相等；`apply` 必须与 Position/Cash 更新处于同一数据库事务。
- 草案当前状态是事件投影；每次追加事件和更新投影必须在同一事务中完成。
- 终态为 `filled/cancelled/expired/superseded`；终态不得回到活动态。

## 4. 原子性与并发边界

1. 批次确认使用一个数据库事务完成行状态、Transaction/ExternalOrderObservation、Position/Cash 和批次汇总。
2. 事务失败时不允许留下部分业务事实；事务外只记录不影响账户的 failed 诊断。
3. 并发相同幂等键：一个创建，其他返回同一资源；不同内容使用相同键则返回冲突，不能复用错误结果。
4. 人工匹配确认在事务中锁定当前关系集合，确认一个候选时拒绝同一成交的其他候选，并追加事件。
5. SQLite 写锁通过短事务、唯一键和有限重试处理；不得用“先查再写”替代唯一约束。

## 5. REST 合同（实现时固化 OpenAPI）

建议新增统一前缀 `/api/v1/trade-ledger`，现有截图确认与交易导入内部复用同一服务：

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| POST | `/ingestion-batches/preview` | 保存输入、规范化并返回 new/duplicate/conflict |
| POST | `/ingestion-batches/:id/confirm` | 显式确认，要求 idempotencyKey、confirmedBy、positionEffect |
| GET | `/ingestion-batches/:id` | 查询批次、行、覆盖窗口和差异 |
| POST | `/reconciliations` | 运行并保存独立对账 |
| GET | `/reconciliations/:id` | 查询不可变对账证据 |
| GET | `/execution-links/pending` | 查询 suggested/unmatched/blocked |
| POST | `/execution-links/:id/decision` | 人工 confirm/reject，要求确认人 |
| GET | `/plans/:planId/lifecycle` | 返回事件、委托观察、成交、累计与剩余数量 |

现有 `/api/v1/investment-workflow/strategy-runs` 增加 `idempotencyKey` 并返回稳定运行/计划/草案 ID；新增按 ID 查询运行。现有截图 `/confirm` 和 `/transactions/import` 保持兼容，但必须委托给批次服务，不能维护第二套去重逻辑。

所有响应至少包含：`schemaVersion`、`asOf`、`sourceRefs`、`warnings`、四项交易权限锁。确认型写接口还必须返回 `idempotencyKey`、`confirmedBy` 和影响摘要。

## 6. MCP 合同

计划增加：

- `trade_ledger.get_ingestion_batch`
- `trade_ledger.run_reconciliation`
- `trade_ledger.get_reconciliation`
- `trade_ledger.list_pending_matches`
- `trade_ledger.confirm_execution_match`
- `investment_workflow.get_strategy_run`
- `backtest.run_trade_plan_quality_replay`

读取工具使用 read 权限；运行研究/对账使用 async/direct-write 权限但交易锁仍为 false；人工确认匹配使用 confirmed-write 权限。任何工具都不增加券商下单能力。

REST 与 MCP 必须调用同一领域服务，并由 AC-15 证明同一幂等键返回相同运行和计划 ID。

## 7. SQLite 迁移约束

- 不使用当前 schema 对开发库执行全量 `prisma db push`，因为数据库含有 schema 未声明的既有表。
- 编写范围受控的 SQL：只创建新表/索引、增加必要列、重建确需改变约束的 `GridPlan`。
- 迁移先作用于数据库副本；运行 `foreign_key_check`、`integrity_check`、行数及逻辑哈希检查，再验证重复执行行为。
- `Transaction.positionEffect` 回填规则必须显式且可审计：已知 snapshot-included 来源为 `record_only`，其余保持 `apply`；无法判定的记录输出报告，不静默猜测。
- 历史计划网格匹配只生成 suggested/unmatched，不自动 confirmed。

## 8. 审批后实施顺序

1. 先按 SR-01 至 SR-10 修订 schema 草案和迁移脚本。
2. 在临时数据库证明迁移不变量与回滚路径。
3. 实现 TradeIngestionBatch/Row 与 Transaction 原子确认。
4. 实现独立 ReconciliationRun 及策略前置门禁。
5. 实现 StrategyRun/Plan 持久化和生命周期事件。
6. 实现执行匹配、人工确认、REST/MCP 查询。
7. 实现前端证据链展示和三口径回放。
8. 执行 AC-01 至 AC-20 与全量回归。
