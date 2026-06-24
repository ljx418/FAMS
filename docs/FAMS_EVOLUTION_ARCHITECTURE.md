# FAMS 整体演进架构设计

## 1. 背景与目标

FAMS 当前是一个金融资产管理应用，已经具备前端页面、Fastify 后端、Prisma 数据模型、资产/仓位/交易/分析/组合/回测等领域服务雏形，以及 HTTP 形式的 MCP/Agent/Workflow 路由。

目标不是只把它做成一个资产看板，而是逐步演进成一个可被 harnessOS 编排的投资管理 DomainPack：

- 用户平面先完成稳定可用的资产、仓位、交易、分析建议、回测和组合管理功能。
- 各核心领域能力后续通过 Connect 层和 MCP tool contract 对 Agent 开放。
- harnessOS 负责跨领域工作流注册、Connector 执行、多 Agent 协作和主 Agent 汇总。
- 前端最终支持双模式：普通操作模式 + 主 Agent 编排模式。

## 2. 版本命名规范

顶层演进版本统一命名为：

- `V1.0`：用户功能与 REST/DTO 接口固化。
- `V2.0`：FAMS DomainPack 与 Connect 层。
- `V3.0`：harnessOS 工作流注册与端到端编排。

`PhaseX` 后续只表示某个大版本内部的开发阶段，不再表示顶层演进阶段。

示例：

- `V1.0 Phase 1`：资产与交易闭环。
- `V1.0 Phase 2`：分析建议与前端优化。
- `V2.0 Phase 1`：tool contract 固化。
- `V2.0 Phase 2`：stdio MCP provider。
- `V3.0 Phase 1`：connector 注册。
- `V3.0 Phase 2`：workflow DAG 联调。

## 3. 当前架构基线

当前实现基线见：

- `docs/current-architecture.drawio`
- `docs/ARCHITECTURE_CURRENT_TARGET.md`

当前关键事实：

- 前端：React 18 + Vite + TypeScript，包含 Dashboard、Assets、Positions、Transactions、Analysis、Backtest、Portfolios、Stock/Fund Detail 等页面。
- 后端：Fastify + TypeScript，入口为 `backend/src/index.ts`，API 前缀为 `/api/v1`。
- 数据层：Prisma + SQLite，当前 schema 位于 `backend/prisma/schema.prisma`。
- AI/Agent surface：当前有 `/api/v1/mcp`、`/api/v1/agents`、`/api/v1/workflows`，但 workflow 执行仍偏模板和占位。
- 外部数据：Yahoo Finance、Eastmoney、Sina、LLM provider；`server.py` 是独立 FastAPI + akshare 股票分析原型。

## 4. 目标架构总览

目标架构分为四个平面：

```text
User Plane
  React 前端
  普通操作模式 + 主 Agent 编排模式
        |
        | V1.0: REST API + DTO
        v
FAMS Application Plane
  Fastify API
  Domain Services
  Database
        |
        | V2.0: Connect Layer + DomainPack + MCP
        v
FAMS Connect Plane
  FAMS DomainPack
  Tool Contracts
  HTTP MCP Bridge
  stdio MCP Provider
        |
        | V3.0: harnessOS connector / pack / workflow registration
        v
harnessOS Orchestration Plane
  Connector Registry
  DomainPack Registry
  Workflow Registry
  Multi-Agent Runtime
        |
        v
Back To User Plane
  AI 建议、交易确认、回测报告、组合评分、告警、下一步动作
```

## 5. V1.0 用户功能与接口固化

### 5.1 目标

V1.0 的目标是先让用户能直接使用系统，完成核心业务闭环，并稳定前后端接口。

V1.0 不强制完成 harnessOS 真实联调，也不要求每个领域都独立成 Agent。重点是把用户层的产品能力、REST API、DTO、数据库模型和领域服务边界做稳。

### 5.2 V1.0 阶段收敛

V1.0 不再把股票详情、基金穿透、技术指标、AI 建议、交易确认、回测和组合评分一次性作为同一阶段交付。V1.0 按“可信数据闭环优先”拆成三个阶段。

#### V1.0 Phase 1：MVP 可信投资账本

目标是先把账算准，让用户导入资产后能看到可信的市值、成本、盈亏、仓位和基础交易记录。

必须完成：

