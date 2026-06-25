# 交互式策略回测与正式交易级前置阶段文档审计

更新时间：2026-06-24

## 1. 审计结论

当前文档可以完整支撑本阶段开发；2026-06-24 实现验收已完成，研究级交互式组合回测路径已通过自动化验收。

支撑范围：

```text
interactive_strategy_backtest_ready
research_grade_strategy_comparison_ready
manual_trade_draft_ready
portfolio_backtest_formal_review_ready
runtime_health_gate_consistent
formal_trading_locked
auto_trade_locked
```

最新实现状态：

```text
overallStatus=passed
researchGradeStrategyComparisonReady=true
manualDraftReady=true
portfolioBacktestFormalReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
runtimeHealth=healthy
proxyEtfCoverage=ready
frontendRuntimeEvidence=passed
completedStrategies=7/7
tradeConstraintCoveragePercent=99.69
freeSourceTotalReturnBenchmarkReady=true
dividendLowVolBasketStatus=completed
dividendLowVolBasketComponentCount=3
dividendLowVolBasketSymbols=000513,601398,000333
```

状态来源：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
```

不支撑范围：

```text
formal_trade_action_ready
formal_add_reduce_unlocked
auto_rebalance_ready
auto_trade_ready
```

结论解释：

- PRD 已定义目标体验：用户可在前端选择多种策略、设置回测参数、查看多曲线、指标、benchmark、分红贡献、数据缺口和 evidenceRefs。
- 目标架构已定义当前层、需修改层、新增目标层和交易硬边界。
- drawio 已压缩为 7 页中文图，覆盖目标体验、架构差异、开发计划、验收门槛、出门条件和关键用户路径。
- 红利低波文档已明确其作为策略篮子进入组合回测，但不改变交易边界。
- 所有正式交易动作仍需要后续 formal validation 和人工复核，本阶段不能自动解锁。

## 2. 已发现并修正的文档问题

| 问题 | 处理 |
| --- | --- |
| 永久组合/全天候组合的 ETF 代理状态在旧段落中描述为固定 insufficient | 已修正为：代理行情覆盖满足时可 completed 并进入 portfolio formal review；缺 ETF 数据时 insufficient；两者均不等同正式交易解锁 |
| drawio 摘要文件曾因并行写入被截断为 0 字节 | 已重新从 drawio 生成 `docs/drawio-summary.txt` |
| 组合回测与红利低波联动目标分散 | 已在 `DIVIDEND_LOW_VOL_PRD.md` 和开发验收计划中增加 D7 联动验收 |

## 3. 文档覆盖矩阵

| 开发目标 | 文档覆盖 | 结论 |
| --- | --- | --- |
| PBT-0 Runtime Health 与验收口径收口 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、drawio 第 2/5/6 页 | 充分 |
| PBT-8 ETF 代理行情补齐 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、drawio 第 2/5/6 页 | 充分 |
| PBT-9 Benchmark + 分红总回报 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、drawio 第 3/5/6 页 | 充分 |
| PBT-10 Operation + 前端验收 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、drawio 第 3/5/7 页 | 充分 |
| PBT-11 组合回测正式评审前置 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、`ARCHITECTURE_CURRENT_TARGET.md`、drawio 第 2/5/6/7 页；本轮已达到 `portfolioBacktestFormalReviewReady=true`，但未解锁正式交易 | 充分 |
| 下一阶段正式交易级前置 | `PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`、`TARGET_ARCHITECTURE_GAP.md`、drawio 第 2/5/6/7 页；覆盖数据等级、模型有效性、人工草案、前端评审、审计包和解锁闸门 | 充分 |
| 红利低波篮子进入组合回测 | `DIVIDEND_LOW_VOL_PRD.md`、`DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md`、drawio 第 4 页；实现已接入真实候选快照读取，当前 3/3 可作为 formal-review-ready 曲线参与比较，但不解锁交易 | 充分 |
| 交易动作边界 | 全部核心文档 | 充分 |

## 4. 剩余开发计划与验收标准

本节保留为下一阶段开发基线。PBT-0、PBT-8、PBT-10 在 2026-06-24 已完成本阶段验收；PBT-9 已接入免费源 total-return benchmark，可支撑组合回测正式评审，但官方授权 total-return benchmark 仍是正式交易解锁前置；PBT-11 已完成 formal-review readiness artifact，当前 `portfolioBacktestFormalReviewReady=true`、`formalTradingUnlocked=false`。

下一阶段正式交易级前置计划维护在：

```text
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
```

### PBT-0 Runtime Health 与验收口径收口

开发内容：

- 统一 `/health`、`npm run check:sqlite-health`、红利低波 audit package、全系统 E2E 的 runtime health 口径。
- runtime critical 或 unconfirmed 时阻断 full-A 持久化 scan、persistence-heavy backtest 和 formal validation promotion。
- 在任务中心或审计包中显示 runtime health 状态、阻断动作和允许动作。

验收标准：

- 不再出现“命令 passed 但 runtime audit critical 却被视为正式通过”的虚假验收。
- runtime critical 时只能运行 dry-run、fixture 或小样本研究验证。
- runtime healthy 时才允许大样本持久化扫描和组合 Operation 回测。
- 审计包包含 `runtimeHealth.status / sqliteHealthy / blockedActions / allowedActions`。

验收命令：

```bash
cd backend
npm run check:sqlite-health
npm run test:dividend-low-vol-runtime-health
npm run test:production-readiness
```

### PBT-8 ETF 代理行情补齐

开发内容：

- 补齐 `510300 / 511010 / 511260 / 518880 / 159985` 等代理标的行情。
- 建立 sourceRefs、freshness、coverage 和 fallback audit。
- 标准组合只能使用对应 ETF 代理行情，不能用本地 A 股样本冒充。

验收标准：

- 每个代理标的不少于 250 个交易日真实行情。
- 永久组合和全天候组合在代理行情覆盖达标时返回 completed 曲线。
- 任一代理缺数据时保持 insufficient，并展示 blockedReasons。
- 前端展示 ETF 代理来源和更新时间。

验收命令：

```bash
cd backend
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
```

### PBT-9 Benchmark + 分红总回报

开发内容：

- 接入至少一个宽基 benchmark，明确 `formal_total_return / price_index / research_proxy`。
- 实现 price-only、dividend cash、dividend reinvest 三种回测路径。
- 输出 dividendContribution、capitalGainContribution、costDrag、benchmarkReturn 和 excessReturn。

验收标准：

- 至少一个宽基 benchmark 能输出曲线。
- `local_equal_weight_20` 仍标记为 research proxy。
- `dividendContributionPercent` 不再恒为 null。
- 缺 total-return benchmark 时 formal validation 仍 blocked。

验收命令：

```bash
cd backend
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
npm run test:dividend-low-vol-total-return-backtest
```

### PBT-10 Operation + 前端运行态验收

开发内容：

- 组合回测支持 Operation 可选路径。
- 产出 artifactRefs：输入定义、数据覆盖、曲线指标、benchmark、交易边界、前端用户路径。
- 前端运行态验收覆盖加载、参数输入、运行、曲线、指标、缺口和非交易 banner。

验收标准：

- 用户能在任务中心追踪组合回测任务。
- artifact 可预览或下载。
- 前端能完成：选择策略 -> 设置参数 -> 运行 -> 查看多曲线 -> 查看缺口 -> 查看非交易提示。
- 浏览器自动化截图证明关键路径可见。

验收命令：

```bash
cd backend
npm run test:portfolio-backtest-api-contract
npm run test:trade-action-readiness

