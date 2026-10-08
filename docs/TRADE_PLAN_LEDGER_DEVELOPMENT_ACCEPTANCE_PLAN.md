# 交易事实与计划执行闭环开发验收计划

**版本**：1.0  
**日期**：2026-10-08  
**状态**：Approved for controlled implementation / P1-P7 in progress  
**范围**：同花顺截图或文件输入、仓位调整复盘、轮动波动策略、网格历史回放  

## 1. 目标

本阶段把 FAMS 已有的“截图事实、交易记录、人工计划、委托观察”连接为可验证闭环：

```text
宿主视觉/文件/人工输入
  -> 预览、去重、人工确认
  -> 成交与持仓/资金对账
  -> 不可变策略运行与人工计划
  -> 委托/成交匹配与生命周期事件
  -> 历史回放和建议质量评估
```

成功条件不是生成更多建议，而是任何结论都能回答：使用了哪份事实、产生于哪次运行、对应哪条草案、是否真实挂单或成交、是否影响过仓位、是否存在无法解释的差异。

## 2. 固定边界

- 图片优先由宿主识别并提交结构化行；FAMS 不要求重复做视觉识别。
- 没有券商连接，不自动读取账户凭证，不创建、提交、修改或撤销券商订单。
- `formalTradingUnlocked`、`autoTradeUnlocked`、`canCreateOrder`、`orderCreateAllowed` 始终为 `false`。
- 历史成交若已经反映在最新持仓快照中，只保存审计事实，禁止重放仓位和现金。
- 自动匹配只能产生候选；模糊或多候选必须人工确认。
- 不改变 MA、RRG、网格锚点、仓位容量等投资策略规则。
- 不编造缺失成交价、手续费、成交编号或订单状态。

## 3. 当前基线与已确认缺口

| 编号 | 当前事实 | 缺口 | 严重度 |
| --- | --- | --- | --- |
| GAP-01 | `TransactionService` 支持 `positionEffect=record_only` | `Transaction` 没有独立字段保存该语义，只能从 source/notes 推测 | High |
| GAP-02 | 截图确认能写入 Transaction / ExternalOrderObservation | 没有统一采集批次、覆盖窗口和批次级校验结果 | High |
| GAP-03 | DailyReview 保存 GridPlan/GridOrderDraft | 轻量 `run_rotation_volatility_strategy` 的新草案只在响应中返回 | Critical |
| GAP-04 | 网格和成交都已持久化 | GridOrderDraft 与外部委托/Transaction 没有可审计关联 | Critical |
| GAP-05 | BrokerReviewReconciliationService 能做运行前对账 | 对账结果只随复盘报告保存，缺少独立、可查询、可复跑的版本 | High |
| GAP-06 | GridReplay 可读取计划和确认成交 | 无法可靠区分计划内成交、计划外成交和模糊匹配 | High |
| GAP-07 | 独立波动仓支持 VolatilityTradeDraft -> Transaction | 当前账户没有已激活的波动仓草案/分层台账，不能替代通用网格闭环 | Medium |

开发必须先关闭 GAP-01 至 GAP-06；GAP-07 只保证兼容，不擅自激活仓位分层。

## 4. 交付阶段

### 审批门与执行顺序

本计划采用串行质量门，不允许跨阶段提前声明完成：

```text
G0 用户批准本计划（2026-10-08 已完成）
  -> G1 P0 文档/基线审查通过
  -> G2 P1-P2 事实层与对账层通过
  -> G3 P3-P4 计划持久化与执行闭环通过
  -> G4 P5 API/MCP/前端透明化通过
  -> G5 P6 回放与质量评估通过
  -> G6 P7 全量回归与迁移验收通过
```

- 每个质量门必须提供：变更文件、数据迁移影响、自动测试结果、尚存风险、是否可回滚。
- 任一阶段出现持仓、现金、原始交易哈希变化，立即停止后续阶段并从备份恢复验证环境。
- 生产/开发库迁移只在数据库副本演练、幂等复跑和前后哈希通过后执行。
- G0 之前仅允许完善文档和只读审查；不得应用数据库迁移或启用新运行路径。

### P0 文档与基线

- 固化两份工作流规格与四视图注册表。
- 完成 Schema/API 可实施性审查并关闭 SR-01 至 SR-10 的设计歧义。
- 保存迁移前 schema、表行数、持仓/成交/委托哈希。
- 在临时数据库验证现有测试基线；不清理工作区现有修改。

**交付物**：开发前审查、两份工作流规格、表计数与关键数据哈希、既有测试基线报告。  
**退出条件**：风险清单逐项有负责人/控制措施；工作区用户修改被识别且不会被覆盖。

### P1 事实采集批次

- 增加可审计采集批次，记录来源、覆盖窗口、输入哈希、position-effect policy、行数和状态。
- 截图、CSV、MCP 宿主结构化输入使用同一标准化、去重和确认合同。
- Transaction 明确保存 `apply` 或 `record_only`。
- 幂等优先级：成交编号/外部订单号 -> sourceImportKey/captureRow -> 稳定组合指纹。
- 相同键内容冲突必须阻断，不允许静默覆盖。