- 资产导入和手动编辑，覆盖股票、基金、黄金、现金。
- 资产主数据归一化，区分用户持仓资产、标的基础信息和行情快照。
- 行情补全，记录价格、来源、更新时间和基础可信度。
- 当前市值、成本、盈亏、当前实际仓位和成本仓位计算。
- 标签系统，支持自动建议标签和用户手动修改。
- 基础交易记录，覆盖买入、卖出、现金存取、费用和分红。
- 资产列表到股票/基金详情页跳转，详情页优先展示已有价格趋势和基础信息。
- 基础止盈止损提醒，先复用当前告警能力，后续演进为 `AlertRule` 和 `AlertEvent`。

本阶段暂不做：

- 多 Agent、DomainPack、MCP tool contract 和 harnessOS 编排。
- 复杂 AI 投顾建议、建议确认和建议收益回测。
- 基金持仓穿透估值、全量消息面分析、复杂技术指标全量落库。
- 高频回测、滑点模型、组合优化器和机器学习预测。

#### V1.0 Phase 2：建议和交易闭环

目标是让 AI 建议可结构化、可确认、可修改、可追溯。

- 建立 `Advice`、`AdviceAction`、`AdviceInputSnapshot` 和建议执行关联模型。
- AI 输出结构化 JSON，前端只渲染结构化字段，自然语言只作为解释补充。
- 用户可以接受、拒绝、修改建议，并将确认后的动作写入 `Transaction`。
- 交易记录保留建议来源，能回答“AI 原建议是什么、用户改了什么、实际执行了什么”。
- 明确产品边界：AI 建议仅用于辅助决策，不自动下单，不构成投资建议。

#### V1.0 Phase 3：回测和组合评分

目标是证明建议和执行的效果，而不是只生成文本建议。

- 按月度回测历史 AI 建议。
- 对比 AI 建议模拟收益率与用户实际执行收益率。
- 生成回测报告 artifact，保存输入、结果和关键解释。
- 支持永久组合、全天候组合等模板。
- 按资产类型、标签和标的三层维度分析风险暴露和组合偏离。

### 5.3 V1.5 数据可靠性阶段

V1.5 插在 V1.0 和 V2.0 之间，专门处理投资系统的数据可靠性问题。

必须完成：

- 行情 Provider 抽象，统一 Yahoo Finance、Eastmoney、Sina、Akshare 或手动覆盖数据源。
- Provider fallback、超时、重试、来源标记和价格差异告警。
- 行情缓存和历史价格落库策略，避免前端请求直接压外部数据源。
- `PortfolioSnapshot`、`PositionSnapshot`、`MarketSnapshot`、`AdviceInputSnapshot` 的快照机制。
- 长任务基础模型，例如 `Operation` 或 `Job`，支撑批量行情刷新、回测、定时分析和报告生成。
- 告警规则模型从简单字段演进为 `AlertRule` 和 `AlertEvent`。

### 5.4 用户层接口固化

V1.0 优先固化 REST API 和 DTO：

- 前端仍可直接调用业务 API。
- Phase 1 DTO 优先稳定表达资产、行情、仓位、标签、交易和基础告警。
- Phase 2/3 再稳定表达建议、回测、组合评分和报告 artifact。
- 数据库模型最终要能支撑“AI 原建议 + 用户确认/修改 + 实际交易动作 + 后续回测”的闭环，但不要阻塞 Phase 1 账本能力交付。

## 6. V2.0 FAMS DomainPack 与 Connect 层

### 6.1 目标

V2.0 的目标是让 FAMS 能作为一个可安装、可注册、可调用的 DomainPack 暴露给 harnessOS。

本阶段不急着把每个业务域拆成独立包，而是先做一个 `FAMS DomainPack`，内部按业务域分组暴露工具。

### 6.2 DomainPack 归属

DomainPack、Connector、tool contract 的源定义放在 FAMS 仓库中维护。

harnessOS 后续读取或安装这些定义，并注册到自己的 Connector Registry、DomainPack Registry 和 Workflow Registry 中。

### 6.3 Connect 层契约

Connect 层优先固化 tool contract：

- tool name
- domain
- description
- input schema
- output schema
- permission metadata
- sync/async 标记
- error contract
- artifact refs
- operation status

统一 envelope 建议：

```json
{
  "workspace_id": "string|null",
  "user_id": "string|null",
  "operation_id": "string|null",
  "status": "ok|queued|running|completed|failed|cancelled|blocked",
  "warnings": [],
  "artifact_refs": [],
  "next_actions": [],
  "data": {}
}
```

说明：