cd frontend
npm run build
```

建议新增：

```text
npm run test:portfolio-backtest-frontend-runtime
```

### PBT-11 正式交易评审前置

开发内容：

- 生成 formal review readiness artifact。
- 聚合 runtime、provider、benchmark、tradeability、validation、manual review 和 frontend visibility。
- 区分 `research_grade_passed / manual_draft_ready / formal_review_ready / formal_trading_unlocked`。

验收标准：

- 只有 runtime healthy、数据覆盖达标、benchmark 不依赖 proxy、交易约束完整、validation 全部 gate passed、人工复核通过时，才允许标记 `formalTradingReviewReady=true`。
- 即使 `formalTradingReviewReady=true`，`formalTradingUnlocked` 仍需要单独人工确认。
- `AUTO_TRADE=false`。

验收命令：

```bash
cd backend
npm run test:production-readiness
npm run test:trade-action-readiness
npm run run:dividend-low-vol-audit-package
```

## 5. 端到端用户路径验收

必须覆盖三个路径：

1. 策略比较路径：

```text
策略回测页 -> 选择永久组合 / 全天候 / 红利低波 / 本地样本 -> 设置近 1 年或近 3 年 -> 运行 -> 查看曲线和指标
```

2. 红利低波草案路径：

```text
红利低波页 -> 筛选行业和分数 -> 查看候选详情和观察区间 -> 进入回测比较 -> 生成人工计划草案
```

3. 缺口处理路径：

```text
runtime critical / ETF 行情缺失 / benchmark proxy / 分红缺失 / validation insufficient -> 前端显示 blockedReasons 和下一步
```

验收产物：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/manifest.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/03_frontend_runtime_and_operation_audit.json
```

## 6. 审计意见

当前文档无新增致命或重大规格偏差。

剩余风险属于下一阶段正式交易前置风险，不属于本阶段文档不足：

- Runtime health 口径已完成本阶段闭环；后续若 critical 必须阻断持久化任务。
- ETF 代理行情和免费源 total-return benchmark 已达到组合回测正式评审 ready；官方授权 benchmark 仍需后续升级。
- 分红总回报不能用空值或估算值伪造成 formal-grade。
- 前端运行态验收已有截图证据；后续新增页面路径仍需继续截图验收。
- portfolio backtest formal-review readiness 不能等同正式交易解锁。

## 7. ChatGPT 或独立审计路径

建议审计时只读取以下文件，文档数小于 20：

```text
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/manifest.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/00_runtime_health_gate_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/01_proxy_etf_market_data_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/02_benchmark_and_total_return_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/03_frontend_runtime_and_operation_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/06_trade_gate_contract.json
backend/data/gpt-audit/dividend-low-vol/2026-06-23T14-49-29-698Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/dividend-low-vol/2026-06-23T14-49-29-698Z/13_gpt_plan_completion_audit.json
```
