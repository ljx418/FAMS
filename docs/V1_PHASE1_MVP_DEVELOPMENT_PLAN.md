# V1.0 Phase 1 MVP Development Plan

## 1. 目标

第一阶段只做“可信投资账本”，不做完整智能投顾系统。

用户完成资产导入或手动录入后，系统必须能稳定回答：

- 我持有什么资产。
- 每个资产的价格来源和更新时间是什么。
- 当前市值、成本、盈亏和仓位是多少。
- 资产属于哪些类型和标签。
- 我做过哪些买入、卖出、现金、费用和分红动作。
- 哪些资产触发了基础止盈止损提醒。

对应开发图见 `docs/v1-phase1-mvp-development-plan.drawio`。

## 2. 核心闭环

```text
资产导入/编辑
  -> 资产主数据归一化
  -> 行情补全
  -> 仓位和盈亏计算
  -> 标签维护
  -> 基础交易记录
  -> Dashboard / 资产详情 / 告警展示
```

第一阶段保留现有 MCP、Agent、Workflow 路由，但不把它们作为主线交付物。AI 建议、建议确认、月度回测、DomainPack 和 harnessOS 编排进入后续阶段。

## 3. 后端开发范围

### 资产与主数据

- 复用现有 `Asset`、`Position`、`Transaction`、`PriceHistory`、`Tag`、`AssetTag` 模型作为第一阶段基础。
- 明确 `Asset` 表表达标的基础信息，不把技术指标、基金穿透、财报、消息面等扩展数据塞进资产主表。
- 支持股票、基金、黄金、现金四类资产的创建、编辑、查询和导入。
- 导入时做最小归一化：代码、名称、资产类型、币种、交易所、数量、成本价、标签。

### 行情补全

- 抽象 `MarketDataService` 或收敛现有 `priceService` 为统一入口。
- 对外部 Provider 返回结果统一成 Quote DTO：代码、价格、币种、来源、更新时间、可信状态、警告信息。
- 写入 `Asset.lastPrice`、`Asset.lastUpdated` 和 `PriceHistory`。
- 外部数据源失败时返回可展示的警告，不中断资产和仓位页面的基础可用性。

### 仓位计算

- 统一由 `PositionService` 计算数量、平均成本、市值、成本、浮动盈亏、已实现盈亏。
- 区分当前实际仓位和成本仓位：
  - 当前实际仓位 = 当前市值 / 当前总资产。
  - 成本仓位 = 持仓成本 / 总投入成本。
- Dashboard、Positions、Assets 复用同一套计算结果，避免前端重复算口径。

### 交易记录

- `Transaction` 覆盖 `buy`、`sell`、`dividend`、`fee`、`deposit`、`withdraw`。
- 买入和卖出交易更新对应持仓数量、平均成本、成本基础、已实现盈亏。
- 现金类交易进入交易流水，用于后续总资产和现金仓位计算。
- 第一阶段不强制交易关联 AI 建议，后续由 `advice_action_id` 或等价关联字段补齐。

### 标签与告警

- 标签优先复用 `Tag` 和 `AssetTag`，保留 `Position.tags` / `Position.labels` 兼容旧数据，但新逻辑优先使用关系表。
- 自动标签只做确定性建议，例如资产类型、市场、行业；用户可手动修改。
- 止盈止损第一阶段允许继续使用 `Position.stopLoss` 和 `Position.takeProfit`，并生成基础 `Alert`。
- V1.5 再迁移到通用 `AlertRule` 和 `AlertEvent`。

## 4. 前端开发范围

### Assets

- 支持表格导入、手动新增、编辑、删除和标签维护。
- 资产代码可跳转股票或基金详情页。
- 列表展示价格、价格来源、更新时间、市值、成本、盈亏和标签。
- 行情刷新失败时显示警告状态，不隐藏资产行。

### Positions

- 展示资产类型层、标签层和标的层三类仓位视角。
- 同时展示当前实际仓位、成本仓位、市值、成本和盈亏。
- 数据从后端计算结果读取，前端只做展示和轻量汇总。

### Transactions

- 支持买入、卖出、现金存取、费用、分红的手动录入。
- 展示交易状态、金额、费用、执行时间和备注。
- 交易保存后刷新仓位和 Dashboard 汇总。

### Dashboard 与详情页

- Dashboard 展示总资产、市值、成本、盈亏、现金仓位、资产类型分布和关键告警。
- 股票/基金详情页第一阶段只要求展示已有基础信息、价格趋势和持仓摘要。
- 技术指标、基金持仓穿透、估值分位和消息面作为后续增强，不阻塞第一阶段验收。

## 5. REST API 验收接口

第一阶段必须稳定这些 REST 能力：

- `POST /api/v1/assets/import`：导入资产表格。
- `POST /api/v1/assets`、`PATCH /api/v1/assets/:id`：创建和编辑资产。
- `POST /api/v1/prices/refresh`：刷新一个或多个资产价格。
- `GET /api/v1/positions`：返回后端统一计算的仓位结果。
- `POST /api/v1/transactions`：创建交易并更新持仓。
- `GET /api/v1/tags`、`POST /api/v1/tags`：维护标签。
- `GET /api/v1/alerts`：返回基础止盈止损告警。

具体路径可以复用现有路由命名；如实现中已有等价路径，优先保持兼容，不为命名重构打断 MVP。

## 6. 验收标准

- 用户能导入或手动创建股票、基金、黄金、现金资产。
- 用户能刷新价格，并看到价格来源、更新时间和失败警告。
- 系统能计算总市值、成本、盈亏、当前实际仓位和成本仓位。
- 用户能维护标签，并按资产类型、标签、标的查看仓位。
- 用户能录入买入、卖出、现金存取、费用、分红交易，交易后仓位同步变化。
- 用户能从资产列表跳转股票或基金详情页。
- 用户能设置基础止盈止损，并在触发时看到告警。
- MCP、Agent、Workflow 占位入口不影响普通 REST 模式使用。

## 7. 延后范围

- AI 结构化建议、建议确认和建议执行差异记录。
- Advice、AdviceAction、AdviceInputSnapshot 完整模型。
- 月度 AI 建议收益 vs 实际执行收益回测。
- 基金持仓穿透估值、复杂技术指标全量后端计算、消息面分析。
- PostgreSQL 迁移、Redis、BullMQ、TimescaleDB。
- FAMS DomainPack、MCP stdio provider、harnessOS 多 Agent 编排。