- `ok` 表示同步成功。
- `queued/running/completed/failed/cancelled` 用于长任务，例如回测、批量分析、定时建议生成。
- `blocked` 表示业务可预期失败，例如权限不足、标的不存在、数据源不可用、用户未确认。
- `artifact_refs` 保存报告、回测结果、建议快照等稳定引用。
- `next_actions` 给 Agent 后续动作提示。

### 6.4 单包多域工具分组

`FAMS DomainPack` 初期按以下工具域分组：

- `asset.*`：资产导入、编辑、标签、详情、止盈止损。
- `market_data.*`：实时价格、基金净值、基金持仓、技术指标、基本面、消息面。
- `position.*`：当前仓位、成本仓位、目标仓位、组合仓位。
- `transaction.*`：交易记录、交易确认、执行反馈。
- `advice.*`：定时建议、主动分析、股票网格、基金定投、买卖计划。
- `backtest.*`：建议回测、实际执行回测、收益对比。
- `portfolio.*`：组合模板、标签分析、组合评分、调仓建议。
- `alert.*`：止盈止损提醒、风险提醒、目标仓位偏离提醒。

### 6.5 双传输

V2.0 暴露两种调用方式：

- HTTP MCP bridge：复用当前 Fastify 能力，便于前端调试、人工测试和兼容现有 `/api/v1/mcp`。
- stdio MCP provider：面向 harnessOS 持久会话联调，对齐已有 data_service 接入模式。

HTTP 和 stdio 应复用同一套 tool contract，不重复实现业务逻辑。

## 7. V3.0 harnessOS 工作流编排

### 7.1 目标

V3.0 的目标是在 harnessOS 层完成 FAMS 的 Connector、DomainPack 和 workflow DAG 注册，实现端到端多 Agent 编排。

用户在前端可以用自然语言或结构化入口发起任务，harnessOS 负责协调多个领域 Agent 和 FAMS tools，主 Agent 汇总结果后回写 FAMS，并更新前端页面。

### 7.2 harnessOS 注册对象

Connector Registry：

- `fams_mcp_http`
- `fams_mcp_stdio`

DomainPack Registry：

- `fams`
- domain 可命名为 `investment` 或 `financial_asset_management`
- 初期为单包多域

Workflow Registry：

- `daily_investment_analysis`
- `interactive_asset_analysis`
- `recommendation_to_trade_execution`
- `monthly_strategy_backtest`
- `portfolio_rebalance_review`

### 7.3 多 Agent 分工

主 Agent：

- 理解用户目标。
- 拆解任务。
- 调用 workflow。
- 汇总多 Agent 结果。
- 生成面向用户的最终说明和下一步动作。

领域 Agent：

- 资产 Agent：资产识别、标签、详情补全。
- 行情研究 Agent：价格、技术面、基本面、消息面。
- 仓位 Agent：仓位计算、目标仓位、风险暴露。
- 交易 Agent：交易确认、实际执行记录、执行反馈。
- 分析师 Agent：股票网格、基金定投、买卖计划、决策原因。
- 回测 Agent：建议收益与实际收益对比。
- 组合顾问 Agent：组合评分、再平衡建议。

### 7.4 前端双模式

普通模式：

- 用户直接操作资产、仓位、交易、组合等页面。
- 前端直接调用 FAMS REST API。

Agent 模式：

- 用户与主 Agent 交互。
- 前端展示 workflow 状态、operation status、Agent 结果、artifact、建议和执行确认。
- 具体跨域动作由 harnessOS 编排，FAMS 接收结果回写。

## 8. 关键业务闭环

完整产品最终仍围绕以下闭环演进，但交付顺序必须分层：V1.0 Phase 1 先完成资产、行情、仓位、标签、交易和基础告警；V1.0 Phase 2/3 再补齐 AI 建议、执行差异和回测复盘；V2.0/V3.0 再开放 MCP 和 harnessOS 编排。

### 8.1 资产到建议闭环

```text
资产导入/编辑
  -> 自动补全行情/基金/股票信息
  -> 自动打标签 + 用户修正标签
  -> 计算仓位和风险暴露
  -> AI 分析师生成建议
  -> 前端展示建议和原因
```

### 8.2 建议到交易闭环

```text
AI 生成建议
  -> 用户确认/修改
  -> 记录 AI 原建议
  -> 记录用户实际动作
  -> 写入交易数据库
  -> 后续用于回测和复盘
```

### 8.3 回测复盘闭环

```text
历史 AI 建议
  -> 用户实际交易动作
  -> 月度回测
  -> AI 建议收益 vs 实际执行收益
  -> 生成复盘报告
  -> 反向优化后续组合和建议
```

