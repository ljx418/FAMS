# 金融资产管理系统 (Financial Asset Management System - FAMS)

## 项目概述

一个完整的金融资产管理系统，支持多种资产类别（基金、黄金、股票、现金）的仓位管理、交易记录、自动化分析和策略回测。

## 核心功能

### 1. 仓位管理
- 多资产类别展示（基金、黄金、股票、现金）
- 实时净值、历史价格、涨跌幅
- ECharts K线图、饼图可视化
- 止损点、止盈点、成本线

### 2. 资产导入/编辑
- 表格导入 (Excel/CSV)
- 手动编辑交易确认
- 自动/手动打标签（港股、科技、新能源等）
- FIFO/LIFO/加权平均成本计算

### 3. 资产信息自动查询
- 多数据源实时价格 (Yahoo Finance, Eastmoney, Sina)
- 多源交叉验证
- 价格偏差告警

### 4. 资产自动化分析
- 每日/每周投资建议
- 止损止盈自动计算
- 建议与实际交易对比存档

### 5. 策略回测
- 内置策略: 均线交叉、RSI、MACD、布林带
- 月度回测分析
- 策略回报 vs 实际回报对比

### 6. 投资组合管理
- 预设组合: 永久组合、全天候组合
- 标签分析 (行业分布、风险敞口)
- 多维度综合打分

### 7. 每日持仓复盘与截图台账
- ChatBox/Codex 手动触发是默认入口；可选择启用工作日 09:30、14:30（Asia/Shanghai）调度
- 最新价、最近 30 个完整交易日收盘价、MA5/MA10/MA30 和走势图统一落库
- 比较上一轮基本面/消息证据与网格草案，输出关注标的和人工计划买卖档位
- 持仓、成交、委托截图先私有保存，再逐字段纠错、逐行预览和人工确认；截图缺失持仓绝不自动平仓
- 已验证个人网格策略优先；没有个人策略时使用现有 ATR/成本支撑模板生成研究草案
- 所有网格均为人工计划草案；系统不创建券商订单，不解锁自动交易

## 技术栈

### 前端
- React 18 + Vite + TypeScript
- ECharts 5 (K线图、饼图、曲线)
- AntV G2 (热力图)
- Ant Design 5
- TailwindCSS

### 后端
- Node.js + Fastify + TypeScript
- Prisma ORM
- PostgreSQL + TimescaleDB
- Redis
- Bull (定时任务)

### API文档与Agent集成
- Swagger/OpenAPI
- MCP (Model Context Protocol)
- Skills (投资分析Skill)

## 快速开始

### 环境要求
- Node.js >= 18.0.0
- PostgreSQL 15+ (生产)
- Redis 7+

### 安装

```bash
# 克隆项目
cd /Users/Zhuanz/Desktop/xiaoli/financial-asset-manager

# 安装前端依赖
cd frontend && npm install

# 安装后端依赖
cd ../backend && npm install

# 初始化数据库
npx prisma db push
```

### 启动开发服务器

```bash
# 启动后端 (端口 4000)
cd backend && npm run dev

# 启动前端 (端口 3000)
cd frontend && npm run dev
```

### 使用指南

前端启动后，从左侧导航点击“使用指南”，或直接访问：

http://localhost:3000/fams-user-guide.html

指南默认只展示约 15 分钟的必学路径；每项都可以勾选学习结果、填写问题、附上截图，并导出一份可直接交给 Codex 的 HTML 报告。

### Docker部署

```bash
docker-compose up -d
```

## API文档

启动后端后访问: http://localhost:4000/api-docs

## MCP/Agent集成

系统提供MCP Server供其他Agent调用，配置见 `mcp/financial-mcp.json`

### 可用工具
- `get-investment-suggestions` - 投资建议
- `get-real-time-price` - 实时价格
- `get-portfolio-analysis` - 组合分析
- `run-backtest` - 策略回测
- `get-daily-snapshot` - 每日快照
- `daily_review.run` / `daily_review.get_latest` - 生成或查询每日持仓复盘
- `GET /api/v1/daily-reviews` - 分页查询历史复盘、快照和策略结论
- `market_data.get_asset_trend` - 最新价、30 日收盘价与 MA 走势图
- `grid_strategy.*` - 模板、草案、验证和人工确认激活
- `capture.*` - 截图私有保存、视觉状态、逐字段纠错、结构化预览与确认写入

仓库内可复用工作流见 `skills/fams-daily-portfolio-review`、`skills/fams-grid-strategy-authoring` 和 `skills/fams-screenshot-ledger-import`。

## 项目结构

```
financial-asset-manager/
├── frontend/          # React前端
├── backend/           # Node.js后端
│   ├── src/
│   │   ├── services/ # 业务服务
│   │   ├── routes/    # API路由
│   │   ├── models/    # 数据模型
│   │   ├── jobs/      # 定时任务
│   │   ├── scrapers/  # 价格爬取
│   │   └── mcp/       # MCP Server
│   └── prisma/        # 数据库Schema
├── mcp/               # MCP配置
└── skills/            # Agent Skills
```

## 数据库

核心表: users, assets, positions, transactions, price_history, tags, strategies, backtests, daily_snapshots, alerts

## License

MIT
