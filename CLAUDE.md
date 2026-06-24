# 金融资产管理系统 (FAMS) - Claude Code 项目上下文

## 项目概述

这是一个面向AI Agent工作流的金融资产管理系统，支持多角色Agent协作（基金分析师、策略回测师、消息面情报师等），并可为OpenClaw等外部Agent框架提供服务。

**项目路径**: `/Users/Zhuanz/Desktop/xiaoli/financial-asset-manager`

## 技术架构

### 核心特性
- **微服务化设计**: 每个服务(Price, Position, Analysis等)都是独立可控的模块
- **MCP协议**: Model Context Protocol支持，让AI Agent能精准调用每个服务
- **工作流编排**: 支持多Agent协作的复杂任务编排
- **ECharts图表**: 金融专用图表（K线、饼图、热力图、收益率曲线等）

### 前后端技术栈

**前端** (React + TypeScript + Vite)
- ECharts 5 - K线图、饼图、曲线图
- AntV G2 - 热力图
- Ant Design 5 - UI组件
- TailwindCSS - 样式
- Zustand - 状态管理
- socket.io-client - 实时价格

**后端** (Node.js + Fastify + TypeScript)
- Fastify - 高性能API框架
- Prisma ORM - 数据库
- PostgreSQL + TimescaleDB - 主数据库 + 时序
- Redis - 缓存/队列
- Bull - 定时任务

## 目录结构

```
financial-asset-manager/
├── frontend/                    # React前端
│   └── src/
│       ├── components/          # 组件
│       │   ├── charts/         # ECharts图表组件
│       │   │   ├── KLinedChart.tsx    # K线图
│       │   │   ├── AllocationPieChart.tsx # 饼图
│       │   │   ├── YieldCurveChart.tsx   # 收益率曲线
│       │   │   ├── HeatmapChart.tsx     # 热力图
│       │   │   ├── GaugeChart.tsx       # 仪表图
│       │   │   └── EquityCurveChart.tsx # 权益曲线
│       │   ├── common/        # 通用组件
│       │   └── layout/        # 布局
│       ├── pages/             # 页面
│       │   ├── Dashboard.tsx  # 总览
│       │   ├── Assets.tsx     # 资产管理
│       │   ├── Positions.tsx  # 仓位管理
│       │   ├── Transactions.tsx # 交易记录
│       │   ├── Analysis.tsx   # 分析建议
│       │   ├── Backtest.tsx   # 策略回测
│       │   └── Portfolios.tsx # 投资组合
│       ├── hooks/             # 自定义Hooks
│       ├── services/          # API服务
│       ├── stores/            # Zustand状态
│       └── styles/            # 样式/主题
│
├── backend/                    # Node.js后端
│   └── src/
│       ├── services/          # 业务服务层 (微服务架构)
│       │   ├── price/        # 价格服务
│       │   ├── position/      # 仓位服务
│       │   ├── transaction/   # 交易服务
│       │   ├── analysis/      # 分析服务
│       │   ├── portfolio/     # 组合服务
│       │   ├── backtest/      # 回测服务
│       │   └── alert/         # 告警服务
│       ├── routes/            # API路由
│       ├── agents/            # AI Agent核心
│       │   └── router.ts      # Agent注册与调用
│       ├── workflow/          # 工作流编排
│       │   └── router.ts      # 工作流执行引擎
│       ├── mcp/               # MCP Server
│       │   └── index.ts       # 工具定义与调用
│       ├── middleware/        # 中间件
│       ├── utils/             # 工具函数
│       └── index.ts           # 服务入口
│   └── prisma/
│       └── schema.prisma      # 数据库Schema
│
├── docs/
│   └── ARCHITECTURE.md        # 详细架构文档
│
├── mcp/                       # MCP配置
│   └── financial-mcp.json    # MCP Server配置
│
└── skills/                    # Agent Skills文档
    ├── get-investment-suggestions.md
    ├── get-real-time-price.md
    └── get-portfolio-analysis.md
```