### 8.4 harnessOS 编排闭环

```text
用户在前端提出目标
  -> 主 Agent 接收
  -> harnessOS 选择 workflow
  -> 调用 FAMS DomainPack tools
  -> 多领域 Agent 协作
  -> 主 Agent 汇总
  -> 回写 FAMS
  -> 前端展示最终结果
```

## 9. 当前架构到目标架构的 Gap

### 9.1 V1.0 Gap

V1.0 Phase 1 优先 Gap：

- 手动编辑和表格导入资产能力需要做成稳定路径。
- 行情补全需要统一价格、来源、更新时间、失败警告和历史写入。
- 标签体系需要优先使用 `Tag` / `AssetTag` 关系表，减少字符串字段继续扩散。
- 仓位计算需要统一后端口径，覆盖市值、成本、盈亏、当前实际仓位和成本仓位。
- 基础交易写库需要覆盖买入、卖出、现金存取、费用和分红，并同步更新持仓。
- 止盈止损提醒第一阶段可复用现有 `Alert`，但触发和展示链路需要闭合。
- 前端页面需要围绕“资产 -> 行情 -> 仓位 -> 交易 -> 告警”主工作流重新组织体验。

V1.0 Phase 2/3 后续 Gap：

- AI 建议和实际交易之间缺少明确的关联模型。
- 建议生成时缺少输入快照，后续复盘容易用新数据解释旧建议。
- 回测需要支持“AI 建议策略 vs 用户实际执行”的对比。
- 股票详情和基金详情的数据完整度需要增强，但不阻塞 Phase 1。

V1.5 数据可靠性 Gap：

- 行情 Provider、fallback、缓存、重试、来源归因和交叉验证需要抽象。
- 快照、长任务、报告 artifact 和通用告警规则模型需要补齐。

### 9.2 V2.0 Gap

- 当前 MCP router 是 HTTP-style，不是正式 stdio MCP provider。
- 当前 MCP tools 粒度偏少，不能覆盖全部业务域。
- 缺少统一 envelope、operation_id、artifact_refs、next_actions。
- 缺少 FAMS DomainPack manifest。
- 缺少 connector contract、tool schema 版本管理和权限元信息。
- HTTP MCP 和 stdio MCP 需要复用同一套业务能力，避免双实现。

### 9.3 V3.0 Gap

- harnessOS 侧尚未注册 FAMS connector。
- harnessOS 侧尚未装配 FAMS DomainPack。
- 关键 workflow DAG 尚未定义。
- 缺少跨 Agent 的任务状态、artifact、trace 和回写机制。
- 前端尚未支持主 Agent 编排模式。
- 缺少端到端验收链路。

## 10. 架构评审问题清单

可以把以下问题发给 ChatGPT 或架构评审方：

1. 这个 V1.0/V2.0/V3.0 演进路径是否能覆盖资产管理、仓位管理、交易记录、分析建议、回测和组合管理的功能要求？
2. V1.0 先固化 REST API + DTO，V2.0 再映射成 MCP tools，这个顺序是否合理？
3. V2.0 先做单个 `FAMS DomainPack`、内部多域分组，而不是一开始拆多个 DomainPack，是否适合当前项目规模？
4. DomainPack 和 Connector 源定义放在 FAMS 仓库中维护，harnessOS 负责安装和注册，这个边界是否清晰？
5. HTTP MCP bridge + stdio MCP provider 双传输是否会造成过多维护成本？是否应该优先只做 stdio？
6. 统一 envelope 是否足以支撑同步工具、长任务、业务阻断、artifact 引用和 Agent 下一步动作？
7. 前端保留普通 CRUD 模式，同时增加主 Agent 编排模式，会不会导致产品体验和权限模型复杂化？
8. 当前“AI 原建议 + 用户确认/修改 + 实际交易动作 + 月度回测”的数据闭环是否还缺少关键模型？
9. 多 Agent 分工是否合理？是否应该增加独立的风控 Agent、消息面 Agent、估值 Agent？
10. V3.0 中由 harnessOS 编排多 Agent，FAMS 只提供领域能力和结果回写，这个职责划分是否可长期维护？

## 11. 建议的下一步

在架构评审确认后，再输出两类交付物：

- 目标架构 draw.io：展示 V1.0/V2.0/V3.0 演进后的最终架构。
- Gap 开发计划：按 V1.0、V2.0、V3.0 拆分功能、接口、数据模型、tool contract、workflow 和验收标准。
