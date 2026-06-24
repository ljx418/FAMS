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

## 技术栈

### 前端
- React 18 + Vite + TypeScript
- ECharts 5 (K线图、饼图、曲线)
- AntV G2 (热力图)
- Ant Design 5
- TailwindCSS

### 后端
- Node.js + Express + TypeScript
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