## AI Agent 架构

### 核心组件

1. **MCP Server** (`/api/v1/mcp`)
   - 提供标准化的工具调用接口
   - 支持单个调用和批量调用
   - 工具: get_real_time_price, get_positions, get_investment_suggestions 等

2. **Agent Router** (`/api/v1/agents`)
   - Agent注册中心
   - 支持的Agent角色:
     - `fund_analyst` - 基金分析师
     - `risk_manager` - 风险管理师
     - `news_intelligence` - 消息面情报师
     - `strategy_backtester` - 策略回测师
     - `portfolio_advisor` - 组合顾问

3. **Workflow Router** (`/api/v1/workflows`)
   - 预定义工作流模板
   - 多步骤任务编排
   - 执行状态监控

### 服务粒度设计

每个服务方法都是**小而可控**的：
- `priceService.getRealTimePrice(symbol)` - 获取单个价格
- `positionService.getPositions(userId, filters)` - 获取仓位列表
- `analysisService.getSuggestions(userId, period)` - 获取每日/每周建议

## 数据库

核心表: users, assets, positions, transactions, price_history, tags, portfolios, strategies, backtests, alerts, daily_snapshots

详细Schema: `backend/prisma/schema.prisma`

## API路由

```
/api/v1
├── /auth, /assets, /positions, /transactions, /portfolios
├── /analysis - 分析建议
├── /backtest - 策略回测
├── /alerts - 告警
├── /prices - 价格
├── /tags - 标签
├── /mcp - MCP工具调用
├── /agents - Agent管理
└── /workflows - 工作流编排
```

详细API文档: 启动后端后访问 http://localhost:4000/api-docs

## 启动开发

