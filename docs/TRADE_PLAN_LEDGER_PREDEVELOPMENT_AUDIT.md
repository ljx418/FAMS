# 交易事实与计划执行闭环开发前审查

**日期**：2026-10-08  
**结论**：本文件保留开发前基线；用户已于 2026-10-08 批准受控实现，P0-P7 随后全部完成并通过专用验收。完成证据见 `audits/2026-10-08-trade-plan-ledger/README.md`。

> 关闭说明：下文是迁移前的时点事实，不应被改写成迁移后现状。原有 FTR-5 hash drift 已在审查实际源码后重新冻结，`backend/data/gpt-audit/formal-release-readiness/FTR-5/2026-10-08T07-42-42-403Z` 的执行隔离验证通过。

## 审查范围

- `transactionRoutes` / `TransactionService`
- `ScreenshotCaptureService`
- `BrokerReviewReconciliationService`
- `DailyReviewService`
- `InvestmentWorkflowService` / `RotationVolatilityStrategyService`
- `GridReplayService`
- Prisma schema、MCP registry、DailyReviews、RelativeRotation 与截图面板

## 代码现实

1. `/transactions` 支持手工创建与文件导入；截图确认也能创建 Transaction。
2. `record_only` 的运行语义正确，但 schema 没有独立持久字段。
3. DailyReview 每次创建 GridPlan/GridOrderDraft、快照与 Advice，完整保留上一版引用。
4. 轻量轮动策略仅创建 InvestmentResearchSnapshot；新 `manualOrderDrafts` 没有持久化。
5. ExternalOrderObservation 只关联截图行，Transaction 只关联 AdviceAction 或 VolatilityTradeDraft；通用 GridOrderDraft 无执行关系。
6. BrokerReviewReconciliationService 使用标的、日期、数量和价格容差检查历史成交，但结果不是独立版本化实体。
7. GridReplay 已具备保存时点、有效期、父子单、T+1、费用和滑点规则；实际成交仍缺计划级可靠关联。
8. 当前工作区已有大量用户修改和未跟踪文件。本阶段不得重置、覆盖或整理无关修改。

## 数据基线（开发库，包含验收/测试数据）

| 实体 | 行数 |
| --- | ---: |
| Transaction | 141 |
| DailyReviewRun | 82 |
| GridPlan | 1299 |
| GridOrderDraft | 926 |
| Advice | 196 |
| AdviceAction | 1752 |
| ExternalOrderObservation | 63 |
| VolatilityTradeDraft | 0 |
| PositionSleeveLedgerEntry | 0 |

这些数字只用于迁移前后完整性比较，不能解释为纯实盘账户统计。

### 只读哈希基线

采集时间：2026-10-08（Asia/Shanghai）。命令使用 `sqlite3 -readonly`，没有执行业务写入。

| 对象 | SHA-256 |
| --- | --- |
| Transaction（按 id 排序） | `de17d37562ad188a43550fdaa83248521e0d5673e35077fbf6209ede523539f3` |
| Position（按 id 排序） | `87d47b3537f4223c04877e7ae237ebc6ba17e3ec633af8e2e2156ac58197c9ef` |
| GridPlan（按 id 排序） | `877248cc3e35785e4b0aa537373ce888634b332764921128ff9549c81cade638` |
| GridOrderDraft（按 id 排序） | `0d3f0d34ce0f419765f0835a537a59f913937f6820276f0074b8008915a5c9ce` |
| ExternalOrderObservation（按 id 排序） | `9df5a0b28c7175635526e469a5a862288d694be16ce82117f5ca2fe6b7230c74` |
| `backend/prisma/dev.db` 文件 | `596be5ef21c71f5b5945cf2ef0b50fd4af2d1d5db8ff0a5eadc79c1b8987d68f` |

迁移验收至少重新计算上述五张业务表的逻辑哈希；数据库文件哈希会因 schema 和 SQLite 元数据变化而变化，只用于证明当前原始副本身份，不能作为迁移后应相等项。

### Schema 草案状态