**交付物**：`TradeIngestionBatch`、显式 `positionEffect`、统一导入合同、冲突报告。  
**退出条件**：AC-01 至 AC-05、AC-19、AC-20 通过；重复导入不改变仓位/现金。

### P2 独立对账运行

- 保存持仓、现金、可卖数量、成交覆盖和委托覆盖的不可变对账结果。
- 输出 `ready / warning / blocked`、差异明细、输入引用和哈希。
- 工作流前检复用最近有效结果；过期或存在阻断时不得生成精确拟单。

**交付物**：`TradeReconciliationRun`、覆盖窗口与哈希、ready/warning/blocked 门禁。  
**退出条件**：AC-05、AC-06 通过；缺证据时只给观察/待确认，不生成伪精确指令。

### P3 策略运行与人工计划统一持久化

- 增加轮动波动策略运行实体，关联 InvestmentResearchSnapshot。
- 轻量 REST/MCP 策略入口将新草案保存为 GridPlan/GridOrderDraft。
- 复用旧计划时只引用旧 plan/order，不复制新草案。
- 新计划通过 `previousPlanId` 保留替代链；旧计划不删除。
- 所有返回包含 `strategyRunId`、`gridPlanId`、`orderDraftId`。

**交付物**：`InvestmentStrategyRun`、策略幂等键、网格版本链、REST/MCP 同源响应。  
**退出条件**：AC-07 至 AC-10、AC-15 通过；同一输入重跑不产生重复计划。

### P4 计划执行生命周期

- 增加人工计划事件台账和计划执行关联。
- 支持一条草案关联多个委托观察或部分成交。
- 匹配顺序：显式 draft id -> 券商/成交编号 -> 唯一组合匹配 -> 候选/未匹配。
- 事件状态：`proposed -> accepted -> submitted -> partially_filled -> filled/cancelled/expired/superseded`。
- 状态从事件派生；禁止把截图观察直接解释为券商真实执行能力。

**交付物**：`GridOrderDraftEvent`、`PlanExecutionLink`、候选匹配和人工确认接口。  
**退出条件**：AC-11 至 AC-14、AC-19、AC-20 通过；部分成交、撤单、过期均可追溯。

### P5 API、MCP 与前端透明化

- REST/MCP 可以读取采集批次、对账运行、策略运行、计划生命周期和待确认匹配。
- 人工确认匹配是显式写操作并要求确认人。
- DailyReviews、RelativeRotation、ScreenshotCapturePanel 展示数据覆盖、position-effect、差异、运行/计划 ID、匹配方式和剩余数量。
- 文案固定说明：计划不等于委托，委托观察不等于成交。

**交付物**：只读查询接口、明确确认型写接口、前端证据/状态/来源展示、MCP README。  
**退出条件**：用户能从页面或 MCP 回答“事实来自哪里、计划哪次生成、是否挂单、是否成交、还差多少”。

### P6 回放与质量评估

- GridReplay 仅把已确认关联的成交计入“实际执行”；未匹配成交单独报告。
- 同时给出计划触发、模拟成交、实际执行三种口径。
- 输出匹配覆盖率、计划执行率、部分成交率、滑点、费用、计划后收益和证据不足原因。

**交付物**：计划/模拟/实际三口径回放、策略质量报告、不可评价原因枚举。  
**退出条件**：AC-16 通过；无确认关联的成交不会进入实际执行收益。

### P7 迁移与回归

- 在数据库副本上演练迁移和回填，再应用兼容迁移。
- 历史 `screenshot_confirmed_snapshot_included` 回填为 `record_only`。
- 历史计划网格匹配只生成 suggested，不自动 confirmed。
- 运行后端、前端、REST、MCP、SQLite、回放、每日复盘和交易隔离回归。

**交付物**：兼容迁移、迁移前后哈希报告、回归报告、spec-vs-reality 终审。  
**退出条件**：AC-01 至 AC-20 全绿，或对任何既有失败提供可复现证据且不掩盖本轮回归。

## 4.1 计划新增/调整的数据实体

| 实体 | 用途 | 关键不变量 |
| --- | --- | --- |
| `TradeIngestionBatch` | 保存一次截图/CSV/MCP 输入批次 | 输入哈希不可改；幂等键唯一；失败可见 |
| `Transaction.positionEffect` | 明确区分 `apply` 与 `record_only` | `record_only` 永不改变 Position/Cash |
| `TradeReconciliationRun` | 保存某一时点的对账证据 | 输入引用、覆盖窗口、结果哈希可查询 |
| `InvestmentStrategyRun` | 保存一次策略计算及版本 | 相同幂等键复用；结果不可原地改写 |
| `GridOrderDraftEvent` | 追加式记录草案生命周期 | 只追加事件；状态由事件派生 |
| `PlanExecutionLink` | 关联草案、委托观察、成交 | 自动匹配仅 suggested；confirmed 要有证据/确认人 |