### 前端
```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

### 后端
```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run dev
# API运行在 http://localhost:4000
# API文档 http://localhost:4000/api-docs
```

## 关键设计决策

1. **服务粒度小而可控**: 每个服务方法只做一件事，便于AI Agent精准调用
2. **MCP标准化**: 所有工具调用通过统一协议，支持外部Agent框架集成
3. **工作流编排**: 支持复杂的多Agent协作任务
4. **ECharts优先**: 金融数据可视化首选ECharts
5. **TypeScript**: 全栈TypeScript确保类型安全

---

## 开发团队与进度

### 团队结构

| Agent | 角色 | 职责 | 状态 |
|-------|------|------|------|
| leader | 进度管控 | 监控团队进度，向用户汇报 | 🟢 运行中 |
| backend-price | 后端开发 | Price Service 价格服务 | ✅ 完成 |
| backend-position | 后端开发 | Position Service 仓位服务 | ✅ 完成 |
| backend-transaction | 后端开发 | Transaction Service 交易服务 | ✅ 完成 |
| backend-analysis | 后端开发 | Analysis Service 分析服务 | ✅ 完成 |
| backend-portfolio | 后端开发 | Portfolio Service 组合服务 | ✅ 完成 |
| backend-backtest | 后端开发 | Backtest Service 回测服务 | ✅ 完成 |
| backend-alert | 后端开发 | Alert Service 告警服务 | ✅ 完成 |
| frontend-dev | 前端开发 | ECharts图表组件 | 🟡 开发中 |

### 任务分配

| Task ID | 任务 | 负责Agent | 状态 | 完成时间 |
|---------|------|-----------|------|----------|
| #2 | Price Service | backend-price | ✅ 完成 | 15:17 |
| #3 | Position Service | backend-position | ✅ 完成 | - |
| #4 | Transaction Service | backend-transaction | ✅ 完成 | - |
| #5 | Analysis Service | backend-analysis | ✅ 完成 | - |
| #6 | Portfolio Service | backend-portfolio | ✅ 完成 | 15:17 |
| #7 | Backtest Service | backend-backtest | ✅ 完成 | 15:17 |
| #8 | Alert Service | backend-alert | ✅ 完成 | - |
| #9 | 前端图表组件 | frontend-dev | 🟡 开发中 | - |

### 已完成的后端服务

1. **Price Service** - Yahoo/Eastmoney/Sina多数据源价格获取，交叉验证
2. **Position Service** - 仓位CRUD，自动标签，止损止盈计算
3. **Transaction Service** - 交易记录，Excel导入，成本计算
4. **Analysis Service** - 每日建议，RSI/MACD/MA技术指标
5. **Portfolio Service** - 组合分析，风险指标，评分，预设模板
6. **Backtest Service** - 4种信号策略，完整回测引擎
7. **Alert Service** - 告警管理，风险检查，VaR计算

### 团队沟通

- 进展文件: `/Users/Zhuanz/Desktop/xiaoli/financial-asset-manager/project-progress/`
- 详细进展报告: `project-progress/TEAM_STATUS_2026-04-12.md`

### 并行开发策略

后端7个服务并行开发已完成，前端图表组件正在开发中。

## 开发团队

### 团队名称
**fams-dev** - FAMS项目开发团队

### 团队成员

| Agent | 角色 | 身份 |
|-------|------|------|
| team-lead | 进度管控 | 监控团队进度，向用户汇报 |
| frontend-dev | 前端开发 | engineering-frontend-developer |
| senior-developer | 高级开发 | engineering-senior-developer |
| backend-architect | 后端架构 | engineering-backend-architect |
| ai-engineer | AI工程师 | engineering-ai-engineer |
| finance-financial-analyst | 金融分析师 | finance-financial-analyst |
| code-reviewer-new | 代码审查 | engineering-code-reviewer |

### 启动团队

当用户说"启动团队"时，执行以下操作：

1. 读取 `.claude/teams/fams-dev/config.json` 获取团队成员配置
2. 使用 Agent tool 依次启动各成员 agent
3. 各 agent 读取 `~/.claude/teams/fams-dev/config.json` 了解团队结构
4. 各 agent 向 team-lead 发送消息确认已加入

### 团队配置
- 团队配置: `.claude/teams/fams-dev/config.json`
- 团队说明: `.claude/teams/fams-dev/README.md`

---

## 开发规范

### 数据真实性要求

**重要：必须使用真实数据，如使用 mock 数据必须提前告知用户**

1. **尽量使用真实数据**：所有功能开发应优先使用真实数据源（数据库、第三方 API 等）
2. **数据来源透明**：如果使用 mock 数据或不准确的数据，必须在实现前告知用户，不能隐瞒
3. **方案设计时考虑数据来源**：制定技术方案时必须明确数据来源，不能假设数据总是可用
4. **API 降级处理**：当真实数据不可用时，应明确提示用户当前显示的是模拟数据，而不是假装是真实数据

### 页面测试要求

**每次给用户交付前必须完成页面测试**

在完成任何功能开发或bug修复后，交付给用户之前，必须进行完整的页面测试，确保：
1. 页面能够正常加载和渲染
2. 所有交互功能正常工作
3. API调用返回正确数据
4. 没有控制台错误或警告
5. 页面在目标浏览器中表现一致

### 团队成员使用优先级

**优先使用本项目已经存在的团队成员，优先使用本项目团队的已经存在的成员描述。**

当需要分配任务或协作时，优先从 `.claude/teams/fams-dev/config.json` 中的现有成员选择，避免召唤新的外部agent。所有成员身份、专长和职责已在团队配置中定义。

### API访问失败重试规则

**如果leader发现团队内有成员无法访问API，就让它重试，直到失败三次。**

当团队成员调用API失败时：
1. 第一次失败：让成员重试
2. 第二次失败：再次重试
3. 第三次失败：确认失败，记录错误并向team-lead汇报

当需要分配任务或协作时，优先从 `.claude/teams/fams-dev/config.json` 中的现有成员选择，避免召唤新的外部agent。所有成员身份、专长和职责已在团队配置中定义。