- 当前 `backend/prisma/schema.prisma` 相对 Git 基线存在 `+236/-8` 的未提交草案差异，其中包含本计划的数据模型设想，也混有本轮之前的工作区修改。
- `prisma validate` 已通过，只能证明声明语法有效，不能证明迁移安全或运行完成。
- 尚未对 `backend/prisma/dev.db` 应用本计划迁移，也未执行 `prisma db push`。
- 正式实现必须使用范围受控的兼容迁移；禁止依据全量 schema diff 删除当前数据库中未被 Prisma schema 声明的表。

### 开发前构建与回归基线

所有可能写数据库的测试均指向 `/tmp` 中的 `dev.db` 副本。测试完成后，真实 `backend/prisma/dev.db` 的 SHA-256 仍为 `596be5ef21c71f5b5945cf2ef0b50fd4af2d1d5db8ff0a5eadc79c1b8987d68f`，核心行数仍为 Transaction 141、Position 27、GridPlan 1299、GridOrderDraft 926、ExternalOrderObservation 63。

| 检查 | 基线结果 | 证据摘要 |
| --- | --- | --- |
| Prisma schema validate | PASS | schema 声明语法有效 |
| 后端 `npm run build` | PASS | TypeScript 编译通过 |
| 前端 `npm run build` | PASS with warnings | Vite 构建通过；存在既有 Browserslist 过期和大 chunk 提示 |
| `test:position-consistency` | PASS | 隔离 HTTP 服务；positions=16、totalValue=623847.08、bins=7 |
| `test:daily-review-v3-grid-contract` | PASS | 价格步长、手数、预算、父卖单回补和 0 个券商订单通过 |
| `test:daily-review-frontend-contract` | PASS | 无交易动作、共享截图面板和均线/RRG 展示合同通过 |
| `test:investment-workflow-rotation-strategy` | PASS | 确定性回放、旧计划复用和四项交易锁通过 |
| `test:grid-replay-v2` | PASS | 十类 fixture 及四个真实标的证据不足分支通过 |
| `test:ftr-5-execution-isolation` | FAIL（既有基线） | `backend/src/routes/portfolioBacktest.ts` 实际 hash `df9051...edf8`，审计期望 `c89c31...cb7b` |

`test:ftr-5-execution-isolation` 的失败发生在本计划业务实现之前。正式回归不得忽略或改写该结果；P7 必须审查 `portfolioBacktest.ts` 的实际变化，在不覆盖用户修改的前提下更新实现或审计清单，并重新证明执行隔离。

## 高风险分支

| 风险 | 后果 | 必须控制 |
| --- | --- | --- |
| 历史成交重放 | 仓位/现金被重复扣加 | positionEffect 显式字段、迁移回填、哈希验收 |
| 重复截图/并发确认 | 双写成交或重复改变仓位 | 唯一键、稳定指纹、事务和幂等返回 |
| 模糊计划匹配 | 把计划外成交错算为策略执行 | suggested/confirmed 分离，歧义人工确认 |
| 新计划覆盖旧计划 | 无法回测当时真实建议 | 追加新版本和 superseded 事件，禁止删除 |
| 轻量策略只返回响应 | 对话结束后计划丢失 | StrategyRun + GridPlan 持久化 |
| 对账结果只嵌在报告 | 无法独立验证数据覆盖 | 独立 ReconciliationRun |
| 验收污染用户数据库 | 实盘事实被测试修改 | 临时数据库和前后哈希检查 |

## 文档与实现约束

- 规格：`TRADE_PLAN_LEDGER_DEVELOPMENT_ACCEPTANCE_PLAN.md`
- Schema/API 审查：`TRADE_PLAN_LEDGER_SCHEMA_API_REVIEW.md`
- 工作流：`workflows/WORKFLOW-trade-fact-ingestion-reconciliation.md`
- 工作流：`workflows/WORKFLOW-trade-plan-execution-lifecycle.md`
- 注册表：`workflows/REGISTRY.md`
- 开发后按上述规格逐项形成 spec-vs-reality 审计；未覆盖项不得标记通过。