数据库命名以实现前 schema 审查结果为准，但上述语义和不变量不得弱化。

## 4.2 接口边界

计划新增或统一以下能力，具体路径在 P0 接口审查后固化：

- 事实层：创建/预览/确认采集批次，查询批次和冲突。
- 对账层：运行和查询对账，读取阻断/警告理由。
- 策略层：运行轮动波动策略，按 ID 查询不可变运行和计划网格。
- 执行层：查询待匹配事件、确认/拒绝匹配、查询订单草案生命周期。
- 回放层：按计划版本运行三口径回放并返回质量指标。
- MCP 写操作只限“记录用户确认”；不得调用券商或创建真实订单。

所有响应至少包含 `schemaVersion`、`asOf`、`sourceRefs`、`warnings`；可写请求包含 `idempotencyKey` 和确认人。

## 5. 数据与状态合同

### 采集批次

`staged -> preview_ready -> confirmed -> reconciled`，任何阶段可进入 `failed`；已确认批次不可删除或改写输入哈希。

### 匹配状态

- `suggested`：规则给出单一或多个候选，尚未人工确认。
- `confirmed`：显式 draft id 或用户确认的唯一关系。
- `rejected`：用户否认候选关系。
- `unmatched`：当前没有合理计划候选。

### 对账门禁

- `ready`：持仓与成交覆盖新鲜，关键等式成立。
- `warning`：订单截图缺失或存在非阻断差异，新增前需要人工查重。
- `blocked`：持仓/资金字段缺失、成交覆盖缺失、冲突成交或无法解释的数量变化。

## 6. 迁移不变量

1. 原有 Transaction 数量、价格、费用、时间、amount 不变。
2. 原有 Position 数量、成本、市值、现金不因迁移改变。
3. 原有 GridPlan/GridOrderDraft 不删除。
4. 重复运行迁移结果一致。
5. 回填失败时回滚本次 schema/data 变更，不删除既有数据。
6. 所有破坏性验证只在临时数据库执行。

## 7. 自动验收矩阵

| 编号 | 场景 | 必须结果 |
| --- | --- | --- |
| AC-01 | 同一截图/文件重复导入 | 0 个重复 Transaction，仓位/现金哈希不变 |
| AC-02 | `record_only` 成交确认 | 新增审计记录，Position/Cash 不变，字段可直接查询 |
| AC-03 | `apply` 成交确认 | 仓位只变化一次，重复请求幂等 |
| AC-04 | 相同成交编号内容冲突 | 批次/行 blocked，无静默覆盖 |
| AC-05 | 明确零成交 | 对账成交覆盖通过，并保存显式确认事实 |
| AC-06 | 无成交截图也无零确认 | 精确拟单 blocked |
| AC-07 | 轻量轮动策略新草案 | StrategyRun、GridPlan、GridOrderDraft 均可查询 |
| AC-08 | 相同策略幂等键 | 复用同一运行，不重复计划网格 |
| AC-09 | 复用有效旧计划 | 返回旧 ID，不复制订单 |
| AC-10 | 新计划替代旧计划 | previousPlanId 和 superseded 事件完整 |
| AC-11 | 一条计划两笔部分成交 | 聚合数量正确，先 partial 后 filled |
| AC-12 | 多个计划网格均可能匹配 | 只生成 suggested，不自动 confirmed |
| AC-13 | 计划外真实成交 | Transaction 保留并标记 unmatched/unplanned |
| AC-14 | 委托撤销/过期 | 追加事件，原计划与历史观察保留 |
| AC-15 | REST/MCP 同一运行 | 返回相同运行、计划和边界字段 |
| AC-16 | 历史回放 | 区分计划、模拟、实际，报告匹配覆盖率 |
| AC-17 | 迁移 | 前后持仓、现金、原始交易哈希完全一致 |
| AC-18 | 交易边界 | Transaction 只来自明确确认；外部订单创建数始终为 0 |
| AC-19 | 并发重复确认 | 一个成功或幂等复用，不能双写 |
| AC-20 | 部分写入失败 | 数据库事务回滚，批次可见 failed 原因 |

## 8. 回归命令范围

- 后端 `npm run build`
- 前端 `npm run build`
- 新增 `test:trade-plan-ledger`
- `test:position-consistency`
- `test:daily-review-workflow`
- `test:daily-review-v3-grid-contract`
- `test:daily-review-frontend-contract`
- `test:investment-workflow-rotation-strategy`
- `test:investment-workflow-mcp`
- `test:volatility-mcp`
- `test:grid-replay-v2`
- `test:sqlite-writer-lock`
- `test:ftr-5-execution-isolation`
- `run:full-system-e2e-acceptance`

任何失败都必须区分：本轮回归、新发现的既有失败、外部数据/网络不稳定。不得以缩小测试范围替代修复。

## 9. 完成定义

只有 AC-01 至 AC-20 全部有可重复的自动证据，迁移不变量成立，前后端构建及关键回归通过，且页面/MCP 对人工计划和真实成交的区别清晰可见时，本阶段才可标记完成。
