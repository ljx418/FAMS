# FAMS 目标架构与 Gap 路线图

目标架构、当前差距、阶段开发计划和验收节点统一维护在：

- `docs/target-architecture-gap.drawio`
- `docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md`
- `docs/DIVIDEND_LOW_VOL_PRD.md`
- `docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md`
- `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`
- `docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`

## 2026-06-25 本阶段目标校准

本阶段目标已从“研究级策略与组合回测可用”校准为“正式交易级前置材料完整”。该阶段允许系统继续输出研究、比较、观察提醒和人工计划草案，但不得释放正式交易动作。

目标状态：

```text
formalTradingPrerequisitesDocumented=true
portfolioStrategyBacktestFormalReviewReady=true
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

目标架构中的应用层、策略验证层、前端和审计包必须统一使用：

```text
dataGrade
modelEffectiveness
modelEffectivenessStatus
manualPlanDraft
formalTradingUnlockChecklist
formalTradingBlockers
allowedActions=RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

本阶段审计材料至少包含：

```text
09_data_grade_audit.json
10_model_effectiveness_audit.json
11_manual_plan_draft_audit.json
12_formal_trading_unlock_blockers.json
acceptance-report.html
SUMMARY_FOR_GPT.md
docs/read-drawio-output.txt
docs/FORMAL_TRADING_PREREQUISITE_DOC_AUDIT.md
doc_acceptance_audit.json
```

当前架构与目标架构关系：

- 灰色已实现：React/Vite 前端、Fastify REST 后端、SQLite/Prisma、Operation artifact、红利低波候选池、组合回测、多策略曲线、人工计划草案 gate、全系统 E2E 报告。
- 黄色需修改：数据等级传播、benchmark 状态、模型有效性验证、人工草案审计、前端正式评审可见性、文档术语一致性。
- 橘黄需新增：formal trading unlock checklist、data grade audit、model effectiveness audit、manual plan draft audit、formal trading blockers artifact。
- 红色硬边界：正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` 继续禁止，直到官方或可信数据、模型验证、交易约束和人工复核全部通过。

本阶段架构图必须采用“实现实体优先”的表达方式。任何目标能力都必须能落到以下至少一种对象：

- 前端页面：`DividendLowVol.tsx`、`Backtest.tsx`、`Operations.tsx`、`Analysis.tsx`。
- 后端路由：`strategy.ts`、`portfolioBacktest.ts`、`operation.ts`、FIVD-R analysis routes。
- 服务模块：`dividendLowVolStrategyService`、`dividendLowVolTradingZoneService`、`dividendLowVolBacktestService`、`PortfolioBacktestInputBuilder`、`PortfolioBacktestEngine`、`portfolioBacktestReviewService`、`operationService`。
- 数据与证据：`DividendLowVolDaily`、`market_bar_canonical`、`market_tradeability_daily`、free-source benchmark、Operation artifact。
- 审计产物：`SUMMARY_FOR_GPT.md`、`09_data_grade_audit.json`、`10_model_effectiveness_audit.json`、`11_manual_plan_draft_audit.json`、`12_formal_trading_unlock_blockers.json`、`acceptance-report.html`。

如果后续文档只写“数据层、策略层、验证层、审计层”但没有绑定以上实体，应视为架构描述不合格。

`docs/target-architecture-gap.drawio` 已调整为 7 页实现地图，用于指导后续开发和验收：

1. **目标体验与用户路径**：红利低波、组合回测和任务审计三条用户路径，明确每一步的用户可见结果和禁止动作。
2. **分层架构与调用关系**：前端页面、API、策略服务、组合回测服务、数据证据、运行产物和交易边界的调用关系。
3. **组合回测实现路径**：`/backtest` -> `portfolioBacktestRoutes` -> `PortfolioBacktestInputBuilder` -> `PortfolioBacktestEngine` -> `PortfolioBenchmarkService` -> `portfolioBacktestReviewService` -> 前端与 Operation artifact。
4. **红利低波实现路径**：免费源/本地缓存 -> 事实集 -> 评分 -> 候选池 -> Top3 -> 买卖观察区间 -> 滚动回测 -> 组合篮子 -> 人工草案 gate。
5. **数据可信与模型验证**：`dataGrade`、价格新鲜度、benchmark 状态、分红/交易约束、OOS、walk-forward、参数敏感性和分组稳定性。
6. **开发及验收计划**：FT-1 到 FT-6 映射到实现位置、输出字段、审计产物、验收命令和用户可见效果。
7. **里程碑出门与审计**：可声明状态、不能声明状态、下一阶段 blocker、审计材料路径和最终边界。

该图现在不仅说明“目标是什么”，也说明“从哪些页面、接口、服务、数据表和审计产物完成目标”。

每页验收重点：

| 页码 | 必须回答的问题 | 不合格表现 |
| --- | --- | --- |
| 1 目标体验与用户路径 | 用户如何完成研究筛选、组合回测、人工计划草案和审计追溯。 | 只画功能列表，不说明用户路径和禁止动作。 |
| 2 分层架构与调用关系 | 前端页面调用哪些 API，API 进入哪些服务，服务读取哪些数据和 artifact。 | 出现不绑定代码实体的抽象架构层。 |
| 3 组合回测实现路径 | `/backtest` 如何生成曲线、指标、数据等级、模型有效性和 readinessSummary。 | 只说“执行回测”，不说明输入构建、benchmark、审计输出。 |
| 4 红利低波实现路径 | 候选池、Top3、买卖观察区间、滚动策略和组合篮子如何形成。 | 把观察区间写成正式交易建议。 |
| 5 数据可信与模型验证 | dataGrade、priceAudit、benchmark、OOS、walk-forward 和 blocker 如何共同决定不可交易。 | 把 proxy 或 warning 当作正式验证通过。 |
| 6 开发及验收计划 | FT-1 到 FT-6 的实现实体、输出字段、审计产物、用户效果和验收命令。 | 开发项没有可执行验收标准。 |
| 7 里程碑出门与审计 | 本阶段可声明、不能声明、下一阶段 blocker 和审计入口。 | 把 formal-review-ready 写成 formal-trading-ready。 |

本阶段出门条件：

- 用户能完成“选择策略 -> 设置区间 -> 查看曲线和指标 -> 查看数据等级和模型有效性 -> 生成人工计划草案 -> 查看正式交易阻断原因”。
- 文档和 drawio 能独立说明目标体验、当前/目标架构差异、开发计划、里程碑、验收门槛、出门条件和关键用户路径。
- 审计包能解释为什么当前是 formal-review-ready，而不是 formal-trading-ready。
- `formalTradingUnlocked=false` 和 `autoTradeUnlocked=false` 在所有主文档中保持一致。
- `docs/read-drawio-output.txt` 能证明 drawio 原始 XML 本体可读，且页数不超过 8 页。
- `doc_acceptance_audit.json` 状态必须为 `pass_formal_trading_prerequisite_docs`；该状态不等于正式交易 ready。

## 当前执行约束

自 2026-05-10 起，开发主线切换为“高可靠与高正确开发计划”。在 `docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md` 完成前，不启动新的开发主线；V3.0 harnessOS 多 Agent 编排等扩展工作暂缓。

当前最高优先级：查询正确性。优先保证标的识别、行情来源、持仓计算、分析建议输入快照和 AI 选股结果可追溯、可解释、可验证。

2026-05-19 起补充产品硬边界：FAMS 定位为“有数据血缘、有任务产物、有回测审计、有持仓约束的个人投资研究与决策系统”。LLM 不直接决定买卖，只解释结构化事实集、规则引擎、回测系统和仓位引擎给出的结论。没有 `evidenceRefs`、数据不足、provider 冲突或策略可信度 `low / insufficient` 时，不允许输出加仓建议。

后续开发顺序锁定为：

1. `P0 Operation 状态机落库`
2. `P1 历史 K 线缓存和增量更新`
3. `P2 Provider 健康、限速、熔断`
4. `P3 PositionAdviceFactSet + PositionAdviceEngine`
5. `P4 策略锦标赛升级`
6. `P5 持仓研究面板缓存化`
7. `P6 AI Agent 接入`

## 红利低波行业龙头策略专项

2026-06-11 起，红利低波行业龙头策略 `dividend_low_vol_leader_v1` 作为 FAMS 研究策略专项进入文档和架构图主线。该专项优先级高于新增其他策略，但不改变交易动作硬边界。

当前状态：

- 已具备全 A 研究链路、候选池、策略评分、提醒、含分红研究回测、validation retest、标准 GPT 审计包和独立前端页面。
- 最新策略证据状态为 `ready_for_manual_trade_draft`，当前阶段目标状态为 `documentation_and_research_workflow_ready / manual_trade_draft_ready / daily_freshness_gate_documented`。
- 允许动作仍限定为 `RESEARCH / OBSERVE / ALERT / PLAN_DRAFT`。
- `ADD / REDUCE / AUTO_TRADE` 继续禁止。
- Tushare Pro 保留为后续正式 provider 升级；当前默认使用免费数据源形成 research-grade 验证。
- 买入/卖出观察区间已接入 `priceAudit`：显示价格来源、交易日、新鲜度、价格与均线锚点一致性；当价格过期、来源未知或错配时，前端显示“需刷新后重算”，不得展示可用区间。
- 每日收盘后红利低波全 A scan 已接入 scheduler，并通过 daily idempotency key 防重复提交；免费数据源阶段只能保证“自动拉取 + 新鲜度校验 + 异常阻断”，不能承诺 100% 每日最新。

专项文档：

- PRD：`docs/DIVIDEND_LOW_VOL_PRD.md`
- 开发与验收计划：`docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md`
- 架构差异与出门条件：`docs/target-architecture-gap.drawio`，页数不超过 8 页，覆盖目标体验、当前/目标架构差异、开发计划、里程碑、验收门槛、出门条件和关键用户路径。

专项出门条件：

- 候选池可解释，所有指标显示数值、状态或明确 insufficient/upgraded warning，不留空白。
- 龙头证据、分红事实、数据验证、回测、validation、trade gate 和人工验收路径均有审计产物。
- 手动交易计划草案 ready，但 `formalTargetWeight=0`、`canCreateOrder=false`。
- 买卖观察区间必须显示 `tradeDate / sourceType / freshnessStatus / sanityStatus`；任一价格 gate 不通过时显示“需刷新后重算”。
- 每日扫描任务必须可在 Operation / scheduler 审计中追踪，不得把免费源延迟当作最新行情保证。
- 任何正式交易放行必须另过 formal validation gate 和人工复核，不能由本阶段文档更新自动释放。

自动化开发准入：

- D1-D5 可继续自动化推进并验收。
- D6 只能自动开发前置能力与阻断审计。
- 正式 provider 凭证、官方 benchmark 授权数据、真实人工验收结论、正式 `ADD / REDUCE` 和 `AUTO_TRADE` 不能由自动化流程自行放行。
- 当前文档支撑度评估为 `complete_for_D1_to_D5 / prerequisite_only_for_D6`：可以支撑研究链路、人工计划草案、日更 freshness gate、审计包和前后端用户路径继续自动化开发；不能支撑自动解锁正式交易。
- 防过度承诺规则：免费数据源不承诺 100% 每日最新，proxy benchmark 不可作为 formal benchmark，seed fallback 不可作为 verified leader，任一 validation 或 priceAudit gate 不通过时只能显示阻断或“需刷新后重算”。
- FIVD-R 当前定位为“事实输入 + 策略证据 + validation gate + trade gate”的验证框架，不是已经被证明可产生稳定交易收益的预测模型。历史数据链路、样本外诊断、walk-forward、参数敏感性和分组稳定性已有产物，但当前红利低波与既有策略仍未完成 formal validation；OOS/validation evidence 未通过前，不得把 FIVD-R 结论解释为交易有效性证明。

## 组合策略回测专项

2026-06-23 起，组合策略回测作为下一阶段 research-grade 开发目标进入主线。目标是让用户比较多个投资组合策略在不同起止时间段下的收益率曲线、回撤曲线、关键指标和 benchmark 表现。

2026-06-24 起，本专项升级为“交互式策略回测与正式交易级前置阶段”。阶段目标不是直接放行正式交易，而是让用户能在前端完整使用 FAMS 对多种交互策略进行回测、比较、审计和人工计划草案生成。完成后系统应达到：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualTradeDraftReady=true
portfolioBacktestFormalReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

2026-06-24 实现验收同步：

```text
overallStatus=passed
interactiveStrategyBacktestReady=true
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

本阶段目标体验：

- 用户进入“策略回测”页面，选择红利低波组合、当前持仓、永久组合、全天候组合、本地真实样本组合或自定义权重组合。
- 用户设置起止时间、初始资金、再平衡频率、分红处理、手续费、滑点和 benchmark。
- 页面展示多策略收益曲线、回撤曲线、指标表、benchmarkReturn、excessReturn、dividendContribution、dataCoverage、blockedReasons 和 evidenceRefs。
- 用户可从回测结果进入红利低波候选、买卖观察区间和人工计划草案，但系统仍保持 `formalTargetWeight=0`、`canCreateOrder=false`。
- 任务中心可追踪每次回测 Operation 和 artifact，审计包可复现输入、策略定义、曲线、benchmark、缺口和交易 gate。

当前状态：

- 已有 Backtest 页面、`/api/v1/backtest/run`、建议回测、策略锦标赛 equityCurve、任务中心 artifact 预览和红利低波滚动回测。
- 已新增组合回测实现实体：`PortfolioBacktestInputBuilder / PortfolioBacktestEngine / PortfolioBenchmarkService / portfolioBacktestRoutes`，并补充 `portfolioBacktestReviewService` 用于人工复核审计。
- 已新增 `/api/v1/portfolio-backtest/templates` 与 `/api/v1/portfolio-backtest/run`。
- 已在 Backtest 页面新增组合策略对比回测模块，默认可展示 3 条基于本地真实 `market_bar_canonical` 的 completed 策略曲线。
- 已接入 `local_equal_weight_20` 研究 benchmark，并展示 benchmarkReturn 与 excessReturn。
- 标准永久组合和全天候组合已有研究级代理行情路径：当 ETF 代理行情覆盖满足时可返回 completed 曲线；若本地代理行情不足则保持 insufficient。当前审计用户 `audit_portfolio_backtest_user` 已补齐真实持仓样本，因此当前持仓组合可在审计用户下返回 completed；默认用户无持仓时仍保持 insufficient。
- 红利低波篮子已接入真实 `DividendLowVolDaily` 候选快照读取、等权 v1、tradeDate、selectionRules 和 evidenceRefs；当前真实入篮数量已达 3/3，入篮标的为 `000513 / 601398 / 000333`，可作为 formal-review-ready 曲线参与多策略比较，但不解锁正式交易。
- Runtime Health 已统一接入 `/health`、`check:sqlite-health`、组合回测 API 和交互式策略回测审计包；当前 SQLite health 为 `healthy`。
- `/backtest` 已通过无头浏览器运行态验收，页面可展示 runtime gate、组合回测结果、benchmark、分红贡献、成本拖累和非交易提示。
- 免费源 total-return benchmark 已接入，组合回测可进入 formal-review-ready；官方授权 benchmark、人工复核和交易执行约束仍未解锁正式交易。
- 本专项默认输出 `RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT`，禁止 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

专项文档：

- `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`
- `docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`

目标体验：

- 用户选择永久组合、全天候组合、当前真实持仓、红利低波组合、自定义权重组合或本地真实样本组合。
- 用户设置起止日期、初始资金、再平衡频率、分红处理、手续费、滑点和 benchmark。
- 系统先以同步研究接口完成即时回测；下一阶段以 Operation 运行组合级回测，输出多组合收益率曲线、回撤曲线、指标表、benchmark 对比、数据缺口和 artifactRefs。
- 页面明确显示“研究回测，不构成交易指令”；缺数据或 proxy benchmark 时不得升级为 formal validation。
- `tradeActionReadiness=true` 在当前阶段只能解释为 `ready_for_manual_trade_draft`，不能解释为交易可用或自动执行可用。

专项出门条件：

- 能完成 `选择组合 -> 设置区间 -> 运行回测 -> 查看多组合曲线 -> 查看指标和缺口 -> 生成研究结论`。
- 每条曲线必须有 `strategyId / strategyVersion / startDate / endDate / dataCoverage / evidenceRefs`。
- 缺行情、分红、benchmark 或交易约束时必须输出 blockedReasons。
- 默认页面路径至少有 3 条 completed 曲线来自真实本地行情；标准组合只有在 ETF 代理行情覆盖达标时才能 completed，缺 ETF 数据时必须显示 insufficient。
- `local_equal_weight_20` 只能标记为 research proxy benchmark，不能作为 formal benchmark。
- 不得输出正式交易动作、自动再平衡或订单创建。

自动化开发准入：

- PBT-0 到 PBT-6 可自动化开发并验收。PBT-0 的优先级最高，用于关闭 runtime health 口径冲突。
- PBT-7 用户路径与端到端验收可自动化执行，但只能证明 research-grade 组合策略对比可用。
- PBT-8 到 PBT-10 可继续自动化开发并验收，目标为标准 ETF 代理行情补齐、正式/免费 benchmark、分红总回报研究路径和 Operation artifact 化。
- PBT-11 可自动化生成正式交易级评审前置 artifact，但不能自动解锁正式 `ADD / REDUCE`。
- 正式组合交易、自动再平衡、自动下单和 formal validation 解锁仍需独立项目、正式数据和人工复核。
- 当前组合回测文档支撑度评估为 `complete_for_research_grade_portfolio_backtest_PBT_1_to_PBT_10 / blocked_for_formal_trading`：可以指导组合策略定义、组合净值 replay、benchmark 对比、前端多曲线展示、审计包、交易 gate contract、标准代理行情补齐和研究级 total-return 开发；不能指导自动再平衡或订单创建出门。
- 当前本阶段文档支撑度更新为 `complete_for_interactive_strategy_backtest_and_formal_review_prerequisites / blocked_for_formal_trading_unlock`：可以指导前端交互式策略回测、runtime health gate、组合 Operation artifact、红利低波联动、人工计划草案和正式交易级前置审计；不能把阶段完成解释为正式交易级已经达成。
- 最新实现验收后，文档支撑度更新为 `complete_for_current_formal_review_ready_portfolio_backtest / blocked_for_formal_trading_unlock`。下一阶段若要进入正式交易级，必须补齐官方授权 benchmark、模型有效性验证、人工复核记录和正式交易执行约束。
- 正式交易级前置开发计划已补充到 `docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md`，覆盖数据等级、模型有效性、人工计划草案、前端评审工作台、审计包升级和正式交易解锁闸门。

本阶段开发顺序：

1. `PBT-0 Runtime Health 与验收口径收口`：消除 `/health`、SQLite health、红利低波 audit 和全系统 E2E 的状态冲突。
2. `PBT-8 标准组合代理行情补齐`：补齐永久组合和全天候组合代理 ETF 行情，至少 250 个交易日，不能用本地 A 股样本冒充 ETF。
3. `PBT-9 Benchmark 与分红总回报`：接入宽基 benchmark、price-only / dividend cash / reinvest 三模式，明确 formal / price_index / research_proxy 状态。
4. `PBT-10 Operation 与前端运行态验收`：组合回测支持 Operation、artifactRefs、任务中心追踪和无头浏览器用户路径验收。
5. `PBT-11 正式交易级评审前置`：生成 formal review readiness artifact，聚合 runtime、provider、benchmark、tradeability、validation、manual review 和 frontend visibility。

本阶段出门条件：

```text
interactive_strategy_backtest_ready
research_grade_strategy_comparison_ready
portfolio_backtest_formal_review_ready
manual_trade_draft_ready
runtime_health_gate_consistent
formal_trading_locked
auto_trade_locked
```

本阶段不能出门为：

```text
formal_trade_action_ready
formal_add_reduce_unlocked
auto_rebalance_ready
auto_trade_ready
```

当前 `P0-P2` 已完成第一段但未正式收口，`P3` 已完成最小后端闭环和前端持仓研究面板接入，早期 `P5` 已完成持仓建议缓存、股票事实集缓存、stale-while-revalidate、批量事实集刷新 Operation、服务启动恢复、租约心跳、到期事实集调度入口、cron 定时器、调度租约和调度状态可视化第一段。`P4.34-P4.40` 已完成全 A canonical/feature cache 扫描、60 日 evidence、top-N 深度验证、factset 80% gate、validation decision、OOS 失败分析、OOS 多窗口/市场状态复验、候选组合处置、基础设施就绪评审、市场约束覆盖报告和 P4 收口评审；当前结论仍为 `CONTINUE_RESEARCH_ONLY`，除非候选四项 validation evidence 全部通过，否则不得进入交易动作。2026-06-01 起，P4 并入 FIVD-R Core，作为内部 `validation_tournament_agent` 和 `strategyValidation / candidateDisposition` 输出；对外统一入口为 `/api/v1/analysis/fivd-r`。最新 `P5.1-P5.12` 已完成 Shadow PG readiness、证券状态覆盖、validation failure taxonomy 审计 artifact、`SecurityStatusDaily / MarketTradeabilityDaily` canonical 第一段、quote-list canonical 多源身份升级、OOS 分层复验 artifact、`p5_closure_review.json`、Node `pg` shadow 实测路径、Tushare 可选正式交易状态接口、`test:production-readiness` 自检脚本、本机 PostgreSQL shadow 配置、GPT 优化建议机器核对、免费信源分析建议 readiness、交易动作动态 readiness gate、全 A top-N 深度验证配置、证券状态分批事务、全 A top-12 复验和前端三类选股策略验收。P1-P5 结论调整为：研究/分析建议链路可收口并基于免费来源放行，交易动作仍不放行。PostgreSQL shadow/staging 已通过 smoke 验证；Tushare 仅作为用户可选增强源，不再阻断分析建议；`tradeActionReadiness` 现在自动读取最新长样本 evidence，当前唯一真实交易动作 blocker 是 `validation_evidence`，top-12 复验显示样本外收益在“高波动震荡”窗口失效。

2026-05-26 P4.31.8 检视结论：`baostock_market_cap` provider health 已统一写入，受控 40 样本 Operation `c61f3a33-e2d4-42f4-8169-86690ea6b8f7` 完成，`successCount=40 / failureCount=0`，耗时约 `11904ms`；provider health `healthy / closed`，`failureCount=0`；canonical `fullCoverageCount=182`、`multiProviderFullCoverageCount=182`；20 样本 `finalFullCoverage=100%`。未闭环项是 200-500 只中样本验收和后续 P4.32 长样本扫描。

2026-05-30 P4.34.19 检视结论：全 A factset coverage 80% gate 已达成。2000 标的 quote-list 市值补齐 Operation `d122fb49-a78e-4d8b-be5a-d1e860b7ae45` 完成 `successCount=1992 / failureCount=8`，canonical 完整覆盖从 `2514` 提升到 `4506`；全 A screener 复检 `total=5524`、正式行业覆盖 `94.24%`、正式市值覆盖 `81.61%`、完整事实集覆盖 `81.61%`。canonical 文件自身 coverage 为 `77.08%`，screener 口径合并 `StockFactSetCache` 后通过 80% gate。下一步回到策略 evidence 验证：重新跑 500/全 A 级别策略证据，确认 `factset coverage` gate 已解除；若仍被阻断，主线转向样本外稳定性和策略可信度，而不是继续堆事实源。

## 图页结构

- `目标架构`：中文分层架构图，覆盖用户层、FAMS 应用层、FAMS Connect 层、harnessOS 编排层、数据与基础设施层。
- `当前到目标 Gap 路线图`：按 V1.0、V1.5、V2.0、V3.0 展示每个阶段的技术架构、主要功能点、对应 Gap、当前进度和验收节点。

## 阶段路线

- `V1.0 可信投资账本`：资产导入/编辑、行情补全、仓位计算、标签维护、交易流水、基础止盈止损告警、稳定 REST/DTO 边界。
- `V1.5 行情可靠性与异步任务`：MarketDataService Provider fallback、失败分类、来源归因、Alerts 产物面、Operation 任务、retry/polling/artifact refs。
- `V2.0 FAMS Connect 与 MCP 工具契约`：FAMS DomainPack、工具 schema、权限元数据、HTTP MCP Bridge、stdio MCP Provider、交易保护确认。
- `V3.0 harnessOS 多 Agent 编排`：连接器注册、工作流注册、多 Agent Runtime、持久化执行、人类确认节点、产物回流 FAMS UI。

## 当前 Gap

- `GAP-1 用户交互边界`：普通维护、Agent 辅助分析、建议执行、交易入账确认和产物展示需要清晰分层。
- `GAP-2 API 边界硬化`：稳定 DTO、请求校验、用户上下文、错误契约、后续鉴权、限流和审计。
- `GAP-3 领域服务分离`：MarketDataService、SnapshotService、AdviceService、规则引擎边界继续收敛。
- `GAP-4 数据模型骨架`：Operation、AlertRule/Event、AdviceInputSnapshot、PositionSnapshot、MarketSnapshot 已在 SQLite 基线上部分落地，后续迁移 PostgreSQL 和时序存储。
- `GAP-5 市场数据可靠性`：Provider fallback、超时重试、价格差异警告、缓存、来源归因和 Python akshare 原型归属决策。
- `GAP-6 Connect 与 MCP 成熟度`：工具契约、DomainPack、HTTP/stdio MCP、外部 Agent 边界和真实编排。
- `GAP-7 异步任务骨架`：Operation 状态、轮询、重试、取消、产物引用和后续队列 worker。

## 节点验收与进度同步规则

每到一个开发节点必须执行一次端到端验证。默认验收包含：

- 后端接口返回正确。
- 数据库或持久化状态正确。
- 前端运行态显示或交互正确。
- 关键业务结果一致，例如价格、仓位、交易、告警、任务状态。

验证通过后，同步更新：

- `docs/target-architecture-gap.drawio` 对应阶段或 Gap 的进度记录。
- 本文件对应阶段、Gap 或验收说明。

进度记录格式：

```text
进度 YYYY-MM-DD：完成能力描述。
验证：后端接口、数据库状态、前端运行态、关键业务结果。
状态：已完成 / 部分完成 / 待验证 / 待启动。
```

未经过端到端验证的能力不得标记为“已完成”，只能标记为“部分完成”或“待验证”。

进度 2026-05-27：执行 P4.32.2 受控长样本验收闭环。开始前复验 P4.31/P4.32：后端/前端 TypeScript 通过，quote-list canonical、market-cap worker、20 样本事实集预热和 120 样本 dry-run 均可完成。评审后决定新增可配置受控长样本入口，不直接启动真实全 A 全量扫描。

验证：`run-long-sample-dry-run.ts` 支持 `FAMS_LONG_SAMPLE_SCAN_LIMIT / BACKTEST_DAYS / HOLDING_DAYS / CHUNK_SIZE / QUERY`，新增 `npm run run:long-sample-controlled`。500 样本首次 dry-run 暴露 `cacheHitRate=24.2%` 和 `factset_coverage=78%`；市值补齐和坏数据跳过修复后，canonical 完整覆盖提升到 `437`，500 样本事实集覆盖 `87.2%`；复跑 Operation `d772c4ae-91bb-45fd-a140-a1c385c1f104` 得到 `scannedCount=500`、`evaluatedCount=499`、`providerSuccessRate=99.8%`、`cacheHitRate=99.43%`、`bestSampleSize=234`、`bestCredibility=medium`。唯一剩余 blocker 为 `universe_coverage=9.05% < 80%`。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 中“受控长样本缓存命中和事实集覆盖不可验证”的缺口，也填补 `GAP-6 决策建议结构化` 中“成交样本量不足导致策略证据无法升级”的阶段性缺口。P4.32 仍不能标记全量通过，下一步进入 1000 样本和更高覆盖 gate 的受控验收。

进度 2026-05-27：执行 P4.32.3 1000 样本受控长样本验收。开始前复验 1000 样本准入，事实集覆盖仅 `43.6%`、行情缓存命中估算 `49.69%`，不能直接跑长样本。按评审要求先执行 market bar 预热和 quote-list 市值补齐。

验证：1000 样本 market bar 预热补齐 506 个缺口，`estimatedCacheHitRate` 从 `49.69%` 提升到 `99.47%`；quote-list 市值补齐 500 样本，`successCount=499 / failureCount=1`，canonical 完整覆盖提升到 `975`；1000 样本事实集覆盖复检为 `97.4%`。随后运行 Operation `f0bd05f5-2c61-47cd-973f-bbe07b9d954e`，结果 `scannedCount=1000`、`evaluatedCount=997`、`providerSuccessRate=99.7%`、`cacheHitRate=99.52%`、`bestSampleSize=488`、`bestCredibility=medium`。唯一剩余 blocker 为 `universe_coverage=18.11% < 80%`。

状态：部分完成。该节点进一步填补 `GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化`，证明 1000 样本阶段 provider、缓存、事实集和回测样本量可支撑 medium 证据；全 A 级 80% 覆盖仍待后续 2000 样本与性能专项验收。

进度 2026-05-27：执行 P4.32.4 2000 样本受控长样本验收。开始前复验发现事实集预热被代码硬限制为 1000 样本，已将 `preheatScreenerFactsets` 上限放宽到 `6000`，使 2000 样本和后续全 A 阶段能真实检查覆盖。

验证：2000 样本 market bar 预热补齐 1008 个缺口，耗时 `1648185ms`，拉取 `120275` 条 K 线，缓存命中估算从 `49.83%` 提升到 `99.68%`；预热中 `300534` 暴露一次 SQLite provider health upsert timeout。quote-list 市值补齐 Operation `739a33b0-6da9-4a09-a402-2364f4839b16` 完成，`successCount=995 / failureCount=5`，canonical 完整覆盖提升到 `1970`；2000 样本事实集覆盖复检为 `98.45%`。随后运行 Operation `f9cfc6b9-874a-41f5-b9bd-5aa1def19ede`，结果 `scannedCount=2000`、`evaluatedCount=1997`、`providerSuccessRate=99.85%`、`cacheHitRate=99.71%`、`bestSampleSize=828`、`bestCredibility=high`、`artifactRefs=17`。唯一剩余 blocker 为 `universe_coverage=36.21% < 80%`。

状态：部分完成。该节点证明 2000 样本阶段已可产生 high 级最佳策略证据，但 P4.32 仍未达到全 A 80% 覆盖。下一步优先处理 `GAP-7 异步任务骨架` 和 `GAP-5 市场数据可靠性` 的性能风险：market bar 预热和 quote-list 市值补齐需要正式 Operation/worker 化，并对 SQLite 写入超时、artifact 体积和恢复能力做专项验收。

进度 2026-05-30：执行 P4.34.19 Factset Coverage 80% Gate 收口。开始前复验 P4.34.18，确认全 A screener factset coverage 仍只有约 `45.51%`，行业覆盖已达 `94.24%`，主要缺口是市值事实不足。评审后决定不新增策略、不放松证据门槛，只继续执行 quote-list market-cap warmup。

验证：2000 标的市值补齐 Operation `d122fb49-a78e-4d8b-be5a-d1e860b7ae45` 状态 `partial`，`requestedSymbols=2000`、`successCount=1992`、`failureCount=8`；失败标的为 `301096 / 600193 / 600421 / 600599 / 600608 / 600636 / 600696 / 605081`，均为 BaoStock 缺少 `close/volume/turn`，未污染 canonical。canonical `fullCoverageCount=2514 -> 4506`，全 A screener 事实集复检 `officialIndustryCoveragePercent=94.24%`、`officialMarketCapCoveragePercent=81.61%`、`fullOfficialCoveragePercent=81.61%`。`test:quote-list-canonical` 和 `test:quote-list-market-cap-worker` 均通过。

状态：部分完成但关键 gate 已闭环。该节点填补 `GAP-6 决策建议结构化` 中“行业/市值分组稳定性事实覆盖不足”的核心阻断；P4 仍不能整体完成，因为 top-N 深度验证的样本外证据此前仍 failed。下一步必须重新跑策略 evidence 验收，确认 factset gate 解除后，剩余 blocker 是否集中在 validation evidence / OOS 市场状态稳定性。

进度 2026-05-30：执行 P4.34.20 策略 Evidence 复验。开始前复验 P4.34.19，确认 factset coverage gate 已超过 80%，因此本节点不新增策略、不继续堆事实源，只验证 evidence blocker。

验证：500 样本 Operation `05c0c20d-c203-4411-878d-90d8fa5817ee` 完成，scanned=`500`、evaluated=`494`、providerSuccessRate=`98.8%`、cacheHitRate=`99.96%`、bestSampleSize=`281`、bestCredibility=`medium`、scanned factset coverage=`99.8%`；唯一失败 gate 为 `universe_coverage=9.05%`，符合样本限制。随后 confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f` 完成，scanned=`5524`、evaluated=`5447`、failureCount=`77`、scanCoveragePercent=`100%`、providerSuccessRate=`98.61%`、cacheHitRate=`99.95%`、bestSampleSize=`3766`、bestCredibility=`high`、factsetCoverage=`81.64%`、artifactCount=`21`。唯一失败 gate 为 `validation_evidence`，OOS 诊断 `diagnosedCandidates=3 / passedCount=0 / failedCount=3`。

状态：部分完成。该节点确认 `GAP-6` 中事实集覆盖 blocker 已解除，剩余核心 Gap 转为“策略候选无法通过样本外验证”。下一步 P4.34.21 聚焦 OOS 失败原因、时间切分和策略可信度规则，不新增选股策略。

进度 2026-05-30：执行 P4.34.21 Validation Decision 与 Evidence 引用收口。开始前复验 P4.34.20，确认唯一 blocker 为 `validation_evidence`，因此本节点不新增策略，只把动作边界和 evidence 选择规则收紧。

验证：新增 `validation_decision.json` artifact，Operation result 和 `data_quality_report.json` 同步写入 `validationDecision`。validation 未通过时 decision=`OBSERVE_ONLY`，allowedActions=`RESEARCH / OBSERVE`，prohibitedActions=`ADD / REDUCE / AUTO_TRADE`。异步 evidence 引用改为优先 full scan coverage、acceptance status 和可信度，不再简单按最近完成选择。运行态验证普通选股 `扫描上限=5` 始终引用 confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`；小样本 Operation `43cb6a65-6244-40a6-92c1-a8750f5c5424` 生成 `validation_decision.json` 并正确标记 `OBSERVE_ONLY`。后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过。

状态：部分完成。该节点填补 `GAP-6 决策建议结构化` 中“策略证据未通过时动作边界不可机器读取”的缺口，也降低局部样本证据误覆盖全 A 证据的风险。剩余核心缺口仍是 OOS 失败本身，下一步进入收益分布、日期分布和候选组合失败对比。

进度 2026-05-31：执行 P4.34.22 OOS 失败收益分布与候选组合对比。开始前复验 P4.34.21，确认 validation 决策已结构化为 `OBSERVE_ONLY`，本节点不新增策略、不放宽 gate，只补充失败诊断证据。

验证：新增 `oos_failure_analysis.json` artifact，并在 Operation result、`data_quality_report.json` 和 `validation_decision.json.evidenceRefs` 中引用。产物按候选组合输出训练窗口/样本外窗口收益分布、超额/均值/中位数/胜率变化、signalDate 日期桶和 failureTags。前端任务中心新增“OOS失败分析”artifact 预览，用于查看全局结论、失败标签和候选组合对比。

状态：已完成。该节点填补 `GAP-6 决策建议结构化` 中“OOS 失败原因无法被前端和 AI 解释层审计”的缺口。后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过；小样本 Operation `51de6890-c3df-486f-b9ae-ba4916507485` 验证 artifactCount=`23`，包含 `oos_failure_analysis.json`，validation decision 继续禁止 `ADD / REDUCE / AUTO_TRADE`。P4 仍保持交易建议阻断，因为 validation evidence 尚未通过。

进度 2026-05-31：执行 P4.34.23 PostgreSQL / Worker 基础设施就绪评审产物。开始前复验 P4.34.22，确认 OOS 失败已可审计，但 P4 总计划仍缺 PostgreSQL/worker 级别性能验收的机器可读 gate。本节点不切库、不改策略，只补基础设施审计产物。

验证：新增 `infrastructure_readiness_report.json` artifact，写入 Operation result 和 `data_quality_report.json`。产物记录 database provider、executionMode、marketDataMode、chunkSize、concurrency、artifactCount 和 `database_provider / execution_mode / market_data_mode / chunk_size` gates，并列出正式全 A 前置项、SQLite 允许范围和 PostgreSQL 目标能力。前端任务中心新增“基础设施就绪”预览。

状态：已完成。该节点填补 `GAP-7 异步任务骨架 / PostgreSQL迁移` 中“正式全 A 长样本缺少基础设施 readiness gate”的缺口。后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过；小样本 Operation `123d8057-aa05-4e93-9e1b-503066fcca97` 验证 artifactCount=`24`，包含 `infrastructure_readiness_report.json`，当前 SQLite 环境 readinessStatus=`blocked`，符合不能把 SQLite inline dry-run 当作生产级全 A 通过的约束。

进度 2026-05-31：执行 P4.34.24 市场约束覆盖报告。开始前复验 P4.34.23，确认基础设施 readiness 已可审计；本节点聚焦 P4 剩余的停牌/退市事实源不足问题，不新增策略、不改变回测 gate。

验证：新增 `market_constraint_coverage_report.json` artifact，写入 Operation result 和 `data_quality_report.json`。产物统计 executedSamples、blockedSamples、blockedRatioPercent、uniqueBlockedSymbols、blockedReasonSummary、providerGaps 和 nextActions；前端任务中心新增“市场约束覆盖”预览。

状态：已完成。该节点填补 `GAP-6 / MarketConstraint` 中“市场不可成交约束有执行但缺少覆盖率和正式源缺口审计”的缺口。后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过；小样本 Operation `71bc0ab2-ca65-4e80-ae9a-56275a539e4f` 验证 artifactCount=`25`，包含 `market_constraint_coverage_report.json`，coverageStatus=`needs_official_status_provider`，providerGaps 明确包含正式证券状态、停复牌状态和涨跌停价字段缺口。市场约束覆盖报告已闭环；正式 provider 接入仍未闭环，validation 未通过前继续禁止交易动作。

进度 2026-05-31：执行 P4.34.25 P4 收口评审产物。开始前复验 P4.34.24，确认市场约束覆盖和正式源缺口已可审计；本节点聚合长样本验收、验证决策、基础设施 readiness、市场约束覆盖，不新增策略、不改变 gate。

进度 2026-05-31：完成 P5.1 第一段审计产物。开始前复验 P4.34.25，确认 P4 closure 为 `blocked_for_production / CONTINUE_RESEARCH_ONLY`。本节点新增 `postgres_shadow_readiness_report.json`、`security_status_coverage_report.json`、`validation_failure_taxonomy.json`，并让 `p4_closure_review.json` 引用这三个 P5 artifact。小样本 Operation `b54125e4-b4e7-4fd2-b8ec-5007688ac038` 验证 artifactCount=`29`，PG shadow status=`not_configured`，证券状态覆盖 status=`not_started`，失败分类 status=`blocked_for_trading`、decision=`OBSERVE_ONLY`。该节点填补 `GAP-5 市场数据可靠性`、`GAP-6 决策建议结构化`、`GAP-7 异步任务骨架` 中“生产阻断点缺少独立审计产物”的缺口；剩余阻断为 PostgreSQL shadow/staging 实装、正式证券状态 canonical provider、OOS 分层/市场状态 bucket 复验。

进度 2026-05-31：完成 P5.2 证券状态 canonical 事实层第一段。新增 `SecurityStatusDaily` 与 `MarketTradeabilityDaily`，`securityStatusService` 从标的名称和最新 K 线生成 heuristic 过渡事实，并输出 `fams.market.security_status_coverage_snapshot.v1`。`stock_screener_full_scan / strategy_tournament_run` 新增 `security_status.canonicalize` task，`MarketConstraint` 第一段优先读取证券状态事实层，再 fallback 到旧启发式规则。小样本 Operation `0881de2a-0f65-449c-912d-d8ef40d1632e` 验证 security task completed、successCount=`4`、provider=`heuristic`；`security_status_coverage_report.json` status=`partial`，coverageSnapshot statusRows=`4`、tradeabilityRows=`4`、officialProviderRows=`0`、heuristicRows=`8`。该节点填补 `GAP-5 市场数据可靠性` 与 `GAP-6 决策建议结构化` 中“证券状态事实层缺失”的缺口；正式 provider 行仍为 0，因此交易建议阻断不解除。

进度 2026-05-31：完成 P5.3 quote-list canonical 多源身份升级。开始前复验 P5.2，确认证券状态表已经落库但 provider 仍为 `heuristic`。本节点让 `securityStatusService` 优先读取 `a-share-quote-list-canonical` 的多源股票身份、名称、交易所和上市状态信息，再降级到 heuristic fallback。小样本 Operation `85d6c35d-34bc-4f88-8e95-a6fe337a4ae0` 验证 `security_status.canonicalize` completed，successCount=`4`，provider=`quote_list_canonical`；`security_status_coverage_report.json` status=`partial`，coverageSnapshot requestedSymbols=`4`、statusRows=`4`、tradeabilityRows=`4`、officialProviderRows=`8`、heuristicRows=`0`、latestTradeDate=`2026-05-29`。该节点把证券身份从纯启发式推进到多源 canonical 引用，但停复牌和涨跌停仍缺正式交易状态源，因此交易建议阻断不解除。

进度 2026-05-31：完成 P5.4 / P5 收口评审。新增 `p5_closure_review.json` artifact，聚合 `postgres_shadow_readiness_report.json`、`security_status_coverage_report.json`、`validation_failure_taxonomy.json` 和 `p4_closure_review.json`，并输出 P5 gate、completedEvidence、remainingBlockers 和 nextActions。小样本 Operation `4f4a6d31-3f7c-4993-818b-9256f9114843` 验证 status=`partial`、artifactCount=`30`、`p5_closure_review.json` schema=`fams.screener.p5_closure_review.v1`、status=`partial`、decision=`P5_COMPLETE_RESEARCH_ONLY`，summary 显示 PostgreSQL shadow=`not_configured`、security status coverage=`partial`、validation failure taxonomy=`blocked_for_trading`、P4 decision=`CONTINUE_RESEARCH_ONLY`、productionReady=`false`。该节点把 P5 标记为研究闭环完成，但生产仍阻断；后续进入 P6 或交易建议前，必须先完成 PostgreSQL shadow/staging、正式交易状态源和 OOS 分层复验。

进度 2026-05-31：执行 P5.5 生产阻断项继续处理。新增 `oos_layered_validation.json`，按市场状态、行业、市值三维复验样本外收益分布；`postgres_shadow_readiness_report.json` 新增 verification 字段，明确当前缺 shadow URL 和 `psql`；证券状态 coverage 新增 `formalTradingStateRows` 与 `formal_trade_state_rows` gate，区分多源身份和正式交易状态。小样本 Operation `b7f50f35-bf1a-4069-9d5c-66c14eccd51e` 验证 status=`partial`、artifactCount=`31`，`oos_layered_validation.json` status=`insufficient`，PG shadow status=`not_configured / psql_missing`，P5 closure 仍为 `P5_COMPLETE_RESEARCH_ONLY / productionReady=false`。该节点完成产物和审计链路，但生产阻断不能解除。

进度 2026-05-31：完成 P5.6 生产阻断项自动转绿路径。开始前复验 P5.5，确认不能通过调低 gate 或静态报告把红灯改绿。本节点新增 `pg` client 实测路径：配置 `FAMS_POSTGRES_SHADOW_DATABASE_URL / POSTGRES_SHADOW_DATABASE_URL` 后，系统会连接真实 PostgreSQL、创建 `fams_shadow` schema、创建三张 staging 表并执行事务内 smoke insert/count/rollback，全部通过才把 `postgres_shadow_readiness_report.json` 置为 `ready`。证券状态侧新增可选 Tushare provider：配置 `FAMS_TUSHARE_TOKEN / TUSHARE_TOKEN` 后抓取 `stock_basic / suspend_d / stk_limit`，写入 provider=`tushare` 的上市状态、停复牌和涨跌停价事实，`formalTradingStateRows` 才能真实增长。当前本机仍未配置 PG URL 和 Tushare token，因此小样本 Operation `b7b6e30c-dc9b-440d-929b-9fce9731c877` 保持 `partial`，P5 closure 仍为 `P5_COMPLETE_RESEARCH_ONLY / productionReady=false`。该节点填补“缺少真实外部依赖验收路径”的缺口，但不解除生产阻断。

进度 2026-05-31：完成 P5.7 生产就绪自检脚本与正式状态口径收紧。新增 `backend/scripts/verify-production-readiness.ts` 和 `npm run test:production-readiness`，输出 `fams.production_readiness_check.v1`，聚合 PG shadow readiness 与证券状态 coverage，并在 `--strict` / `FAMS_READINESS_STRICT=1` 下作为 CI 门禁。Tushare `stock_basic` 查询从仅 `L` 扩展为 `L / D / P`，分别映射在市、退市、暂停上市；涨跌停价 gate 收紧为必须存在 `formalTradingStateRows > 0` 且正式源涨跌停覆盖非零。当前环境自检 `productionReady=false`，`postgres_shadow_ready / tushare_formal_trading_state / limit_price_coverage` 均 failed。该节点填补“红绿状态只能从 Operation artifact 手工判断”的缺口，并防止 quote-list/heuristic 覆盖率误导生产放行。

进度 2026-05-31：完成 P5.8 PostgreSQL Shadow 本机配置与 GPT 优化核对。通过 winget 安装 Windows PostgreSQL 17，服务 `postgresql-x64-17` 运行，创建 `fams_shadow` 数据库和用户，并写入 `backend/.env` 的 `FAMS_POSTGRES_SHADOW_DATABASE_URL`。`npm run test:production-readiness` 验证 `postgres_shadow_ready=passed`，但 `productionReady=false`，因为 Tushare 正式交易状态和正式源涨跌停价仍 failed。新增 `npm run test:gpt-optimization-plan`，核对 GPT 优化建议 12/12 项通过，状态为 `implemented_with_external_blockers`。该节点填补 PG shadow 真实环境缺口和“GPT 优化建议是否完成不可机器核对”的缺口；交易建议仍被 Tushare/OOS gate 正确阻断。

验证：新增 `p4_closure_review.json` artifact，写入 Operation result 和 `data_quality_report.json`。产物输出 phase、status、decision、summary、gates、completedEvidence、remainingBlockers、nextActions 和 artifactRefs；前端任务中心新增“P4收口评审”预览。

状态：已完成。该节点填补 `GAP-6 / GAP-7` 中“P4 多个证据产物分散、缺少统一收口结论”的缺口。后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过；小样本 Operation `7af9fa17-cdf2-443b-a78a-3019c22b926c` 验证 artifactCount=`26`，包含 `p4_closure_review.json`，status=`blocked_for_production`，decision=`CONTINUE_RESEARCH_ONLY`。P4 现在具备统一机器可读结论：可继续研究，但 validation 未通过、基础设施未生产 ready、正式 provider 未接入前，不得进入交易建议。

进度 2026-05-28：执行 P4.33.1 market bar 预热 Operation 化第一段。开始前复验 P4.32.4，确认同步预热脚本耗时长且出现 SQLite 写入超时，因此先把 K 线预热迁入 Operation/worker，不继续直接扩大样本覆盖。

验证：新增 `market_bar_cache_preheat` Operation 类型、`POST /api/v1/operations/market-bar-cache-preheat` 和任务中心 `预热K线` 入口；支持 limit/days/chunkSize/concurrency/forceRefresh、queued worker 领取、chunk task、cacheHitRate、warnings、`market_bar_cache_preheat_report.json` artifact。小样本 Operation `c2bb9772-d05f-4793-9e8f-16f81687fe27` 通过 worker 执行完成，`requestedSymbols=4`、`attemptedSymbols=1`、`successCount=1`、`failureCount=0`、`fetchedBars=120`，artifact 通过前端代理读取成功。后端/前端 TypeScript 均通过。

状态：部分完成。该节点填补 `GAP-7 异步任务骨架` 中“market bar 预热不能作为可查询、可恢复任务运行”的缺口。下一步继续做取消/恢复专项、2000 样本 queued 验收和 SQLite timeout 复现优化。

进度 2026-05-25：执行 P4.31 事实集覆盖补齐第一段。开始前复验 P4.30：后端 TypeScript、`test:operation-worker-readiness` 和 `test:operation-recovery` 均通过。评审后决定先把事实集预热拆为独立入口，不在回测主路径中隐式批量调用 provider。

验证：新增 `preheatScreenerFactsets`、`npm run run:screener-factset-preheat` 和 `npm run test:screener-factset-preheat`；成功标准收紧为必须同时取得东方财富行业板块和总市值/流通市值。`test:screener-factset-preheat` 指定 `601127` 验证覆盖率 `100%`；受控 20 样本预热完成，`universeSource=sina_hs_a_all_a_share`、`attemptedSymbols=20`、`successSymbols=0`、`failureSymbols=20`、`initialFullCoverage=0`、`finalFullCoverage=0`，provider 多次返回 empty reply 且前排样本缺少正式行业/市值事实。

状态：部分完成且阻断下一阶段。该节点填补 `GAP-6 决策建议结构化` 中“事实集预热缺少独立验收入口和严格成功口径”的缺口，但没有填补“扫描样本覆盖率 >= 80%”的验收门槛。P4.32 全 A 长样本正式扫描暂缓，下一步必须先修复行业/市值事实 provider 或接入独立批量行业/市值数据源。

进度 2026-05-25：执行 P4.31.4 多信源 quote-list canonical 与交叉验证。开始前复验 P4.31.3：缓存回退报告不会误报外部刷新成功，但 20 样本覆盖率仍为 75%。评审后决定先用 BaoStock、AKShare 和东方财富本地缓存合成 canonical quote-list，不新增选股策略、不绕过覆盖闸门。

验证：新增 `a_share_quote_sources.py`、`run:quote-list-canonical-refresh` 和 `test:quote-list-canonical`；后端 TypeScript 通过；canonical refresh 输出 `itemCount=5846`，BaoStock `5531`、AKShare `5522`、本地 Eastmoney 缓存 `16`；`test:quote-list-canonical` 通过，10 个完整样本 `finalFullCoverage=100`；受控 20 样本预热 `successSymbols=16 / failureSymbols=4 / finalFullCoverage=80%`。Drawio 读取通过。

状态：部分完成。该节点填补 `GAP-6 决策建议结构化` 中“行业/list status 依赖单一东方财富来源”和“provider 失败不可追踪”的缺口。剩余阻断是市值多源完整覆盖仍不足，P4.32 前必须补市值第二来源，真实全 A 长样本暂不标记高可信验收。

进度 2026-05-25：执行 P4.30 PostgreSQL / worker 性能验收与全量扫描前置评审第一段。开始前复验 P4.29：后端/前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest` 和 `target-architecture-gap.drawio` 读取均通过。评审后决定先补 worker 领取和恢复能力，不直接触发真实全 A 全量扫描。

验证：`stock_screener_full_scan` 新增 `executionMode=queued`；新增 `runNextQueuedOperation / executeQueuedOperation` 和 `npm run run:operation-worker-once`；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:operation-worker-readiness` 通过，排队小样本 Operation `2cacf6d0-9ac5-4afd-aa15-ea9f1559baca` completed，6 个任务记录、17 个 artifactRefs，过期租约 Operation `2a766ac2-055a-4c38-ac30-afb15aaaed99` completed 且写入 `recovery.reason=expired_lease_worker_recovery`；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:operation-recovery` 通过，原 batch factset 恢复未回归。

状态：部分完成。该节点填补 `GAP-7 异步任务骨架` 中“选股扫描缺少独立 worker 领取、恢复和性能前置验收”的缺口。当前仍未迁移 PostgreSQL，真实全 A 长样本仍需在事实集覆盖补齐和全量扫描前置评审后执行。

进度 2026-05-25：执行 P4.29 market bar 缓存预热与 universe 来源防误判。开始前复验 P4.28：长样本 dry-run Operation 可完成并生成 17 个产物，但缓存命中率低，后续复跑发现全 A 股票池 provider 偶发失败时会 fallback 到 9 个默认标的，存在小样本误判风险。评审后决定先补缓存覆盖报告、缺口预热脚本和 universe 来源硬 gate。

验证：`getAllAshareStocks(true)` 拉取全 A 成功，数量 `5521`；`npm run run:market-bar-cache-preheat` 使用 `sina_hs_a_all_a_share`、`universeTotal=5521`、120 样本、120 日窗口运行，预热前估算 cache hit rate `100%`，只补 1 个缺口标的且无 warning；复跑 Operation `29dbb2f3-f238-45c4-92ca-8b551a8ed011` 状态 `completed`，`universeSource=sina_hs_a_all_a_share`、`scannedCount=120`、`evaluatedCount=120`、`providerSuccessRate=100%`、`cacheHitRate=100%`。`long_sample_acceptance` 新增 `universe_source` blocker，fallback 股票池不能通过验收。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 中“缓存命中低且缺少预热缺口报告”的缺口，也填补 `GAP-6 决策建议结构化` 中“fallback universe 可能被误当作全 A 长样本”的缺口。剩余阻断为扫描覆盖率 `2.17% < 80%`、最佳样本数 `83 < 100`、稳定性证据不足和事实集覆盖 `0%`。下一步进入 PostgreSQL/worker 性能验收和全量扫描前置评审。

进度 2026-05-25：执行 P4.28 长样本 dry-run 实际运行与产物沉淀。开始前复验 P4.27：后端/前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。新增 `npm run run:long-sample-dry-run`，用于提交 dry-run Operation 并输出 `long_sample_acceptance.json` 摘要。

验证：Operation `65a36d22-c4cc-400b-8755-0cf2a62a2618` 状态 `completed`，耗时约 `155479ms`，生成 17 个 artifact。配置为 `扫描上限=120；验证天数=60；持有天数=3；跳过事实集预热=1`。结果 `universeSize=5521`、`scannedCount=120`、`evaluatedCount=120`、`failureCount=0`、`providerSuccessRate=100%`、`cacheHitRate=7.42%`、`bestSampleSize=83`、`bestCredibility=low`。验收结论 `insufficient`，失败 gate 为覆盖率、缓存命中率、成交样本量、稳定性证据和事实集覆盖。

状态：部分完成。该节点证明长样本 dry-run 链路可执行且 provider 在 120 样本下稳定；也明确暴露出下一阶段瓶颈：缓存命中率低、事实集覆盖低、扫描覆盖不足、样本量未达 medium 门槛。剩余 P4 缺口：market bar 缓存预热、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.27 长样本验收受控入口第一段。开始前复验 P4.26：后端/前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。评审后决定新增固定模式，不再依赖人工手写 query。`stock_screener_full_scan` 新增 `mode=default / long_sample_dry_run / long_sample_full`；dry-run 预设为 `扫描上限=120；验证天数=60；持有天数=3；跳过事实集预热=1`；真实全 A 长样本必须传 `confirmedFullScan=true`，否则提前拒绝。任务中心新增“长样本验收”按钮，默认提交 dry-run。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证未确认真实全量长样本扫描会被阻断；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“长样本验收入口依赖手写参数且真实全量任务缺少显式保护”的缺口。剩余 P4 缺口：真实长窗口 dry-run/全量运行产物、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.26 全 A 长样本验收闸门第一段。开始前复验 P4.25：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。评审后决定先补验收闸门，不新增选股策略。全市场扫描新增 `long_sample_acceptance.json`，按全 A 扫描覆盖、provider 成功率、缓存命中、回测窗口、成交样本、稳定性验证和事实集覆盖给出 passed/failed/insufficient，并嵌入 `data_quality_report.json`；任务中心新增“长样本验收”预览。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证短窗 fixture 不会通过长样本闸门；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“缺少长样本验收闸门，短窗扫描可能被误当成高可信结论”的缺口。剩余 P4 缺口：真实全 A 长窗口样本运行、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.25 按覆盖缺口触发可取消事实集预热第一段。开始前复验 P4.24：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。评审后决定预热必须有上限、可取消、可审计。全市场扫描会先生成初始覆盖率；若扫描样本完整覆盖率低于阈值，进入 `factset.preheat_missing` 任务，对缺少行业或市值事实的扫描样本按上限刷新股票事实集，默认上限 20、阈值 80%，每个标的前检查取消状态。预热后重新读取 `StockFactSetCache`，最终 `factset_preheat_coverage.json` 记录 initial、preheat 和最终覆盖率。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证覆盖率报告携带 preheat 成功/失败统计；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“覆盖率缺口不能自动进入受控补齐”的缺口。剩余 P4 缺口：真实全 A 长窗口样本、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.24 批量事实集预热覆盖率第一段。开始前复验 P4.23：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。评审后决定先做覆盖率审计，不在回测主路径中发起大规模外部 provider 调用。全市场扫描新增 `factset.preheat_coverage` 任务，统计扫描样本和全 universe 的正式行业覆盖率、正式市值覆盖率、完整覆盖率、缺失行业/市值样本预览和 provider 分布；Operation 产物新增 `factset_preheat_coverage.json`，`data_quality_report.json` 同步嵌入该报告；任务中心新增“事实集覆盖”artifact 预览。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证覆盖率 schema、完整覆盖率、缺失样本预览和 warning；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“正式行业/市值缓存覆盖率不可见”的缺口。剩余 P4 缺口：按缺口触发可取消的批量事实集预热、真实全 A 长窗口样本、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.23 正式行业/市值缓存接入第一段。开始前复验 P4.22：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。评审后决定不在回测主路径实时调用外部 provider，先读取 `StockFactSetCache` 中已落库的东方财富行业板块、总市值和流通市值事实。全 A universe 会补充 `officialIndustryGroup / officialIndustryCode / totalMarketCap / floatMarketCap / metadataAsOf / metadataWarnings`；分组稳定性优先使用 `eastmoney_fundamental_cache`，并在 `groupMetadata` 中写入 `asOf / sourceRefs`；缓存缺失时保留 P4.22 的降级规则和 warning。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证正式缓存优先级、行业板块 `乘用车(BK1262)`、市值分组和 `sourceRefs`；`npm run test:screener-service` 验证持久化回测报告链路仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“分组稳定性缺少正式行业/市值事实输入”的缺口。剩余 P4 缺口：批量事实集预热覆盖率、真实全 A 长窗口样本、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-25：执行 P4.22 分组元数据血缘第一段。开始前复验 P4.21：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest` 和 `target-architecture-gap.drawio` 读取均通过。评审后决定本节点不直接新增外部 provider，而是先让当前分组结果可审计、可降级、可解释。每笔样本新增 `groupMetadata`，对市场板块、行业分组、市值/流动性代理、市场状态分别记录 `value / provider / method / confidence / warnings`；分组稳定性报告新增维度级 `providerSummary / averageConfidence` 和分组桶级 `provider / method / confidence`；任务中心分组稳定性预览展示 provider 与置信度；样本交易 CSV 新增 provider 和分组置信度字段。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证分组元数据 schema、provider summary 和分组置信度；`npm run test:screener-service` 验证持久化回测报告链路仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“分组稳定性结果缺少数据血缘和可信度”的缺口。剩余 P4 缺口：正式行业分类与总市值/流通市值 provider、真实全 A 长窗口样本、PostgreSQL/worker 性能验收、分组证据联动到持仓建议。

进度 2026-05-24：执行 P4.19-P4.21 分组稳定性与 P4 剩余计划统一评审。开始前复验 P4.18：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。统一评审后确认未来 P4 开发计划：不新增选股策略，先完成分组稳定性、真实长窗口样本、PostgreSQL/worker 性能验收、正式行业/市值数据源和持仓建议证据联动。当前节点已完成第一段分组稳定性：每笔样本新增市场板块、行业分组、市值/流动性代理、市场状态；每个候选组合新增 `groupStabilityValidation`，按四个维度输出分组样本、胜率、平均收益、超额收益、最大回撤、状态和 warnings。Operation 产物新增 `group_stability_report.json`，任务中心新增“分组稳定性”导航和预览，`sample_trades.csv` 新增分组字段。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证分组稳定性 schema、四类维度和样本上下文字段；`npm run test:screener-service` 验证分组稳定性进入持久化回测报告。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“策略总体胜率不能说明跨市场状态、行业、市值分组是否稳定”的缺口。剩余 P4 缺口：真实全 A 长窗口样本、正式行业/市值数据源替代启发式分组、PostgreSQL/worker 级性能验收、分组结论联动到 `PositionAdviceFactSet.strategyEvidence`。

进度 2026-05-19：完成全 A 选股异步化与历史行情缓存第一段。新增 `operations` 下的 `operation_tasks` 分片任务记录；新增 `market_bar_raw / market_bar_canonical / provider_health`，把 provider 原始 K 线、标准 K 线、来源引用、质量 flags、payload hash、缓存命中率、provider 熔断和退避重试纳入持久化。全 A 扫描新增 `stock_screener_full_scan` Operation，按 `universe.snapshot / market_data.warmup / strategy.evaluate / backtest.aggregate / artifact.generate` 运行，并生成 leaderboard、候选列表、策略指标、数据质量报告、provider 健康报告五类产物。

验证：后端/前端 TypeScript 检查通过；Prisma schema 已同步。端到端小样本 Operation `07f2582e-cb22-4f13-98ec-79f14ac51535` 完成，任务分片落库，`artifactRefs=5` 且 `leaderboard.json` 可通过 `/api/v1/operations/artifacts/:ref` 读取。数据库验证 `operation_tasks=10`、`market_bar_raw=2209`、`market_bar_canonical=2200`，provider health 可查询。前端任务中心新增“全A选股扫描”入口和任务分片表，展示进度、取消、成功/失败数、provider、缓存命中率、warnings 和产物入口。

状态：部分完成。已填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架` 的关键缺口；全量扫描正式验收前仍需把 SQLite 当前并发写入瓶颈迁移到 PostgreSQL 或后台队列 worker。

进度 2026-05-19：合并 GPT 架构建议并锁定 FAMS 后续开发计划。正式确认 FAMS 不做“LLM 直接买卖建议”，而是按 `账本 -> 行情与事实数据 -> 三面事实集 -> 策略信号与回测证据 -> 仓位管理引擎 -> AI 解释与交易计划草案 -> 人工确认` 推进。`docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md` 已补充 P0-P6 路线、`PositionAdviceFactSet`、`PositionAdviceEngine`、技术指标分层、加减仓规则、策略锦标赛拆分、回测约束、持仓事实集缓存和 Agent 权限边界。

验证：文档已落盘，本文件同步更新开发顺序和硬边界；`docs/drawio-summary.txt` 同步记录。该节点为计划锁定，不标记业务能力完成。后续进入 `P3 PositionAdviceFactSet + PositionAdviceEngine` 前，仍需继续补齐 P0-P2 的正式字段和全量扫描稳定性。

状态：已完成计划同步，开发能力待后续节点验收。

进度 2026-05-19：执行 P0-P2 兼容增强第一段。Operation 增加进度字段、取消请求字段、错误摘要和恢复 JSON；OperationTask 增加任务类型、attempt、maxAttempts、idempotencyKey、输入/输出 JSON；raw/canonical 行情表补充 timeframe、providerSymbol、exchange、validationStatus、primaryProvider、confidence 等血缘字段；provider_health 补充 endpoint、circuitState、cooldownUntil、请求/错误/坏数据/延迟统计字段。前端任务中心兼容 `succeeded / partial / cancelling` 状态。

验证：Prisma 同步和前后端 TypeScript 检查通过；小样本全 A 扫描 Operation `1cf3e0b6-e92f-4865-b868-4af12e24512f` 完成，进度字段、task idempotencyKey、cacheHitRate、raw/canonical 审计字段均可查询。后端服务恢复到 `http://localhost:4000`，前端服务保持 `http://localhost:3000`。

状态：部分完成。该节点继续填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架`；正式全量扫描稳定性、half-open provider 探测、日期级增量同步和 PostgreSQL/worker 仍待后续节点。

进度 2026-05-21：执行 P4.1 策略锦标赛可信回测第一段。AI 选股内置三策略保持不扩展，先将回测口径升级为 T 日收盘信号、T+1 开盘入场、持有 N 日后收盘退出；扣除佣金、最低佣金、印花税和滑点；市场约束阻断 ST/退市风险、上市天数不足、停牌、成交额不足、T+1 涨停不可买和退出日跌停不可卖。`strategyTournament` 新增样本量、可执行交易数、中位收益、盈亏比、最大回撤、Sharpe、Sortino、Calmar、换手率、尾部亏损、阻断样本和 assumptions；Operation 产物新增 `sample_trades.csv / equity_curve.json / drawdown_curve.json / backtest_assumptions.json`；前端策略排行展示新增指标并明确低可信策略只能观察。

验证：后端和前端 TypeScript 检查通过；`npm run test:screener-service` 通过，覆盖三策略、T+1 样本、成本字段、持久化回测记录；新增 `npm run test:strategy-tournament-backtest`、`npm run test:backtest-market-constraints`、`npm run test:backtest-cost-model`，覆盖 T+1 日期、成本扣减、ST 排除、成交额不足、T+1 涨停不可买和单样本可信度 `insufficient`。

状态：部分完成。该节点填补 `GAP-6 决策建议结构化` 与 `GAP-7 异步任务骨架` 中“策略证据不可审计、回测不含可成交约束、产物缺少风险指标”的缺口；后续仍需正式拆分 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint` 版本，补样本外验证、walk-forward、参数敏感性和前端曲线展示。

进度 2026-05-21：执行 P4.2 策略锦标赛版本化审计第一段。每个策略排名项新增 `versionBundle`，绑定 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint / Engine`，并生成稳定 `auditHash`。`Strategy.parameters`、`BacktestResult.reviewReportJson`、`leaderboard.json`、`backtest_assumptions.json` 写入版本束；Operation 新增 `strategy_manifest.json` 产物；前端 AI 选股策略卡展示策略版本、执行版本和审计哈希前缀。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证版本束 schema、T+1 执行版本、成本模型版本和 sha256 审计哈希；`npm run test:screener-service` 验证持久化回测报告含 `versionBundle` 和 `auditHash`。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 与 `GAP-7 异步任务骨架` 中“回测证据无法证明使用了哪一版策略和执行假设”的缺口；下一步进入样本外验证、walk-forward 和曲线前端可视化。

进度 2026-05-21：执行 P4.3 样本外验证第一段。每个策略排名项新增 `outOfSampleValidation`，按信号日期排序做 70/30 时间顺序切分，分别输出训练窗口和样本外窗口的样本数、胜率、平均收益、基准收益和超额收益；样本不足时标记 `insufficient` 并返回 warnings。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入样本外验证结果，Operation 新增 `out_of_sample_validation.json`；前端策略卡展示样本外状态、样本外交易数、样本外超额收益和 warnings。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证单样本不足和 5 样本 70/30 切分；`npm run test:screener-service` 验证持久化报告含 `outOfSampleValidation`。

状态：部分完成。该节点填补 `GAP-6 决策建议结构化` 中“策略胜率缺少样本外稳定性审计”的缺口；下一步补多窗口 walk-forward、参数敏感性和前端曲线展示。

进度 2026-05-21：执行 P4.4 walk-forward 稳定性审计第一段。每个策略排名项新增 `walkForwardValidation`，按信号日期切成 3 个连续窗口，每个窗口输出样本数、胜率、平均收益、基准收益、超额收益和窗口状态，并汇总通过窗口数。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入滚动窗口验证结果，Operation 新增 `walk_forward_validation.json`；前端策略卡展示滚动窗口状态、通过窗口数、最近窗口超额收益和 warnings。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证单样本不足、3 窗口结构和 5 样本切分；`npm run test:screener-service` 验证持久化报告含 `walkForwardValidation`。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“策略跨时间窗口稳定性不可见”的缺口；下一步补参数敏感性、曲线前端可视化和正式策略版本表。

进度 2026-05-21：执行 P4.5 参数敏感性审计第一段。每个策略排名项新增 `parameterSensitivity`，对现有策略关键阈值做本地小网格扰动并重跑回测：A杀/平台突破扰动成交量阈值和横盘振幅阈值，均线收复扰动修复量比和回撤阈值。每个变体输出样本数、可执行交易数、胜率、平均收益、超额收益、最大回撤和状态，并汇总稳定变体数。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入参数敏感性结果，Operation 新增 `parameter_sensitivity.json`；前端策略卡展示参数稳健/敏感/样本不足、稳定变体数和 base 超额收益。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证参数敏感性 schema、5 个参数变体和 base 变体；`npm run test:screener-service` 验证持久化报告含 `parameterSensitivity`。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“策略结论是否依赖单一阈值不可见”的缺口；下一步补前端曲线/热力图和正式策略版本表。

进度 2026-05-22：执行 P4.6 回测曲线前端可视化第一段。`strategyTournament.ranked` 返回 `equityCurve`，包含权益值和回撤百分比；持久化回测报告与 `leaderboard.json` 写入该字段。前端 AI 选股策略卡新增轻量 SVG 迷你图，展示权益曲线和回撤曲线；参数敏感性块展示前三个参数变体的成交数和超额收益。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 `equityCurve` 与 `drawdownPercent` 字段；`npm run test:screener-service` 验证三策略回归和持久化仍通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“回测稳定性只能读数字，前端无法直观看权益/回撤和参数变体”的缺口；下一步补完整参数热力图、样本交易明细和 artifact 深链路可视化。

进度 2026-05-22：执行 P4.7 策略锦标赛 artifact 深链路可视化第一段。任务中心的任务产物弹窗按 `leaderboard.json / strategy_metrics.json / equity_curve.json / drawdown_curve.json / out_of_sample_validation.json / walk_forward_validation.json / parameter_sensitivity.json / strategy_manifest.json / sample_trades.csv` 分别渲染可读预览，覆盖策略排行、可信度、成交数、胜率、超额收益、最大回撤、权益/回撤曲线、样本外验证、walk-forward、参数敏感性、版本束和样本交易。

验证：后端/前端 TypeScript 检查通过；该节点不改变后端回测计算口径，只增强任务中心 artifact 验收视图。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 与 `GAP-7 异步任务骨架` 中“任务产物只能读 JSON、前端无法快速验收回测证据链”的缺口；下一步补结构化样本交易表格、二维参数热力图和 artifact 间跳转。

进度 2026-05-22：执行 P4.8 样本交易结构化验收第一段。任务中心 `sample_trades.csv` artifact 增加结构化表格，展示策略、标的、信号日、入场日、退出日、入场价、退出价、毛收益、净收益、成本、盈利状态和阻断原因；顶部汇总记录数、可执行样本、阻断样本和盈利样本。原始 CSV 仍保留在表格下方用于审计。

验证：后端/前端 TypeScript 检查通过；该节点不改变后端回测计算口径和 artifact 格式，只增强样本交易验收视图。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“回测样本明细难以人工核对”的缺口；下一步补二维参数热力图、artifact 间跳转和正式策略版本表。

进度 2026-05-22：执行 P4.9 参数敏感性二维热力图第一段。任务中心 `parameter_sensitivity.json` artifact 自动识别变体 `thresholds` 中相对 base 发生变化的参数，选择前两个变化参数作为 X/Y 轴，渲染参数组合热力图；每个格子展示超额收益、成交数和变体 ID，颜色按超额收益分层。只有一个参数变化时降级为单轴热力条。

验证：后端/前端 TypeScript 检查通过；该节点不改变后端回测计算口径和 artifact 格式，只增强参数敏感性验收视图。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“参数敏感性无法直观看阈值组合稳定性”的缺口；下一步补 artifact 间跳转、正式策略版本表和更大参数网格。

进度 2026-05-22：执行 P4.10 artifact 交叉跳转第一段。任务中心打开任一 `operation_artifact` 后，弹窗顶部新增同批次产物导航，从当前引用解析 operationId 并生成 `leaderboard / strategy_metrics / sample_trades / equity_curve / drawdown_curve / out_of_sample / walk_forward / parameter_sensitivity / strategy_manifest` 快捷入口；深链打开单个产物时也能跳转同批次相关产物，当前产物高亮。

验证：后端/前端 TypeScript 检查通过；该节点不改变后端回测计算口径和 artifact 格式，只增强任务中心 artifact 导航体验。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 与 `GAP-7 异步任务骨架` 中“产物证据链割裂、跨产物验收成本高”的缺口；下一步补正式策略版本表、更大参数网格和策略 × 执行策略组合矩阵。

进度 2026-05-22：执行 P4.11 正式策略版本表第一段。新增 `StrategyVersion` 表，保存 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint / Engine` 版本束、`auditHash` 和 `versionBundleJson`，并以 `strategyId + auditHash` 去重。策略锦标赛持久化时创建或复用版本记录，`BacktestResult.reviewReportJson`、`strategy_manifest.json`、`leaderboard.json` 和 `Strategy.parameters` 均写入版本 ID 或 latest 版本引用。

验证：Prisma `db push/generate` 完成；后端/前端 TypeScript 检查通过；`npm run test:screener-service` 验证 `persistedStrategyVersionId` 与 `StrategyVersion` 落库；`npm run test:strategy-tournament-backtest` 通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“策略/执行/成本/约束版本缺少正式表和稳定主键”的缺口；下一步补更大参数网格和策略 × 执行策略组合矩阵。

进度 2026-05-22：执行 P4.12 更大参数网格第一段。`strategyTournament` 的参数敏感性从 `local_threshold_grid_v1` 升级为 `local_threshold_grid_v2`，不新增策略类型，只扩大现有策略阈值组合验证。A 杀/平台突破按 `lastTwoVolumeRatio × sidewaysRangePercent` 生成 3×3 网格，均线收复按 `reclaimVolumeRatio × drawdownPercent` 生成 3×3 网格，base 变体固定作为对照，并按阈值去重。每个策略默认输出 9 个参数组合，仍复用同一批 K 线、T+1 执行、成本模型和市场约束。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 `local_threshold_grid_v2`、9 个组合变体、base 变体和二维组合 id；`npm run test:screener-service` 通过。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“参数敏感性只做小范围单参数扰动，无法观察关键阈值组合稳定性”的缺口；下一步补策略 × 执行策略组合矩阵。

进度 2026-05-24：执行 P4.13 策略 × 执行策略组合矩阵第一段。`strategyTournament` 新增 `executionMatrix`，三类内置信号策略分别与 3 个退出持有周期组合，默认形成 9 个 `TournamentCandidate`。第一段保持 T+1 开盘入场、成本模型和市场约束不变，只比较 `基准持有N日 / 短持有N-1日 / 长持有N+2日` 三种退出策略。每个排名项新增 `candidateId` 和 `executionPolicy`，持久化回测报告、`leaderboard.json`、`strategy_manifest.json`、`backtest_assumptions.json` 和 `StrategyVersion` 均能追溯到具体候选组合。Operation 产物新增 `execution_matrix.json`，任务中心新增执行矩阵 artifact 导航与预览。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证矩阵 schema、3 个执行策略、9 个候选组合、基准候选 T+1/持有 3 日口径；`npm run test:screener-service` 验证候选组合持久化和回测报告链路。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“排行榜无法区分信号策略和执行策略贡献”的缺口；下一步补入场策略、止损止盈/移动止盈退出策略、仓位策略和完整执行策略版本矩阵。

进度 2026-05-24：执行 P4.14 止损止盈退出策略矩阵第一段。`executionMatrix` 从 3 个固定持有退出策略扩展为 6 个执行策略：每个持有周期同时生成固定持有版本和 `止损5% / 止盈10%` 版本，三类信号策略默认形成 18 个候选组合。回测样本会在入场后逐日扫描高低价，触发止盈或止损时提前退出，并写入 `exitReason`；`versionBundle.exitPolicy` 区分固定持有与止损止盈版本。`sample_trades.csv` 新增退出原因，任务中心样本交易表显示执行策略与退出原因。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证矩阵 18 个候选组合、固定持有口径不变、止盈提前退出和退出原因；`npm run test:screener-service` 验证候选组合持久化和回测报告链路。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“退出策略只有固定持有，无法审计止损止盈执行方式”的缺口；下一步补入场策略、移动止盈、仓位策略和完整执行策略版本矩阵。

进度 2026-05-24：执行 P4.15 入场策略矩阵第一段。进入本节点前先对 P4.14 做端到端复验，后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 drawio 读取均通过，未发现阻塞或重要问题；P4.15 独立评审后只纳入 `T+1开盘买入 / T+1收盘买入` 两个确定入场口径，暂不引入突破价和回踩价。`executionMatrix` 扩展为三类信号策略 × 2 个入场策略 × 6 个退出策略，默认形成 36 个候选组合；`versionBundle.entryPolicy` 区分 `entry.t1_open.v1` 与 `entry.t1_close.v1`；样本交易新增 `entryReason`，止盈止损阈值按实际入场价计算，任务中心策略卡、执行矩阵和样本交易表展示入场策略。

验证：后端/前端 TypeScript 检查通过；前端 Vite 构建通过；`npm run test:strategy-tournament-backtest` 验证 12 个执行策略、36 个候选组合、T+1 开盘/收盘入场版本、不同入场价和 `entryReason`；`npm run test:screener-service` 验证候选组合持久化和回测报告链路。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“入场策略只有 T+1 开盘价，无法审计收盘确认入场口径”的缺口；下一步补移动止盈、仓位策略和完整执行策略版本矩阵。

进度 2026-05-24：执行 P4.16-P4.18 移动止盈、仓位策略矩阵和执行矩阵收口。进入 P4.16 前先复验 P4.15，后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 drawio 读取均通过，未发现阻塞或重要问题。P4.16 新增固定 `8%` 移动止盈退出策略，按入场后 high-water mark 计算回撤触发价并写入 `exitReason`；P4.17 新增 `volatility_scaled_notional` 仓位策略，按近 20 日波动率把本金限制在 `0.5x - 1.0x`，只降仓不放大；P4.18 把入场、退出、仓位三个执行维度统一写入 `executionMatrix`、版本束和样本交易。矩阵扩展为三类信号策略 × 2 个入场策略 × 3 个持有周期 × 3 个退出策略 × 2 个仓位策略，默认 108 个候选组合。

验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 36 个执行策略、108 个候选组合、移动止盈提前退出、波动率缩放本金不超过基准本金、版本束和样本原因字段；`npm run test:screener-service` 验证候选组合持久化和回测报告链路。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 中“退出策略缺少移动止盈、仓位策略只有等额本金、执行矩阵未完整呈现入场/退出/仓位组合”的缺口；下一步补更长期样本、市场状态/行业/市值分组稳定性和 PostgreSQL/worker 级别性能验收。

进度 2026-05-19：执行 P3 `PositionAdviceFactSet + PositionAdviceEngine` 第一段。新增 `positionAdviceService`，为每个持仓生成 `position.advice.factset.v1`，覆盖组合总市值、现金/股票/基金/黄金比例、最大单票仓位、持仓市值/成本/收益率、行情 provider、技术评分、基本面/消息面边界、策略证据、`blockedReasons` 和 `evidenceRefs`。新增确定性 `PositionAdviceEngine`，按 `baseTargetWeight * marketRegimeMultiplier * signalMultiplier * riskPenaltyMultiplier * confidenceMultiplier` 计算目标仓位区间，并输出 `ADD / REDUCE / HOLD / OBSERVE / NO_ACTION`、理由、风险、触发条件和反证条件。新增 `/api/v1/analysis/position-advice` 和 `/api/v1/analysis/position-advice/:positionId`，LLM 仍不参与买卖动作。

验证：后端 TypeScript 检查通过；新增 `npm run test:position-advice` 验证 22 个持仓事实集，所有结果都有 `evidenceRefs`，低可信或证据不足时不会输出 `ADD`。运行态 HTTP 验证 `GET /api/v1/analysis/position-advice?userId=default` 返回 22 条结果，现金持仓为 `NO_ACTION`，非现金样例 `009725` 因缺少策略证据返回 `OBSERVE / insufficient / strategy_evidence_missing`。后端服务恢复到 `http://localhost:4000`，前端服务保持 `http://localhost:3000`。

状态：部分完成。该节点填补 `GAP-4 数据模型骨架` 与 `GAP-6 决策建议结构化` 中“持仓建议缺少统一事实集、仓位动作由空泛 AI 文案决定、缺少 evidenceRefs 和阻断规则”的缺口；下一步需要把策略证据从 P4 可审计回测中补强，并把结果接入前端持仓研究面板和 `position_advice_cache`。

进度 2026-05-20：完成 P3 前端接入第一段。`/api/v1/analysis/holdings-research` 合并返回 `positionAdvice`，前端“当前持仓研究面板”展示仓位建议引擎卡片，包括动作、可信度、当前仓位、目标区间、交易幅度、策略证据、趋势/动量/相对强弱/波动/流动性评分、阻断原因、风险和证据数量。证据不足时目标区间显示“证据不足”，避免把 `0% - 0%` 误解为清仓目标。

验证：后端 TypeScript、前端 TypeScript、`npm run test:position-advice` 均通过；HTTP 验证持仓研究返回 22 条并带 `positionAdvice`；前端截图 `.verification/analysis-position-advice-holdings-layout-final.png` 验证持仓研究分区可见仓位建议引擎，卡片无明显文字重叠。当前 22 个持仓建议结果仍为 `NO_ACTION=3 / OBSERVE=19 / ADD=0`，符合证据不足不加仓的硬规则。

状态：部分完成。该节点继续填补 `GAP-6 决策建议结构化` 的前端可见性缺口；下一步进入 `position_advice_cache / stock_factset_cache`，减少持仓页实时生成压力，并为 P4 回测证据接入预留稳定缓存。

进度 2026-05-20：完成 P5 持仓建议缓存第一段。新增 `PositionAdviceCache`，缓存持仓建议事实集、确定性建议、summary、证据引用、provider trace、warnings、`fresh/failed` 状态和下次刷新时间；`positionAdviceService` 默认读取新鲜缓存，`forceRefresh=true` 可强制重建。`holdings-research` 透出缓存信息，前端持仓研究面板展示“缓存新鲜/刚刷新”和下次刷新时间。

验证：Prisma `db push/generate` 完成；后端/前端 TypeScript 检查通过；`npm run test:position-advice` 通过；HTTP 验证 `forceRefresh=true` 首次返回 22 条建议且写入缓存，后续普通查询返回 `cache.status=fresh`、`cache.refreshed=false`；截图 `.verification/analysis-position-advice-cache-restarted.png` 验证前端缓存标签可见、无明显重叠。验证期间发现 SQLite `dev.db` 损坏，已备份并迁移到干净库，保留核心资产、持仓、交易、回测和行情缓存数据，14 条损坏 `MarketSnapshot` 未恢复，新库完整性检查通过。

状态：部分完成。该节点填补 `GAP-4 数据模型骨架` 与 `GAP-6 决策建议结构化` 中“持仓建议无缓存、无新鲜度状态、持仓页实时生成压力大”的缺口；`stock_factset_cache`、后台 stale-while-revalidate、批量事实集 Operation 和 PostgreSQL 迁移仍待后续节点。

进度 2026-05-20：完成 P5 股票事实集缓存第一段。新增 `StockFactSetCache`，缓存个股 full analysis、`stock.analysis.factset.v1`、三面汇总、证据引用、provider trace、warnings、`fresh/failed` 状态和下次刷新时间；`GET /api/v1/stocks/:code` 默认读取 fresh cache，`forceRefresh=true` 强制重建。前端个股分析页事实集区展示“缓存新鲜/刚刷新”和下次刷新时间。

验证：Prisma `db push/generate` 完成；后端/前端 TypeScript 检查通过；`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary`、`npm run test:fundamental-factset`、`npm run test:stock-factset-cache` 均通过。HTTP 验证 `601127 forceRefresh=true` 写入缓存，后续普通查询返回 `cache.refreshed=false`，技术面/基本面/消息面 facts 分别为 13/36/6；截图 `.verification/stock-analysis-factset-cache.png` 验证个股页缓存状态可见。

状态：部分完成。该节点继续填补 `GAP-4 数据模型骨架`、`GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“三面事实集不可缓存、每次打开个股页都实时抓外部数据源、缓存新鲜度不可见”的缺口；后台 stale-while-revalidate、批量事实集 Operation 和缓存失效策略仍待后续节点。

进度 2026-05-20：完成 P5 stale-while-revalidate 第一段。`PositionAdviceCache` 与 `StockFactSetCache` 在缓存过期但内容可解析时，接口立即返回 `cache.status=stale` 的旧结果，同时进程内后台触发去重刷新；刷新完成后缓存恢复 `fresh`，避免页面同步阻塞在外部 provider 上。

验证：后端/前端 TypeScript 检查通过；`npm run test:position-advice` 验证持仓建议缓存先返回 `stale`、后台刷新后恢复 `fresh`；`npm run test:stock-factset-cache` 验证 601127 股票事实集先返回 `stale`、后台刷新后恢复 `fresh`，facts 保持 13/36/6；SQLite `PRAGMA integrity_check=ok`，缓存状态为 `StockFactSetCache fresh=1`、`PositionAdviceCache fresh=22`。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架` 中“过期事实集会阻塞页面、provider 慢时用户看不到旧结果”的缺口；下一步需要把后台刷新升级为批量事实集 Operation，提供进度、取消、失败原因和产物引用。

进度 2026-05-20：完成 P5 批量事实集刷新 Operation 第一段。新增 `batch_factset_refresh` Operation，接口为 `POST /api/v1/operations/refresh-factsets`，支持刷新范围 `all / position_advice / stock_factset`、指定 `symbols` 和 `limit`。Operation 拆为 `position_advice.refresh` 与 `stock_factset.refresh` 子任务，逐项记录成功数、失败数、耗时、provider、warnings 和失败详情；股票事实集刷新增加单标的 60 秒超时，避免慢 provider 长时间阻塞任务。前端任务中心新增“刷新事实集”按钮，复用任务进度、取消、partial success、失败原因和结果入口。

验证：后端/前端 TypeScript 检查通过；HTTP 验证 Operation `b2959557-bea6-41e7-87b2-71a77eafb856` 以 `scope=position_advice / limit=3` 完成，`successCount=3 / failureCount=0`；Operation `521b8b6c-a1d0-4707-b2e1-2ab1bf5dac62` 以 `scope=stock_factset / symbols=601127` 完成，`successCount=1 / failureCount=0`。截图 `.verification/operations-factset-refresh-button.png` 验证任务中心入口和完成记录可见。

状态：部分完成。该节点填补 `GAP-7 异步任务骨架` 和 `GAP-6 决策建议结构化` 中“事实集批量刷新不可查询、不可取消、失败原因不可见”的缺口；仍缺跨进程 worker、任务恢复后继续执行、定时失效策略和落盘 artifact 文件。

进度 2026-05-21：完成 P5 Operation 恢复第一段。`batch_factset_refresh` 支持服务启动后恢复 `queued/running` 状态的未完成任务，写入 `recoveryJson`，并按 `skip_completed_phase_tasks` 策略跳过已完成阶段，继续执行未完成的 `position_advice.refresh / stock_factset.refresh`。恢复范围暂时只覆盖事实集批量刷新，避免价格刷新、交易影响类任务在进程重启后重复写入。

验证：后端 TypeScript 检查通过；新增 `npm run test:operation-recovery`，模拟 running 状态任务后恢复完成，Operation `d7a71d5e-d3bc-4dca-bdea-1f1efd8f3d4a` 返回 `status=completed / progress=100`，`position_advice.refresh successCount=1 / failureCount=0`，`recovery.reason=server_startup`。后端重启后运行态接口可查询该恢复记录，前端服务保持 `http://localhost:3000`。

状态：部分完成。该节点继续填补 `GAP-7 异步任务骨架` 中“任务状态持久化但进程重启后不可恢复”的缺口；仍缺跨进程 worker、并发租约、心跳超时、定时刷新和 item 级断点续跑。

进度 2026-05-21：完成 P5 Operation 租约与心跳第一段。`Operation` 新增 `leaseOwner / leaseExpiresAt / heartbeatAt` 字段；`batch_factset_refresh` 执行前必须获取租约，进度更新时续租并刷新心跳，完成、失败或取消时释放租约。服务启动恢复只接管 `queued`、无租约或租约过期的事实集刷新任务，跳过有效租约任务，避免多进程重复恢复。

验证：Prisma `db push/generate` 完成；后端 TypeScript 检查通过；`npm run test:operation-recovery` 验证过期租约可恢复、有效租约不可接管、完成后租约释放。运行态 HTTP Operation `b5656d4f-d29b-4730-843a-9b5d09b1e12c` 完成，任务 `position_advice.refresh success=1 / failed=0`，`leaseOwner=null / leaseExpiresAt=null / heartbeatAt` 有最后心跳；SQLite 完整性检查 `ok`。

状态：部分完成。该节点继续填补 `GAP-7 异步任务骨架` 中“多进程互斥和任务心跳缺失”的缺口；仍缺独立 worker 进程、租约抢占审计、item 级断点续跑、定时刷新调度和 PostgreSQL 并发验收。

进度 2026-05-21：完成 P5 到期事实集刷新调度第一段。新增 `scheduleDueFactsetRefresh` 和 `POST /api/v1/operations/refresh-due-factsets`，扫描缺失、stale、failed、partial、`nextRefreshAfter` 到期或持仓更新时间晚于缓存生成时间的事实集；支持 `scope / horizonMinutes / limit / submit=false / force=true`。有到期事实集且无活跃刷新任务时，系统提交 `createdBy=scheduler` 的 `batch_factset_refresh`；任务中心新增“刷新到期事实集”按钮。

验证：后端/前端 TypeScript 检查通过；新增 `npm run test:due-factset-refresh`，模拟过期缓存后提交 Operation `dd94ce24-ba34-4f00-be08-55308db95a9a` 并完成，`position_advice.refresh successCount=1 / failureCount=0`。运行态 HTTP 预览 `/refresh-due-factsets submit=false` 返回 `009725 / reason=refresh_due` 且不提交任务；SQLite 完整性检查 `ok`。

状态：部分完成。该节点填补 `GAP-7 异步任务骨架` 与 `GAP-6 决策建议结构化` 中“事实集只能被动刷新、缺少到期扫描和调度入口”的缺口；仍缺真正的 cron/worker 定时器、刷新窗口策略、item 级断点续跑和前端到期清单明细展示。

进度 2026-05-21：完成 P5 到期事实集 cron 调度器第一段。新增 `factsetRefreshScheduler`，后端启动后按 `FAMS_FACTSET_SCHEDULER_CRON` 周期调用到期事实集扫描；默认每 15 分钟运行一次，使用 `Asia/Shanghai` 时区、用户 `default`、提前窗口 60 分钟、单批上限 20，并默认避开 A 股交易时段 `09:15-15:30`。调度器只提交 `createdBy=scheduler` 的 `batch_factset_refresh` Operation，不直接刷新数据，因此继续复用任务租约、恢复、取消和前端任务中心。

验证：后端 TypeScript 检查通过；新增 `npm run test:factset-refresh-scheduler`，验证交易时段返回 `trading_window` 跳过，盘后提交 Operation `3bccf010-841c-47d1-ba70-6ebcb4bd7b90` 并完成。后端重启后运行态日志显示 `Factset refresh scheduler started`，配置为 `*/15 * * * * / Asia/Shanghai / limit=20 / allowTradingHours=false`。

状态：部分完成。该节点继续填补 `GAP-7 异步任务骨架` 中“缺少后台调度触发”的缺口；仍缺独立 worker 进程、调度租约防多实例重复 tick、节假日交易日历、刷新窗口策略页面和 PostgreSQL 并发验收。

进度 2026-05-21：完成 P5 调度租约第一段。新增 `SchedulerLease` 表，`factsetRefreshScheduler` 每次 tick 前先抢占 `factset_refresh` 租约并写入 `leaseOwner / leaseExpiresAt / heartbeatAt`；有效租约存在时返回 `scheduler_lease_not_acquired` 并跳过，tick 完成后释放租约并记录 `lastRunAt / lastResultJson`。该机制避免多个后端实例同时扫描并提交重复刷新任务。

验证：Prisma `db push/generate` 完成；后端 TypeScript 检查通过；`npm run test:factset-refresh-scheduler` 覆盖交易时段跳过、有效调度租约阻止 tick、租约释放后盘后提交 Operation `c323ce70-d0fa-4db1-8edd-0a9ad3bd224c` 并完成。后端重启后运行态日志显示 `Factset refresh scheduler started`，前端服务保持 `http://localhost:3000`。

状态：部分完成。该节点继续填补 `GAP-7 异步任务骨架` 中“多实例 cron 无互斥”的缺口；仍缺独立 worker 进程、调度租约审计页面、节假日交易日历、刷新窗口策略配置和 PostgreSQL 并发验收。

进度 2026-05-21：完成 P5 调度状态可视化第一段。新增 `GET /api/v1/operations/schedulers/factset-refresh`，返回调度器配置、进程运行状态、`SchedulerLease` 租约、上次运行时间和上次结果；任务中心新增“事实集后台调度”状态卡，展示启用状态、cron/时区、提前窗口、单批上限、交易时段策略、租约持有者和上次结果。

验证：后端/前端 TypeScript 检查通过；HTTP 验证接口返回 `enabled=true / cron=*/15 * * * * / taskStarted=true / lease.locked=false / lastResult.operationId=c323ce70-d0fa-4db1-8edd-0a9ad3bd224c`；SQLite 完整性检查 `ok`。前端截图验证被本机 Playwright 缺失 `libnspr4.so` 阻断，后续补环境后复验。

状态：部分完成。该节点填补 `GAP-7 异步任务骨架` 中“后台调度健康状态不可见”的缺口；仍缺截图复验、调度租约抢占审计明细、刷新策略配置页面、节假日交易日历、独立 worker 和 PostgreSQL 并发验收。

## 进度记录

进度 2026-05-10：落盘 `FAMS 高可靠与高正确开发计划`，明确在计划完成前不启动新的开发主线。后续优先级切换为查询正确性、行情可靠性、账本一致性、分析建议可追溯和 AI 选股可复现；V3.0 harnessOS 多 Agent 编排等扩展能力暂缓。

验证：新增 `docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md`；本文件新增当前执行约束；`project-progress/SESSION_STATUS_2026-05-08.md` 更新下一步为正确性计划；`docs/drawio-summary.txt` 增加开发主线锁定记录。

状态：已完成。

进度 2026-05-12：新增行情监控模块，完成“宽基回撤监控 + 默认 10% 建仓提醒”最小闭环。后端复用 `AlertRule` 保存宽基监控标的、回撤阈值和观察窗口，默认启用上证指数、沪深300、中证500、中证1000、创业板指、科创50 六个标的，250 个交易日窗口、10% 建仓提醒；计算使用 Sina 指数日 K，数据失败时显式返回失败状态，不把空数据当成功。前端 Alerts 页面新增“宽基回撤监控”和“宽基监控配置”，支持监控标的、阈值、窗口和启用状态配置。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-watch` 通过；接口验证 `/api/v1/alerts/market-watch/rules` 返回 6 条默认规则，`/api/v1/alerts/market-watch/evaluations` 返回 6 条评估结果，当前上证指数 `latestDate=2026-05-12`、`latestPrice=4214.489`、`peakPrice=4230.184`、`drawdownPercent=0.37`、`triggered=false`，`POST /api/v1/alerts/market-watch/check` 返回 `alertCount=0`；配置保存接口 `PUT /api/v1/alerts/market-watch/rules` 验证成功。前端服务 `http://localhost:3000`、后端服务 `http://localhost:4000` 已启动；Playwright 截图 `.verification/market-watch-alerts-page.png` 验证告警页展示宽基监控、配置表、上证指数、沪深300 和 10% 阈值，无前端错误日志；页面点击“检查宽基”确认 POST 检查接口返回 200，并刷新规则、评估和告警列表。

状态：部分完成。该节点填补 `GAP-3 领域服务边界`、`GAP-4 数据模型骨架` 和 `GAP-5 市场数据可靠性` 中“市场机会提醒缺少规则模型、宽基回撤不可配置、告警只围绕持仓”的缺口；`docs/target-architecture-gap.drawio` 已同步补充 V1.5 节点。

进度 2026-05-11：完成查询正确性阶段 1 的最小 `Asset Identity Resolver`。新增 `/api/v1/assets/resolve`，统一返回标的规范化、资产类型、市场、交易所、币种、置信度、识别证据、warnings、本地匹配和候选列表；`/api/v1/prices/realtime` 接入 resolver，在外部行情超时时返回结构化失败和本地最近价兜底，不再让查询静默失败或挂起。

验证：后端 `node node_modules/typescript/bin/tsc` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；resolver 验证 `513770=etf` 且暴露本地 `stock` 类型冲突、`601888=stock/SH`、`600276=stock/SH`、`000651=stock/SZ`、`现金-现金-银行卡=cash/LOCAL`、`015311=fund/CN`、`009725=bond/CN`；实时价格查询验证 `513770` 返回本地最近价 `0.421`、identity `etf`、实时行情超时 warning，`601888` 无本地价时返回 `price=null` 与明确 warning。

状态：部分完成。该节点填补 `GAP-2 API 边界硬化` 和 `GAP-5 市场数据可靠性` 中“查询身份不透明、失败不结构化”的缺口；后续要把导入、刷新、分析和 AI 选股全部改为复用 resolver。

进度 2026-05-11：修复价格刷新失败体验。`refreshAssetMarketData` 已接入 resolver 和本地最近可信价兜底：外部 provider 失败时，优先使用 `asset.lastPrice`，没有时使用持仓 `currentPrice / avgCost`，并返回 `local_last_price`、`stale=true`、`fallbackUsed=true` 与 warning，同时同步持仓展示价、市值和浮盈亏。

验证：后端 `node node_modules/typescript/bin/tsc` 通过；`POST /api/v1/operations/refresh-prices` 创建 Operation `d7ee2bf0-3bda-4aee-a9c7-7a42e01f7ef2`，轮询结果 `status=completed`、`progress=100`、`refreshed=24`、`failed=0`、`liveSuccesses=3`、`staleFallbacks=21`、失败列表为空。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 中“刷新任务失败/无兜底”的缺口；真实行情成功率仍需后续 provider/cache/Akshare 通道提升。

进度 2026-05-11：修正价格刷新成功口径并补强 Sina 实时行情路径。本地最近可信价只作为展示兜底，不再计入刷新成功；刷新结果新增 `realtimeRefreshed` 与 `retainedLocalPrices`。A 股和场内 ETF provider 顺序调整为 Sina 优先，Sina provider 改为使用系统 curl 获取行情，规避 Node axios 在当前 WSL 代理环境下 HTTPS 超时或 503 的问题。前端资产页、持仓页、任务页同步显示“实时成功 / 未刷新 / 保留旧价”。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`GET /api/v1/prices/realtime?symbol=513770` 返回 `price=0.429`、`source=sina`、`fallbackUsed=false`、行情时间 `2026-05-11 15:00:03` 北京时间；`POST /api/v1/operations/refresh-prices` 创建 Operation `ffccccac-58fd-4337-bed5-a76a855b8690`，轮询结果 `status=completed`、`progress=100`、`refreshed=9`、`failed=15`、`realtimeRefreshed=9`、`retainedLocalPrices=15`；单标的刷新 Operation `8aeba2a8-caa6-4a86-bc6c-8cb57c31b286` 验证 `513770` 持仓 `currentPrice` 同步更新为 `0.429`。

状态：部分完成。该节点继续填补 `GAP-5 市场数据可靠性` 中“实时价与旧价混淆、provider 顺序导致可用源被阻塞”的缺口；剩余缺口是场外基金和债基 provider 成功率。

进度 2026-05-11：补齐基金/债基外部行情刷新链路。天天基金 provider 改为 curl 通道，非交易所 ETF 前缀的本地 fund/bond 类型优先，修复 ETF 联接基金误识别为股票/场内 ETF 的问题；天天基金实时估值为空时使用东方财富最新官方净值 `eastmoney_nav`，并保留行情日期。前端刷新结果文案由“实时成功”改为“外部成功”，避免官方净值与盘中实时价混淆。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`015311`、`009725` 命中 `tiantian`；`007467`、`019062`、`012857` 修正为 `fund` 并命中 `tiantian`；`006476`、`021634` 命中 `eastmoney_nav`。全量刷新 Operation `6041c162-867b-4128-814e-d0d45b307909` 返回 `status=completed`、`refreshed=24`、`failed=0`、`externalRefreshed=24`、`retainedLocalPrices=0`，来源包含 `sina / tiantian / manual / eastmoney_nav`。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 中“基金/债基无法外部刷新、ETF 联接基金误走错误 provider、本地旧价兜底残留”的缺口；下一步补测试和异常价格校验。

进度 2026-05-11：新增行情可靠性自动回归脚本。`backend/scripts/verify-market-data-reliability.ts` 通过后端 HTTP 接口验证 resolver、单标的行情源和全量刷新结果；`backend/package.json` 新增 `npm run test:market-data`，使用稳定的 `node node_modules/tsx/dist/cli.mjs` 入口，规避 WSL 下 `.bin/tsx` 包装脚本失效。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过，验证 `513770=etf`、`007467/019062/012857=fund`，并确认 `513770=sina`、`015311/009725/007467=tiantian`、`006476/021634=eastmoney_nav`、全量刷新 Operation `bf146b0e-a45a-4c05-97e5-b68c4c952f78` 返回 `external=24`、`failed=0`、`retained=0`。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架` 中“缺少自动回归验证”的缺口。

进度 2026-05-11：完成异常价格跳变提示和行情来源展示。刷新结果新增 `previousPrice`、`priceChangeFromPreviousPercent`、`abnormalPriceJump`，超过阈值时写入 warning 并汇总到 summary；持仓 DTO 新增 `asset.lastPriceSource`，资产页新增价格“来源”列，任务中心刷新摘要显示异常跳变数量。行情可靠性自动回归脚本同步验证关键样例不触发异常跳变，并验证持仓来源字段。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过，Operation `b09a55a5-f2f6-4c15-84b6-3522f29e906e` 返回 `external=24`、`failed=0`、`retained=0`；持仓接口验证 `513770 source=sina`、`006476/021634 source=eastmoney_nav`。前端服务恢复监听 `http://localhost:3000`。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 中“价格来源不可见、异常跳变不可见”的缺口。

进度 2026-05-11：目标研究与 AI 股票分析入口接入 `Asset Identity Resolver`。`analyzeTarget` 改为 resolver 优先并通过 `MarketDataService` 获取行情，建议参数和输入快照携带 identity、source、sourceTime、fallbackUsed；独立 `/api/v1/llm/stock-advice` 增加 resolver 守卫，仅允许 A 股股票进入 AI 股票分析，ETF/基金/债券返回结构化拒绝。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过；`POST /api/v1/analysis/target-research` 输入 `513770` 返回 `identity.assetType=etf`、`quote.source=sina`、`quote.timestamp=2026-05-11T07:00:03.000Z`、`fallbackUsed=false`；`POST /api/v1/llm/stock-advice` 输入 `513770` 返回 400，携带 `identity.assetType=etf` 和统一研究入口提示。

状态：部分完成。该节点填补 `GAP-2 API 边界硬化` 和 `GAP-5 市场数据可靠性` 中“分析入口绕过标的识别、AI 股票分析可能误用 ETF/基金”的缺口。

进度 2026-05-11：修正股票/ETF 卖出后的持仓成本计算。`TransactionService` 部分卖出改为同花顺持仓成本口径：卖出净回款冲减剩余持仓成本，重新计算剩余股数成本价；open 持仓不再把部分卖出盈亏单独累加到 `realizedPnl`，避免和成本价重复计算。回滚买入/卖出也同步按交易实际买入成本和卖出净回款处理。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；定向修复 `601127` 当前持仓，接口验证 `quantity=1900`、`avgCost=136.4541052631579`、`costBasis=259262.8`、`currentPrice=89.19`、`marketValue=169461`、`unrealizedPnl=-89801.8`、`realizedPnl=0`。

状态：部分完成。该节点填补 `GAP-3 领域服务边界` 中“交易入账成本计算口径与实际券商/同花顺展示不一致”的缺口。

进度 2026-05-11：补充交易成本模型自动回归。新增 `backend/scripts/verify-transaction-cost-model.ts` 和 `npm run test:transaction-cost`，用真实卖出案例 `513770`、`159851`、`601127` 以及“卖出后再买入”合成案例锁定同花顺成本公式；同时验证持仓列表和按标签分组接口对关键标的盈亏一致。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:transaction-cost` 通过；接口验证 `GET /api/v1/positions?userId=default&limit=100` 与 `GET /api/v1/positions/by-tag/default` 对 `513770`、`159851`、`601127` 的成本、盈亏、收益率一致。

状态：部分完成。该节点填补 `GAP-3 领域服务边界` 和 `GAP-7 异步任务骨架` 中“账本成本缺少回归验证、跨接口显示可能不一致”的缺口。

进度 2026-05-11：修复基金估值口径。真实份额基金在外部净值刷新后按 `quantity × currentPrice` 重算 `marketValue`，并按 `marketValue - costBasis` 重算浮盈；`quantity=1` 的债券/类固收手工总额资产继续保留导入市值，避免净值参考价误替代总资产金额。`MarketDataService` 批量刷新和 `PositionService` 持仓刷新两条路径已统一逻辑。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过，Operation `735eb249-276f-43b0-bb93-dc5d29869014` 返回 `external=23`、`failed=0`、`retained=0`；脚本新增基金估值断言，验证 `019062`、`011613`、`014064`、`021634`、`015311`、`007467`、`014674`、`015916`、`013597`、`012857`、`501008` 的市值均等于 `份额 × 最新净值`，`013785`、`009725`、`014086` 继续保留手工总额。`npm run test:transaction-cost` 同时通过。

状态：部分完成。该节点填补 `GAP-3 领域服务边界` 和 `GAP-5 市场数据可靠性` 中“基金现价更新后市值/浮盈仍使用导入旧市值”的缺口。

进度 2026-05-11：完成持仓、标签和页面聚合一致性回归。新增 `backend/scripts/verify-position-consistency.ts` 与 `npm run test:position-consistency`，锁定 `GET /positions` summary、持仓列表、`GET /positions/by-tag` 的总市值、总成本、总盈亏和持仓数量一致；同时校验持仓公式和标签注册表完整性。`syncAssetTags` 从只增不删改为精确同步，标签删除或修改后不会被旧 assetTag 重新带回；`GET /tags` 会补齐历史持仓 JSON 标签，修复管理标签列表少于持仓实际标签的问题；按标签分组同时合并持仓标签和资产标签。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`GET /api/v1/tags` 验证 `赛里斯` 已进入标签注册表；`npm run test:position-consistency` 返回 `positions=23`、`totalValue=713046.64`、`bins=5`；`npm run test:transaction-cost` 通过。Windows Chrome headless 截图 `.verification/position-consistency-dashboard-loaded.png` 和 `.verification/position-consistency-assets-loaded.png` 验证总览与资产页加载正常，页面总市值一致显示 `71.30万`。

状态：部分完成。该节点填补 `GAP-1 用户交互边界`、`GAP-3 领域服务边界` 和 `GAP-7 异步任务骨架` 中“标签注册表不完整、页面聚合缺少回归校验、旧 assetTag 可能污染标签展示”的缺口。

进度 2026-05-11：补齐成本/收益率反推编辑能力。资产编辑弹窗新增按“当前市值 + 当前收益率”反推成本，覆盖股票、ETF、基金和债基；系统按 `costBasis = marketValue / (1 + returnPercent / 100)` 计算总成本，并按份额反推每份成本。基金/债基保存时同步写入 `quantity`、`avgCost`、`costBasis`、`marketValue`、`unrealizedPnl`，解决只有持有份额和券商收益率时无法修正成本的问题。

验证：前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；示例 `7571.34` 元市值、`-2.27%` 收益率反推成本为 `7747.20` 元、浮亏 `-175.86` 元；重启前端后确认 3000 端口实际提供的 `EditAssetModal.tsx` 包含“当前收益率”和“按市值和收益率反推成本”；资产页操作列新增显式“编辑”按钮，截图 `.verification/assets-edit-button-visible.png` 验证入口可见。

状态：部分完成。该节点填补 `GAP-1 用户交互边界` 和 `GAP-3 领域服务边界` 中“持仓成本调整依赖手算、基金/ETF成本修正入口不清晰”的缺口。

进度 2026-05-11：完成分析建议行情快照前端可追溯。`generateInvestmentSuggestions` 返回 `marketDataTrace`，包含每个建议输入标的的行情来源、来源标签、价格、涨跌幅、置信度、行情时间、fallback 状态和 warnings；分析建议页新增“行情取数快照”面板，日常建议可直接看到本次建议依赖了哪些行情源和时间。标的研究行情卡片新增“行情时间”，与已有的数据源、置信度、取数策略一起展示。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `backend/scripts/verify-analysis-trace.ts` 与 `npm run test:analysis-trace`，验证日常建议 `marketDataTrace=23` 且与 matched positions 对齐，`POST /api/v1/analysis/target-research` 输入 `513770` 返回 `quote.source=sina`、行情时间 `2026-05-11T07:00:03.000Z`、`fallbackUsed=false`；Windows Chrome headless 截图 `.verification/analysis-market-trace-visible.png` 确认前端显示“行情取数快照”、来源、价格、置信度和时间。

状态：部分完成。该节点填补 `GAP-4 数据模型骨架`、`GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 中“分析建议虽然生成了快照，但前端无法直接确认行情来源、时间和 fallback 状态”的缺口。

进度 2026-05-11：AI 选股 universe 与资产导入链路接入 `Asset Identity Resolver`。选股入口改为解析所有开放持仓资产后仅保留 `stock/CN` 进入 A 股样本池，并返回 `excludedUniverse` 说明 ETF、基金、债券、现金等被排除原因；前端 AI 选股结果展示“身份解析样本池”和排除标的。资产导入新增 `resolveImportAssetIdentity`，导入时使用 resolver 写入标准 symbol、asset.type、exchange、currency，Excel 分类规则只作为兜底。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:import-resolver` 验证 `601127=stock`、`513770=etf`、`159851=etf`、`007467=fund`、`009725=bond`、现金复合键为 `cash`；重启后端后 `npm run test:screener-resolver` 通过，返回 `universeSource=asset_identity_resolver`、`universe=9`、`candidates=5`、`excluded=19`，且 513770 被解析为 ETF 并排除出股票选股样本。验证期间历史 K 线 provider 出现多标的 502/空响应，接口可完成但 failures=9，后续需治理行情历史源。

状态：部分完成。该节点填补 `GAP-2 API 边界硬化`、`GAP-3 领域服务边界`、`GAP-5 市场数据可靠性` 中“AI 选股和导入绕过统一标的身份、错误标签可能污染股票样本池”的缺口；下一步继续拆分 StockScreenerService、补策略可复现测试和历史行情 provider/cache。

进度 2026-05-11：补强 AI 选股历史行情可靠性。A 股历史 K 线增加 Sina curl fallback，东方财富历史接口返回 502 或空响应时不再导致整批样本无数据；选股入口删除实时价伪造历史 K 线逻辑，历史数据不足 22 个交易日的标的只进入 failures，不进入候选。接口返回 `dataQuality.screened / insufficientHistory / historySources`，候选返回 `historySource / historyDays`，前端结果卡展示 K 线有效数、历史不足数、数据源和 K 线条数。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-resolver` 通过并从上一轮 `failures=9` 修复为 `universe=9`、`candidates=5`、`excluded=19`、`failures=0`，脚本新增断言确保基线没有历史不足失败、failures 标的不得进入候选、历史数据源必须可见；`npm run test:import-resolver` 继续通过；Chrome 截图 `.verification/analysis-screener-history-reliability.png` 验证分析页加载正常。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 中“历史行情 provider 单点失败、数据不足仍强行给候选、选股数据质量不可见”的缺口；下一步继续抽离 `StockScreenerService` 并增加 provider 成功率、缓存命中率和策略复现测试。

进度 2026-05-11：修复 AI 选股样本池覆盖范围。选股入口默认通过 Sina `hs_a` 获取全 A 股股票池，覆盖沪深北 A 股，替代此前只基于持仓和本地默认股票的有限样本；持仓 A 股会合并去重，ETF、基金、债券、现金继续由 resolver 排除。接口新增 `universeSource=sina_hs_a_all_a_share`、`universeTotal`、`scannedCount` 和 `scanCoveragePercent`，前端展示“全A股样本池”和扫描覆盖率；自然语言查询可追加 `扫描上限=数字` 做快速验收，不填写时按全样本扫描。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-resolver` 通过，返回 `universe=5514`、`candidates=5`、`excluded=18`、`failures=0`；手工接口验证 `扫描上限=30` 时仍返回 `universeTotal=5514` 和 `universeSource=sina_hs_a_all_a_share`，说明样本池是全 A 股、仅扫描数被限制；3000 前端服务已重启并确认展示文案更新。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“AI 选股样本池不完整、结果无法说明扫描覆盖率”的缺口；下一步继续把选股策略拆到独立服务并补全未命中原因、性能观测和全量扫描缓存。

进度 2026-05-12：抽离 AI 选股策略服务。新增 `StockScreenerService`，`AnalysisService` 只保留入口委托；选股结果新增 `strategyDefinition`、结构化阈值、`matchedRules / unmatchedReasons`、`observability` 和数据质量统计。前端分析页展示策略定义、provider 成功率、命中/未命中原因，让每只候选为什么入选或未完全满足条件可复核。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过，合成 K 线命中样例 `score=100`、未命中样例返回三条 `unmatchedReasons`，并验证阈值解析；`npm run test:screener-resolver` 通过，返回 `universe=5514`、`candidates=8`、`excluded=18`、`failures=0`，并断言策略定义和观测字段存在；Playwright 截图 `.verification/analysis-screener-service-structured.png` 验证前端展示“策略定义”、`provider成功率`、命中/未命中原因和全 A 股样本池，无前端错误日志。

状态：部分完成。该节点填补 `GAP-3 领域服务边界`、`GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“选股策略不可复现、阈值不可追溯、未命中原因不可见、provider 成功率缺少观测”的缺口。

进度 2026-05-12：扩展 AI 选股第二批确定性策略。`StockScreenerService` 支持根据查询文本选择 `A杀后横盘放量`、`放量突破平台`、`跌破后收复关键均线` 三类策略；新增平台突破和均线收复评估函数，返回统一候选结构、命中规则和未命中原因。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过，合成 K 线覆盖三类策略；`npm run test:screener-resolver` 通过，默认策略仍返回 `universe=5514`、`candidates=8`、`excluded=18`、`failures=0`；接口验证 `放量突破平台；扫描上限=30` 返回 `strategyDefinition.id=volume_platform_breakout`，`跌破后收复关键均线；扫描上限=30` 返回 `strategyDefinition.id=ma_reclaim`；Playwright 截图 `.verification/analysis-screener-multistrategy-platform.png` 验证前端展示放量突破平台策略、策略定义、provider 成功率和突破规则说明，无前端错误日志。

状态：部分完成。该节点填补 `GAP-6 决策建议结构化` 中“选股只有单一策略、自然语言策略无法映射到确定性规则”的缺口。

进度 2026-05-11：修复黄金和现金等手工总额资产的编辑/刷新口径。黄金编辑弹窗增加金价、成本、市值、收益率反推能力，金价接口不可用时仍可手工保存；现金保存写入金额口径，三条现金持仓已从 `marketValue=1` 修复为 `120000 / 79300 / 288000`。刷新链路中本地 `gold/cash` 类型优先于 resolver 规则类型，避免黄金代码 `002611` 被当作股票取到 `19.33`；黄金实时价新增黄金基金 curl fallback，当前验证价为 `1036.14` 元/克。

验证：后端/前端 TypeScript 检查通过；`npm run test:manual-assets` 通过，锁定现金金额口径和黄金元/克刷新口径；手工 `POST /api/v1/prices/refresh` 刷新黄金及三条现金返回 `refreshed=4 / failed=0`，黄金来源 `goldFund`，现金来源 `manual`。

状态：已完成。该节点填补 `GAP-5 市场数据可靠性`、`GAP-3 领域服务边界` 中“手工资产被行情刷新错误覆盖、黄金价格单位错误、现金无法按金额保存”的缺口。

进度 2026-05-11：落地统一 `post-refresh validation`。刷新流程改为写库前校验价格有效性、来源合法性、异常跳变和持仓公式：黄金必须为元/克口径且拒绝股票/基金行情源，现金必须为 `manual` 且价格为 1，股票/ETF/真实份额基金按 `quantity × price` 校验市值，手工总额基金/债基保留用户市值。校验失败会抛出 `POST_REFRESH_VALIDATION_FAILED`，不写入 `Asset.lastPrice` 和持仓主数据，刷新结果计为失败并保留旧可信值。

进度 2026-05-11：补齐刷新校验的前端失败分类和手工校准基金保护。刷新失败表新增 `validation_failed` 分类，展示“刷新校验阻断 / 阻断写库”；非场内基金/债基如果当前市值与 `quantity × price` 偏离超过 0.3%，视为用户已手工校准，刷新时不覆盖该市值。

验证：后端和前端 TypeScript 检查通过；`npm run test:position-consistency` 通过，恢复持仓、汇总、标签分组一致性回归；`npm run test:manual-assets` 通过；手工刷新黄金与三条现金 `refreshed=4 / failed=0 / retainedLocalPrices=0`，黄金来源 `goldFund`，现金来源 `manual`。

状态：已完成。该节点填补 `GAP-5 市场数据可靠性` 中“刷新后无统一校验、异常价格可直接污染持仓、任务中心无法区分校验阻断”的缺口；下一步继续补刷新前后快照 artifact 和校验规则版本。

进度 2026-05-11：收紧资产编辑边界。非现金资产人工只录入份额/克重、当前总市值和收益率；净值/现价由系统查询并只读展示，成本由 `总市值 / (1 + 收益率)` 自动反推；现金仍按金额维护。

验证：前端类型检查通过；3000 端口源码确认新弹窗暴露数量/份额/克重、当前总市值与收益率输入，现价/净值为只读展示；`019062` 净值查询返回 `tiantian` 实时数据。

进度 2026-05-11：完成资产编辑前后端一致性确认。后端保存持仓时重新查询系统行情校验 `currentPrice`，确保前端只读价格不能被客户端篡改；人工只负责总市值和收益率输入，成本由公式反推。

验证：`019062` 使用系统净值 `1.053` 保存成功；提交错误净值 `9.99` 被后端拒绝并返回 HTTP 400。

进度 2026-05-11：修正基金/债基/黄金份额展示和保存口径。份额/克重由总市值除以系统净值/金价反推，后端保存时强制重算，避免导入历史值 `quantity=1` 继续污染前端展示。

验证：009725 从 `quantity=1` 修正为 `156516.1833668294`，与 `163543.76 / 1.0449` 一致；前端源码确认基金/债基/黄金份额为只读反推展示。

进度 2026-05-11：全量修复基金/债基/黄金历史份额。14 个开放持仓已复扫，12 个历史不一致项已按 `marketValue/currentPrice` 修正份额，并按 `costBasis/quantity` 修正每份成本，保留总市值、总成本和盈亏。

验证：新增 `npm run test:derived-quantity` 并通过，覆盖 14 个基金/债基/黄金持仓；`npm run test:position-consistency` 通过。

进度 2026-05-17：完成持仓级止盈止损提醒闭环，并修正阈值语义为收益率百分比。资产管理表格新增收益率止盈/止损列，编辑弹窗支持为非现金持仓维护止盈收益率和止损收益率，例如 `5` 表示收益率达到 5% 时止盈、`-5` 表示亏损 5% 时止损；保存持仓后立即调用风险检查，若当前收益率已经触达阈值，会生成“触及止盈线”或“触及止损线”风险告警。后端风险检查接口支持 `refreshPrices=false`，用于“保存阈值后按当前已验证持仓收益率检查”，避免再次刷新行情导致交互阻塞。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:stop-alerts` 通过，验证 `601127` 当前收益率 `-38.98%`、测试止损收益率 `-38.97%` 时返回 `alertedSymbols=["601127"]` 并生成包含“收益率”的“触及止损线”风险告警，脚本随后恢复原阈值并清理本次测试告警；Playwright 截图 `.verification/assets-return-percent-stop-alerts.png` 和 `.verification/assets-return-percent-stop-alerts-modal.png` 验证前端资产页收益率止盈/止损列和编辑弹窗字段可见，无前端错误日志。

状态：已完成。该节点填补 `GAP-1 用户交互边界`、`GAP-3 领域服务边界` 和 `GAP-7 异步任务骨架` 中“止盈止损规则不可前端维护、保存后不能即时产出告警、缺少端到端回归”的缺口，并关闭“阈值按价格还是收益率解释不一致”的正确性缺口。

进度 2026-05-17：修正分析技术指标输入口径。`AnalysisService.getTradingSignals` 读取本地 `PriceHistory` 后按交易日去重，同一交易日多次刷新只保留最后一条，避免重复刷新记录被当成多个交易日并扭曲 RSI / MACD / 均线信号。`014064` 银华农业最近 30 天原始记录 21 条，但有效交易日只有 3 天，因此去重后不再输出 RSI 信号。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；数据库核验 `014064` 有效交易日为 `2026-04-30`、`2026-05-11`、`2026-05-15`，不足 20 天不会生成 RSI 交易信号；`npm run test:stop-alerts` 复跑通过。

状态：已完成。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-3 领域服务边界` 中“技术指标没有区分行情刷新记录和真实交易日样本”的正确性缺口。

进度 2026-05-18：完成 `TechnicalIndicatorService` 保护性第一段落地。新增统一技术指标审计服务，负责交易日去重、样本质量判定、均线/RSI/MACD/BOLL/ATR/量比/支撑压力位计算和结构化快照输出；`AnalysisService.getTradingSignals` 已迁移到该服务，但本地指标仅作为审计和 fallback，不再生成买卖信号。股票分析服务同步移除“实时价拼接假历史”的降级逻辑，真实历史 K 线不足时返回数据不足，避免低正确性技术面结论污染 AI 分析。正式技术面建议必须接入成熟外部 K 线/指标源和可靠技术建议模型。

验证：`npm run test:technical-indicators` 通过；后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:analysis-trace` 和 `npm run test:stop-alerts` 通过。

状态：已完成保护性第一段。该节点继续填补 `GAP-3 领域服务边界`、`GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“技术指标口径分散、没有样本质量字段、分析服务可能用伪历史数据输出建议”的缺口；下一段进入外部成熟 K 线/指标源、技术评级模型、`TechnicalAdviceModelRegistry` 和 `StockAnalysisFactSet`。

进度 2026-05-18：股票分析技术面接入外部技术指标展示。新增 `ExternalTechnicalDataProvider`，通过 TradingView Scanner 获取 A 股外部技术指标和 Technical Ratings；股票分析 API 返回 `externalTechnical`，前端技术指标面板展示外部来源、TradingView 标的、综合/均线/振荡器评级、RSI、MACD、ATR、SMA 和更新时间。本地指标保留为复核值，不生成交易信号。

验证：`npm run test:external-technical` 通过；后端和前端 TypeScript 检查通过；`GET /api/v1/stocks/601127?market=A股&days=80` 验证 `externalTechnical.quality=ok`、`provider=TradingView Scanner`、`providerSymbol=SSE:601127`。

状态：已完成第一段外部指标展示。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“股票分析技术面只展示本地计算指标、缺少外部来源和技术评级”的缺口；后续仍需建设 `TechnicalAdviceModelRegistry`，把外部指标转换为建议前必须经过模型来源、版本、回测和适用市场审核。

进度 2026-05-18：外部技术指标新增多源可信度评分。`externalTechnical.confidence` 输出评分、等级、来源数和逐项 checks；TradingView 作为外部技术评级主源，Eastmoney/Sina K 线作为独立复核源，交叉校验收盘价、SMA20、RSI14 和 MACD 方向。

验证：`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `confidence.score=95`、`level=high`、`sourceCount=2`，四项交叉校验均通过。

状态：已完成。该节点进一步填补 `GAP-5 市场数据可靠性` 中“单一外部技术指标源缺少可信度判断和跨源对账”的缺口。

进度 2026-05-18：技术指标到分析建议的模型边界落地。新增 `TechnicalAdviceModelRegistry` 第一版 `tradingview_ratings_interpretation_v1`，只有外部指标质量正常、多源可信度达到 `80`、无失败校验时，才把 TradingView Technical Ratings 解释为技术面观察结论；输出模型版本、证据、风险、边界和阻断原因，不输出直接买卖指令。

验证：`npm run test:technical-advice-model` 通过；`601127` 股票分析接口返回 `technicalAdvice.status=available`、`stance=defensive`、`summary=技术面偏防守`，证据引用 TradingView 评级、RSI14 和多源可信度。

状态：已完成第一版。该节点填补 `GAP-6 决策建议结构化` 中“外部指标如何进入建议缺少模型边界、证据和阻断条件”的缺口；后续需要接入回测表现和更多外部模型。

进度 2026-05-18：股票分析事实集第一段落地。新增 `StockAnalysisFactSet`，股票分析 API 返回 `factSet`，包含 `technical / fundamental / news` 三个分区；技术面 facts 已接入外部指标、可信度、交叉校验、本地复核和模型输出，基本面与消息面明确返回 `insufficient_data` 和 Provider 未接入警告。`technicalAdvice.evidenceRefs` 已约束为 factSet 中存在的事实 ID。

验证：`npm run test:stock-analysis-factset` 通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `factSet.schemaVersion=stock.analysis.factset.v1`、技术 facts `13` 条、技术面 `ok`、基本面/消息面 `insufficient_data`。

状态：已完成技术面第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-6 决策建议结构化` 中“股票分析缺少统一事实集、建议证据不能追溯、基本面/消息面空泛输出”的缺口；后续进入基本面和消息面 Provider。

进度 2026-05-18：基本面估值事实第一段落地。新增 `FundamentalDataProvider`，通过东方财富 quote/fundamental 接口获取动态 PE、PB、总市值、流通市值和最新价；股票分析 API 返回 `fundamentalSnapshot`、`peRatio`、`pbRatio`，并把估值和市值写入 `factSet.fundamental`。成长、盈利质量、现金流和行业分位仍未接入，继续以 warning 阻断完整基本面结论。

验证：`npm run test:fundamental-factset` 通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `peRatio=47.22`、`pbRatio=3.45`、基本面 facts `4` 条、`factSet.fundamental.quality=ok`。

状态：已完成估值第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-5 市场数据可靠性` 中“股票分析基本面没有外部估值事实源”的缺口；后续继续补成长、质量、现金流和行业分位。

进度 2026-05-18：消息面事件流第一段落地。新增 `NewsDataProvider`，通过东方财富搜索获取个股相关新闻，返回标题、摘要、媒体来源、发布时间、链接、事件类型、规则情绪和相关性；股票分析 API 返回 `newsSnapshot`，并把最近新闻写入 `factSet.news`。当前仍以 warning 标明公告全文、权威公告源、影响强度和 LLM 情绪复核未接入。

验证：`npm run test:news-factset` 通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `factSet.news.quality=ok`、消息面 facts `6` 条、新闻事件 `8` 条。

状态：已完成事件流第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-5 市场数据可靠性` 中“股票分析消息面没有外部事件事实源”的缺口；后续继续补公告全文、事件影响强度和多源消息去重。

进度 2026-05-18：三面分析汇总第一段落地。新增 `StockAnalysisSummary`，从 `StockAnalysisFactSet` 和技术建议模型生成三面摘要；每个分区输出状态、摘要、证据引用和阻断原因。技术面在模型可用时为 `available`，基本面和消息面因缺少完整维度标记为 `partial`。

验证：`npm run test:stock-analysis-summary` 通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `analysisSummary.overallStatus=partial`、技术面 `available`、基本面 `partial`、消息面 `partial`。

状态：已完成第一段。该节点填补 `GAP-6 决策建议结构化` 中“三面 facts 已有但缺少统一可消费摘要和阻断边界”的缺口。

进度 2026-05-18：基本面财报主指标第一段落地。`FundamentalDataProvider` 新增东方财富 F10 财务主指标接口，和 quote/fundamental 估值接口共同输出基本面事实；`factSet.fundamental` 写入最新财报期、营业收入、营收同比、归母净利润、归母净利同比、ROE、毛利率、资产负债率、经营现金流和 EPS，基本面 facts 从 4 条扩展到 13 条。`StockAnalysisSummary` 基本面摘要同步展示财报主指标，但仍保留行业分位、多源财报复核和完整三表未接入的阻断边界。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；接口验证 `601127` 返回 `2026一季报`、营收 `25745711786.75`、归母净利 `754464672.82`、ROE `1.83`、资产负债率 `65.9226`、经营现金流 `-20950295141.48`。

状态：已完成第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-5 市场数据可靠性` 中“股票分析基本面只有估值快照、缺少财报主事实”的缺口；后续继续补行业分位、多源财报对账、审计意见和完整三表。

进度 2026-05-18：基本面行业分位第一段落地。`FundamentalDataProvider` 新增行业同业对比，读取东方财富行业板块和成分股；`601127` 映射到 `乘用车(BK1262)`，用 9 个同业样本计算 PE/PB/总市值分位，并逐只拉取 F10 财务主指标计算 ROE 和资产负债率分位。`factSet.fundamental` 扩展到 20 条 facts，`StockAnalysisSummary` 基本面摘要新增同业对比。找不到行业板块时只输出 warning，不生成估值高低判断。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口验证 `601127` 返回 `乘用车(BK1262)`、PE 低估分位 `11.11`、PB 低估分位 `44.44`、ROE 分位 `100`、负债率低位分位 `33.33`、基本面 facts `20` 条。

状态：已完成第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-6 决策建议结构化` 中“基本面缺少行业分位、无法判断单个估值指标在同业中的位置”的缺口；后续继续补行业板块自动映射覆盖率、多源财报对账、审计意见和完整三表。

进度 2026-05-18：财报主指标同厂不同接口复核第一段落地。新增 `financialCrossCheck`，用东方财富 F10 主指标 `RPT_F10_FINANCE_MAINFINADATA` 与数据中心业绩报表 `RPT_LICO_FN_CPD` 交叉校验营业收入、归母净利润、基本 EPS、ROE 和毛利率；复核状态和逐项差异写入 `factSet.fundamental`，基本面 facts 从 20 条扩展到 26 条。当前仍标明同厂不同接口，后续需要交易所公告全文或独立第三方来源。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口验证 `601127` 返回 `财报复核：ok / RPT_LICO_FN_CPD`，营收和归母净利复核均 `pass / 差异 0%`。

状态：已完成第一段。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 中“财报主指标只有单一接口、缺少可追溯复核状态”的缺口；后续继续补交易所公告全文解析、独立第三方财报源和复核失败阻断策略。

进度 2026-05-19：独立来源财报复核第一段落地。新增搜狐证券重要财务指标页 `SOHU_CWZB` 解析，按页面单位“万元”转换为元后，与东方财富 F10 主指标交叉校验主营业务收入、净利润、每股收益、ROE 和资产负债率；复核状态和逐项差异写入 `factSet.fundamental`，基本面 facts 从 26 条扩展到 32 条，摘要层展示 `独立来源复核`。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口验证 `601127` 返回 `独立来源复核：ok / SOHU_CWZB`，营收和净利润复核均 `pass / 差异 0%`。

状态：已完成第一段。该节点填补 `GAP-5 市场数据可靠性` 中“财报复核仍停留在同厂不同接口，缺少独立外部页面对账”的缺口；后续继续补交易所公告全文解析与复核失败阻断策略。

进度 2026-05-19：公告原文定位第一段落地。新增 `officialAnnouncement`，通过搜狐证券重大事项备忘页定位对应报告期公告，抽取公告标题、披露日期和上交所 `static.sse.com.cn` PDF 链接；`factSet.fundamental` 写入公告原文定位状态、公告标题、披露日期和 PDF URL，摘要层展示 `公告原文：located / PDF`。当前只保证官方原文链接可追溯，PDF 表格字段抽取尚未接入。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口验证 `601127` 返回 `2026年第一季度报告`、披露日期 `2026-04-30`、上交所 PDF 链接和基本面 facts `36` 条。

状态：已完成第一段。该节点填补 `GAP-4 数据模型骨架` 和 `GAP-5 市场数据可靠性` 中“财报事实无法追溯到官方公告原文入口”的缺口；后续继续补 PDF 表格抽取和公告原文指标复核。

进度 2026-05-17：持仓页新增手工买入持仓入口。后端新增 `POST /api/v1/positions/manual-buy`，输入标的、买入金额或份额后，先通过 Asset Identity Resolver 识别或创建资产，再取外部现价/净值或使用人工成交价，最后创建买入交易并由交易服务更新持仓；股票/ETF 仍按 100 股一手校验。前端持仓页新增“新增持仓”按钮和弹窗，支持金额、份额、成交价、手续费、资产类型和标签。

验证：后端/前端 TypeScript 检查通过；新增 `backend/scripts/verify-manual-buy-position.ts` 与 `npm run test:manual-buy-position`，使用临时标的创建 8000 元、成交价 1.25 的基金类持仓，验证份额为 6400、市值为 8000、交易类型为 buy，随后清理临时交易、仓位和资产；Playwright 截图 `.verification/positions-manual-buy-modal.png` 验证持仓页新增入口和弹窗字段可见。

状态：已完成。该节点填补 `GAP-1 用户交互边界`、`GAP-2 API 边界硬化` 和 `GAP-3 领域服务边界` 中“新买入资产无法从持仓页直接添加，只能依赖导入或已有资产交易”的缺口。

进度 2026-05-17：新增 AI 投资分析与选股模型建设计划。文档 `docs/AI_INVESTMENT_ANALYSIS_MODEL_PLAN.md` 明确后续不能继续用本地规则直接冒充 AI 建议，而是拆为外部数据与指标、可回测策略模型、LLM 解释层和人工微调闭环；调研候选包括 `kand`、`technicalindicators`、TradingView Screener 类工具、Daily Stock Analysis 架构和 Dynamic Stock Recommendation 机器学习排序思路。

状态：部分完成。该节点对应 `GAP-4 数据模型骨架`、`GAP-5 市场数据可靠性` 和 V2.0 “分析入口收敛”中的模型化建议缺口；下一步进入 `TechnicalIndicatorService` 和 `StrategyModelRegistry` 实装。

进度 2026-05-17：将股票分析“三面内容空泛”纳入开发计划。`docs/AI_INVESTMENT_ANALYSIS_MODEL_PLAN.md` 新增 `StockAnalysisFactSet` 要求：基本面、消息面、技术面必须先形成可追溯事实集合，再由策略和 LLM 生成建议。基本面需包含财务、估值、成长、质量、行业分位；消息面需包含新闻/公告来源、时间、事件分类、情绪和影响方向；技术面需包含外部或可审计指标、样本数量、来源和更新时间。所有 AI 结论必须引用 `evidenceRefs`，没有数据时输出“数据不足”，不得输出模板化空话。

状态：待启动。该节点填补 `GAP-4 数据模型骨架`、`GAP-5 市场数据可靠性` 和 V2.0 “分析入口收敛”中“股票分析基本面/消息面/技术面缺少事实证据、不可追溯、不可验收”的缺口；下一步在 `TechnicalIndicatorService` 之后实现三面事实模型和前端证据展示。

进度 2026-05-17：将“外部策略发现 + 批量模拟买入 + 策略胜率对比可视化”纳入开发计划。`docs/AI_INVESTMENT_ANALYSIS_MODEL_PLAN.md` 新增阶段 F：系统从 GitHub、文档 URL、用户粘贴文本或本地模板发现选股策略和投资策略，LLM 仅解析为结构化草稿；策略必须经过来源、许可证、适用市场、数据字段和未来函数风险检查后人工确认。新增 `ExternalStrategyRegistry`、`StrategyTournamentService` 目标：将多个选股策略 × 多个投资策略 × 参数组合批量回测，输出胜率、收益、年化、最大回撤、夏普、盈亏比、交易次数、换手率、平均持仓周期和样本覆盖率，并用排行榜、收益曲线、回撤曲线、散点图、热力图和参数敏感性图展示。

状态：待启动。该节点填补 `GAP-4 数据模型骨架`、`GAP-6 决策建议结构化`、`GAP-7 异步任务骨架` 中“策略来源不可复用、选股策略和投资执行策略不能组合比较、回测结果缺少批量可视化排名”的缺口；下一步在 `StrategyModelRegistry` 后实现策略导入审核和锦标赛回测批次模型。

进度 2026-05-17：修正基金/债基刷新净值后的市值、收益率和多源净值校验。此前“手工市值保护”会导致用户校准后，后续刷新净值只更新现价、不更新市值和收益率；现在仅 `quantity <= 1` 的历史手工总额资产保留总额，其余基金/债基全部按固定份额乘官方净值重算。价格服务改为优先使用东方财富官方单位净值 `eastmoney_nav`，天天基金 `gsz` 仅作为盘中估值参考或官方净值不可用时的降级值。

验证：后端/前端 TypeScript 检查通过；刷新 Operation `b5952ee2-a61f-4588-9130-8b54c2ed82d7` 返回 `completed`、`externalRefreshed=22`、`failed=0`、`retainedLocalPrices=0`；`npm run test:market-data`、`npm run test:position-consistency`、`npm run test:derived-quantity`、`npm run test:fund-nav-sources` 均通过。多源脚本验证 13 个基金/债基系统净值全部等于东方财富官方净值，天天基金官方净值仍多为 `2026-05-14`，盘中估值与东方财富 `2026-05-15` 官方净值存在差异；前端截图 `.verification/assets-fund-nav-official-refresh.png` 验证资产页显示官方净值和来源。

状态：已完成。该节点填补 `GAP-3 领域服务边界`、`GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 中“基金估值和官方净值混淆、刷新后市值公式未回归验证、多源净值缺少批量校验”的缺口。

进度 2026-05-08：完成 `generate_daily_advice` Operation 的产物追踪契约，Operation DTO 返回 `operationId`、`artifactRefs`、`nextActions`；建议任务完成后持久化 `advice`、`advice_input_snapshot`、`position_snapshot`、`market_snapshot` 引用。修复 `scope=all` 带自然语言 query 时误过滤全部持仓的问题，并为建议快照行情读取增加短超时兜底，外部行情慢或不可用时不阻断任务完成。

验证：后端 `POST /api/v1/operations/generate-daily-advice` 创建任务，`GET /api/v1/operations/8f265cf9-821e-46b7-9de1-564a6f2dd73b` 返回 `status=completed`、`matchedPositions=24`、24 个 `position_snapshot`、17 个 `market_snapshot`、完整 `artifactRefs` 和 `run_backtest` next action；`node node_modules/typescript/bin/tsc --noEmit` 通过；后端运行态 `http://localhost:4000` 验证通过。

状态：已完成。

进度 2026-05-08：完成 Operation artifact refs 可追踪能力。后端新增 `/api/v1/operations/artifacts/:ref` 解析接口，支持 `advice:*`、`advice_input_snapshot:*`、`position_snapshot:*`、`market_snapshot:*`、`operation:*`、`alert:*` 返回结构化产物详情；任务中心 Artifact Refs 从静态标签升级为可点击入口，并新增产物详情弹窗。`artifactRef` 深链路已完成，可从 URL 直接打开指定产物详情。

验证：后端 `GET /api/v1/operations/artifacts/advice%3A8ed9721a-e8f7-4c30-ac93-35cddf2c1f6d` 返回建议详情、动作列表和 recommendation；`GET /api/v1/operations/artifacts/position_snapshot%3Ae1de5e8b-3d7b-4aaf-8851-0f52fe2ebe20` 返回持仓快照详情；前后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；Windows Chrome headless 截图 `operation-artifact-clickable.png` 确认任务中心 Artifact Refs 可见且布局正常；Windows Chrome headless 截图 `operation-artifact-detail-deeplink-fixed.png` 确认 `/operations?artifactRef=advice%3A8ed9721a-e8f7-4c30-ac93-35cddf2c1f6d` 可直接打开产物详情弹窗。

状态：已完成。

进度 2026-05-08：任务中心前端接入 Operation 顶层 `artifactRefs` 与 `nextActions`，新增“任务产物与下一步”通用面板；`nextActions` 支持链接跳转和 POST 动作提交。修正 `open_advice` next action 链接，改为可打开当前 Operation 并聚焦建议快照区域。优化任务中心移动端布局，侧栏在窄屏自动收起，详情弹窗宽度跟随视口，长 artifact refs 不再撑开页面。

验证：前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；Windows Chrome headless 截图验证 `http://localhost:3000/operations` 桌面任务中心列表、`/operations?operationId=8f265cf9-821e-46b7-9de1-564a6f2dd73b&focus=operation-contract-card` 桌面详情和 390px 手机宽度详情；截图确认任务产物数量、next action 按钮、建议预览和 Provider 健康度可见，移动端无页面级横向滚动。

状态：已完成。

进度 2026-05-08：完成 V1.5 异步化准备收口。Operation DTO 增加 `operation_id` 字段，保留 `id` 与 `operationId` 兼容；前端任务提交入口统一按 `operation_id / operationId / id` 解析；旧 `/api/v1/positions/sync` 与 `/api/v1/positions/refresh-prices` 改为返回价格刷新 Operation，避免绕过任务中心的同步刷新路径。任务详情页显示 `operation_id`，便于后续 Connect/MCP 工具契约复用。

验证：后端 `POST /api/v1/operations/check-alerts` 返回 `id`、`operationId`、`operation_id`，随后 `GET /api/v1/operations/e37f0323-fd75-4e25-b930-b41f4e10b358` 轮询到 `status=completed`、`alertCount=0`、`refreshPrices=false`；旧 `POST /api/v1/positions/refresh-prices` 返回 `operation_id=04d8b8b5-bf51-49a7-807f-8d962290d332` 且类型为 `refresh_prices`；价格刷新长任务验证后已取消，避免后台任务堆积；前后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；Windows Chrome headless 截图 `operation-id-polling-contract.png` 确认任务中心详情展示 `operation_id`、完成状态、输入参数和执行结果。

状态：已完成。

进度 2026-05-08：启动 V2.0 DomainPack 与工具契约。HTTP MCP Bridge 新增 `GET /api/v1/mcp/domain-pack`，返回 `fams.domainpack.v1` 机器可读 manifest；`GET /api/v1/mcp/tools` 返回工具的 `domain`、`version`、`inputSchema`、`outputSchema`、`permissions`、`safety`、`aliases`。新增 canonical tools：`operation.list`、`operation.get`、`operation.get_artifact`、`market_data.refresh_prices`、`alert.check`、`advice.generate_daily`、`backtest.run_from_advice`，并保留旧工具名兼容。新增静态注册参考 `mcp/fams-domain-pack.json`，作为后续 stdio provider 与 harnessOS 注册的契约入口。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`GET /api/v1/mcp/domain-pack` 返回 `schemaVersion=fams.domainpack.v1`、8 个 domain、15 个工具、HTTP/stdio transport 描述；`GET /api/v1/mcp/tools` 返回 `schemaVersion=fams.mcp.tools.v1`，且 `create_transaction.permissions.requiresHumanConfirmation=true`、`alert.check.safety.returnsOperationId=true`；`POST /api/v1/mcp/call` 调用 `operation.list` 返回 Operation 列表且包含 `operation_id`；调用 `alert.check` 返回 `operation_id=fe58d1e9-f738-44a7-a290-14cf32aa1235`，并完成告警检查任务。

状态：已完成。

进度 2026-05-08：完成 V2.0 工具契约可复用模块拆分。新增 `backend/src/mcp/registry.ts`，集中维护 `mcpTools`、`buildDomainPackManifest`、`listMcpTools`、`callMcpTool`、`callMcpBatch`；`backend/src/mcp/index.ts` 退化为 HTTP 传输层，只负责 Fastify route 和 HTTP status 映射。更新 `mcp/financial-mcp.json`，加入 `domainPack=mcp/fams-domain-pack.json`，并把 capabilities 切换为 canonical tool names，为 stdio MCP Provider 复用同一套 registry 做准备。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`mcp/financial-mcp.json` 与 `mcp/fams-domain-pack.json` JSON 解析通过；HTTP 端到端验证 `GET /api/v1/mcp/domain-pack` 仍返回 `schemaVersion=fams.domainpack.v1`、8 个 domain、15 个 tools；`GET /api/v1/mcp/tools` 仍返回 `schemaVersion=fams.mcp.tools.v1` 且包含 `operation.get` 与 safety 元数据；`POST /api/v1/mcp/call` 调用 `operation.list` 返回带 `operation_id` 的 Operation；缺失工具返回 `404` 与 `TOOL_NOT_FOUND`。

状态：已完成。

进度 2026-05-10：完成 V2.0 最小 stdio MCP Provider。新增 `backend/src/mcp/stdio.ts`，支持 JSON-RPC over stdio 的 `initialize`、`tools/list`、`tools/call`、`fams/domain-pack`，并复用 `backend/src/mcp/registry.ts` 的 manifest、工具列表和 handler。修复 stdio 导入 registry 时意外启动 HTTP server 的副作用：新增 `backend/src/db/prisma.ts` 独立持有 Prisma Client，并把 service/route 的 Prisma 引用从 `index.ts` 改为 `db/prisma.ts`。更新 `mcp/financial-mcp.json` 指向 `backend/dist/mcp/stdio.js`，`mcp/fams-domain-pack.json` 将 stdio 状态标记为 `implemented`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；stdio JSON-RPC 直接调用 `initialize`、`tools/list`、`fams/domain-pack` 成功，且不再启动额外 HTTP server；自动比对 HTTP `/api/v1/mcp/domain-pack` 与 stdio `fams/domain-pack`，两者均返回 15 个 tools、`schemaVersion=fams.domainpack.v1`，DomainPack schema 一致；stdio `tools/list` 保留 `create_transaction.permissions.requiresHumanConfirmation=true`；前后端服务恢复并监听 `http://localhost:3000`、`http://localhost:4000`。

状态：已完成。

进度 2026-05-10：完成 V2.0 交易保护确认节点。`create_transaction` MCP 工具新增标准 `confirmation` 输入 schema，并把交易写入从“仅元数据声明需要人工确认”推进到执行前阻断：未传入 `confirmation.confirmed=true` 与 `confirmation.confirmedBy` 时，工具只返回 `HUMAN_CONFIRMATION_REQUIRED`、拟写入交易摘要和 `confirm_transaction_write` next action，不会调用 `transactionService.createTransaction`。普通 REST 交易录入路径保持不变，继续由人工操作页面负责。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`mcp/fams-domain-pack.json` 与 `mcp/financial-mcp.json` JSON 解析通过；HTTP `GET /api/v1/mcp/tools` 返回 `create_transaction.inputSchema.properties.confirmation`、`permissions.requiresHumanConfirmation=true`、`safety.returnsNextActions=true`；HTTP `POST /api/v1/mcp/call` 未带确认调用 `create_transaction` 返回 `blocked=true`、`code=HUMAN_CONFIRMATION_REQUIRED`、1 个 next action；数据库 `transaction.count()` 调用前后均为 3，确认未写入；stdio JSON-RPC `tools/list` 与 `tools/call` 同样返回确认 schema 与阻断结果。

状态：已完成。

进度 2026-05-10：完成 V2.0 MCP 调用 envelope 与审计上下文收口。`callMcpTool` 统一返回 `fams.mcp.call.v1`，保留兼容的 `success/result/error` 字段，并新增 `status=completed|blocked|failed`、`tool.requestedName/name/domain/version`、`audit.calledAt/requestId/transport/userId/writes/requiresHumanConfirmation`。HTTP `/call`、`/batch` 和 stdio `tools/call` 复用同一 envelope；stdio 成功与阻断路径在 content 文本中返回完整 envelope，失败路径在 JSON-RPC `error.data` 中返回完整 envelope，便于外部 Agent 稳定解析。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；HTTP `operation.list` 返回 `schemaVersion=fams.mcp.call.v1`、`status=completed`、`audit.transport=http`；HTTP 未确认 `create_transaction` 返回 `status=blocked`、`result.code=HUMAN_CONFIRMATION_REQUIRED`，数据库 `transaction.count()` 前后均为 3；HTTP 缺失工具返回 `404`、`status=failed`、`error.code=TOOL_NOT_FOUND`；HTTP batch 返回 `schemaVersion=fams.mcp.batch.v1`，子调用状态分别为 `completed` 与 `failed`；stdio JSON-RPC 验证 `completed`、`blocked`、`failed` 三种路径均携带 `fams.mcp.call.v1` 和 `audit.transport=stdio`。

状态：已完成。

进度 2026-05-10：完成 V2.0 Connect 用户上下文与授权边界。MCP registry 新增用户上下文解析：工具声明 `userContext=required` 时，调用必须提供显式 `parameters.userId`、HTTP `x-fams-user-id / x-user-id` header 或 stdio `params.context.userId`。当上下文提供 userId 且工具参数未传 userId 时，registry 会在执行 handler 前自动注入；当参数 userId 与上下文 userId 不一致时，统一返回 `USER_CONTEXT_MISMATCH`，缺失时返回 `USER_CONTEXT_REQUIRED`。调用 envelope 的 `audit` 增加 `userContextSource`、`parameterUserId`、`contextUserId`，为后续 harnessOS 连接器注册提供可审计边界。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；HTTP 显式 `parameters.userId=default` 调用 `operation.list` 保持兼容并返回 `userContextSource=explicit_parameter`；HTTP 仅传 `x-fams-user-id=default` 且参数不带 userId 时，`operation.list` 成功并返回 `userContextSource=http_header`；HTTP header userId 与参数 userId 冲突时返回 `500`、`status=failed`、`error.code=USER_CONTEXT_MISMATCH`；HTTP 缺少任何 userId 时返回 `USER_CONTEXT_REQUIRED`；stdio `params.context.userId=default` 可自动注入，冲突时返回 JSON-RPC error 且 `error.data.error.code=USER_CONTEXT_MISMATCH`；未确认 `create_transaction` 通过 header 注入 userId 后仍返回 `status=blocked`，数据库 `transaction.count()` 前后均为 3。

状态：已完成。

进度 2026-05-10：完成 V2.0 harnessOS 最小连接器注册 manifest。新增 `mcp/harnessos-connector.json`，定义 `fams` 连接器入口、`fams_mcp_http` 与 `fams_mcp_stdio` 两种传输、DomainPack 引用、用户上下文来源、工具调用 envelope、交易保护策略和 15 个 canonical tools。`mcp/fams-domain-pack.json` 新增 `connectorManifest` 指向该注册入口，`mcp/financial-mcp.json` 新增 `harnessOSConnector`，使 FAMS 仓库内形成 DomainPack、MCP client config、harnessOS connector 三个契约入口的闭环。

验证：`mcp/harnessos-connector.json`、`mcp/fams-domain-pack.json`、`mcp/financial-mcp.json` JSON 解析通过；连接器 manifest 与 DomainPack 的 canonical tools 完全一致，数量均为 15；后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；HTTP `GET /api/v1/mcp/domain-pack` 返回 `schemaVersion=fams.domainpack.v1`、15 个 tools、stdio 状态 `implemented`；HTTP `GET /api/v1/mcp/tools` 返回 15 个工具且包含 `operation.list`；HTTP 使用 `x-fams-user-id=default` 调用 `operation.list` 返回 `status=completed`；stdio JSON-RPC `fams/domain-pack`、`tools/list`、带 `context.userId=default` 的 `operation.list` 调用均成功；未确认 `create_transaction` 经 HTTP header 注入 userId 后仍返回 `status=blocked`、`HUMAN_CONFIRMATION_REQUIRED`，数据库 `transaction.count()` 前后均为 3。

状态：已完成。

进度 2026-05-10：完成 V2.0 端到端验收收口与发现问题修复。`/api/v1/workflows` 不再返回硬编码执行状态，新增进程内 execution registry，`POST /execute`、`GET /executions/:id`、`GET /executions`、`POST /executions/:id/cancel` 返回真实状态；`daily_analysis` 复用 MCP/Operation 路径，价格刷新作为异步子任务提交后继续执行，避免外部行情源阻塞整条分析链路。前端任务中心修复移动端布局、Operation detail 深链可见性和 artifact 结构化阅读；Dashboard 修复长百分比和风险仪表盘重叠。

验证：后端 `node node_modules/typescript/lib/tsc.js --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc` 与 `node node_modules/vite/bin/vite.js build` 通过。端到端调用 `POST /api/v1/workflows/execute` 执行 `daily_analysis`，execution `75d7d8da-6f1f-4691-82de-16f9195dc29a` 轮询到 `status=completed`、`progress=100`、`completedSteps=4/4`、3 个子 Operation、无 errors；建议 Operation `d96f438e-d6a6-4793-abfc-2d0c18a89c6c` 完成并生成 advice `3f8b623d-a902-46c6-9419-994e135b7d83`、24 个持仓快照、17 个行情快照和 43 个 artifact refs。Windows Chrome headless 截图验证 `.verification/v20-fixed-operations-desktop-final.png`、`.verification/v20-fixed-operations-mobile-final3.png`、`.verification/v20-fixed-operation-detail-final.png`、`.verification/v20-fixed-artifact-detail-final.png`、`.verification/v20-fixed-dashboard-final.png`。

状态：已完成。该节点填补 `GAP-6 Connect 与 MCP 成熟度` 的工具契约到真实工作流调用断点，并补强 `GAP-7 异步任务骨架` 的状态查询、取消和产物回流验收。

进度 2026-05-10：修复 AI 股票分析链路。后端入口加载 `.env`，确保 DeepSeek / MiniMax key 在运行态可用；股票行情 HTTP 调用增加 curl fallback，规避 axios 经本机代理访问 HTTPS 时返回 400/502 的问题；A 股实时行情新增 Sina fallback；历史行情失败时不再把 6 开头股票伪造成贵州茅台，而是使用真实实时行情构造保守技术面输入。LLM 返回新增 `provider` 与 `isAiGenerated`，前端显示真实 AI provider 或明确标记“本地规则兜底”。

验证：后端 `node node_modules/typescript/lib/tsc.js --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc` 通过；`GET /api/v1/stocks/601888` 返回 `name=中国中免`、`currentPrice=62.68`；`POST /api/v1/llm/stock-advice` 返回 `symbol=601888`、`name=中国中免`、`provider=deepseek`、`isAiGenerated=true`、3 条 AI reasoning。该节点填补 `GAP-5 市场数据可靠性` 与 `GAP-2 API 边界硬化` 中 AI 分析数据源和兜底状态不可见的问题。

状态：已完成。

进度 2026-05-10：修复标签、总览告警仪表盘、价格刷新与统一分析入口。后端删除标签时同步清理 `AssetTag` 与持仓 JSON 标签，前端 TagSelector 增加“管理标签/删除”入口，并从前端预设和后端自动类型标签中移除“集合投资”；数据库已清理现有“集合投资”标签。Dashboard 风险仪表盘隐藏轴刻度并压缩高度，避免活跃告警数字与仪表盘重叠。价格刷新 Operation 改为并发刷新资产并给单资产行情 8 秒超时，Operation 内告警检查不再二次刷新价格。分析建议页合并 Dashboard AI 股票分析入口，新增标的/板块统一研究展示和 AI 选股入口；AI 选股第一版支持“A杀后横盘放量”规则，返回候选、规则指标和低置信度兜底说明。

验证：数据库脚本清理 `集合投资`，结果 `removedAssetLinks=1`、`removedFromPositions=1`；`GET /api/v1/tags` 返回 `hasCollection=false`；后端 `node node_modules/typescript/bin/tsc` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`POST /api/v1/operations/refresh-prices` 创建 Operation `6a0a8eec-c7c0-412f-8897-e1a0204020ef`，轮询返回 `status=completed`、`progress=100`、`refreshed=3`、`failed=21`，失败项为外部 provider 超时而非任务卡死；`POST /api/v1/analysis/stock-screener` 返回 `strategy=A杀后横盘放量`、`universeSize=10`、候选列表可用；`POST /api/v1/llm/stock-advice` 输入 `601888` 返回 `name=中国中免`、`provider=deepseek`、`isAiGenerated=true`；Windows Chrome headless 截图 `.verification/dashboard-after-fix-wait.png` 确认总览风险仪表盘数字不再重叠，`.verification/analysis-ai-screener-wait.png` 确认分析建议页已出现统一研究和 AI 选股入口。

状态：部分完成。已填补 `GAP-1 用户交互边界`、`GAP-5 市场数据可靠性`、`GAP-7 异步任务骨架` 的当前缺陷；外部行情源在本机网络下仍大量超时，后续需接入缓存、Akshare/本地代理或手动行情源，才能把刷新成功率从“任务可完成”提升到“价格全量可靠”。

进度 2026-05-19：完成 AI 选股多策略短窗胜率评估第一段。`StockScreenerService` 在同一批全 A 股历史 K 线上并行评估三类内置策略，接口新增 `strategyTournament`，按最近可验证交易日信号和持有 N 日后的收盘价统计胜率、平均收益、当前命中数和候选样本；前端 AI 选股结果新增多策略胜率排行。该节点填补 `GAP-3 领域服务边界` 中“选股策略不可比较”和 `GAP-5 市场数据可靠性` 中“策略结论缺少近期样本复核”的缺口。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过；运行态 `POST /api/v1/analysis/stock-screener` 输入 `多策略胜率；扫描上限=30；验证天数=5；持有天数=3` 返回三类策略排行，A杀策略 `signals=5 / wins=0 / winRate=0 / avg=-6.06`。

进度 2026-05-19：完成 AI 选股短窗胜率回测批次持久化。`strategyTournament` 生成统一 `batchId`，每个内置策略写入 `Strategy / Backtest / BacktestResult`，并在 `reviewReportJson` 保存查询、策略版本、阈值、样本池、数据质量、观测指标、信号样本和当前候选。前端展示批次号和 Backtest ID，回测详情接口可追溯原始查询与指标。该节点继续填补 `GAP-4 数据模型骨架` 中“策略评估没有批次化记录”和 `GAP-7 异步/产物骨架` 中“分析产物不可回查”的缺口。

验证：`npm run test:screener-service` 覆盖 Backtest/BacktestResult 持久化；运行态接口返回 `batchId=13529910-0c3a-424a-9ae4-af490e2f48a7`、三条策略均 `persistenceStatus=persisted`；`GET /api/v1/backtest/results/57a4eb9d-6859-4615-b507-3e384b76ca18` 返回 `status=completed`、`reviewReport.kind=stock_screener_strategy_tournament`、`query=多策略胜率；扫描上限=20；验证天数=5；持有天数=3`。

进度 2026-05-19：优化分析页持仓研究面板。后端按资产类型生成基本面、技术面、消息面研究边界，前端从三行文字改为四个指标块加三栏研究卡片，展示市值、现价/成本、支撑/压力、止盈止损以及基本面/技术面/消息面的证据边界。该节点填补 `GAP-1 用户交互边界` 中“分析信息不可扫描”和 `GAP-5 市场数据可靠性` 中“泛化文案掩盖数据边界”的缺口。

验证：后端/前端 TypeScript 检查通过；运行态持仓研究接口返回 22 条，股票样例 `601127` 指向个股事实集和公告原文，现金样例显示金额口径和建仓资金池边界。

进度 2026-05-19：AI 选股可信度评估增强。`strategyTournament` 增加同窗口全样本基准、策略超额收益、样本充分度、Wilson 胜率置信区间和可信评级；前端展示基准收益、超额收益和可信分。该节点填补 `GAP-5 市场数据可靠性` 中“胜率结论缺少统计置信度和基准对照”的缺口。

验证：后端/前端 TypeScript 检查和 `npm run test:screener-service` 通过；运行态 `扫描上限=50` 返回基准样本 `250`、基准收益 `-2.95%`，三类策略均为 `low` 可信且相对基准无超额收益。

进度 2026-05-21：完成“架构设计 / 代码实现 / 需求偏移”三方向检视后的第一批并行修复。Operation 写入路径增加 `leaseToken` fencing，防止旧 worker 覆盖新 owner；`idempotencyKey` 冲突返回既有任务；有效租约取消进入 `cancelling` 后由 owner 收口。LLM 股票分析和股票详情前端收紧为“事实观察”，不再输出或展示买入/卖出、目标价、止损、止盈、仓位等交易决策。`StockFactSetCache` 增加 `lookbackDays / timeframe` 唯一维度，修复不同窗口缓存污染；到期事实集调度改为全量扫描开放持仓，并对 `position_advice / stock_factset` 分开提交，避免 mixed scope 被 limit 截断。MCP Operation schema 与前端轮询补齐 `succeeded / partial / cancelling`，partial success 在前端以部分成功展示。会改写 dev 数据库的验证脚本增加显式环境变量确认，避免验证污染真实开发账本。

验证：Prisma `validate/generate` 通过；后端/前端 TypeScript 均通过；`verify-operation-recovery` 验证过期租约恢复、有效租约保护、fencing token 释放和幂等冲突返回；`verify-due-factset-refresh` 验证到期事实集提交并完成；`verify-stock-factset-cache` 验证 80 日与 60 日缓存并存且互不污染；`verify-factset-refresh-scheduler` 验证交易时段跳过、调度租约阻断、盘后 split scope 提交并完成。该节点填补 `GAP-5 市场数据可靠性`、`GAP-6 Connect 与 MCP 成熟度`、`GAP-7 异步任务骨架` 的关键正确性缺口。

进度 2026-05-21：继续补齐账本和 API 边界。`ensureUser` 从“任意 userId 静默 upsert”改为只自动兼容 `default` 本地用户；非 default 用户必须先存在，或显式设置 `FAMS_ALLOW_DYNAMIC_LOCAL_USERS=1`。`AnalysisService` 已复用统一用户边界。`Position` 新增 `openKey` 唯一键，开放持仓写入 `userId:assetId`，平仓后清空，保证同一用户同一资产最多一个开放持仓。交易买入创建持仓时写入 `openKey`，并在唯一冲突时重新读取已有开放持仓合并数量和成本，避免并发买入或重复提交产生两个 open position。Fastify 错误契约补充 Prisma `P2002 -> 409 CONFLICT`、`P2025 -> 404 NOT_FOUND`。

验证：Prisma 同步与客户端生成通过；`verify-open-position-uniqueness` 完成现有 22 个开放持仓 openKey 回填，验证 `missingOpenKey=0`，并验证非 default 动态用户被阻断；后端/前端 TypeScript 通过；SQLite 完整性 `ok`；交易成本模型和持仓聚合一致性回归通过。该节点填补 `GAP-2 API 边界硬化` 与 `GAP-3 领域服务边界` 的账本一致性缺口。

进度 2026-05-28：完成 P4.33.2 K线预热 Worker 验收闭环。新增 `test:market-bar-cache-preheat-worker`，覆盖 `market_bar_cache_preheat` queued worker 领取、chunk task、artifact、queued 取消和过期 lease 恢复。验收发现并修复 result 产物缺少 schemaVersion 的契约问题，现写入 `schemaVersion=fams.market_bar.cache_preheat_result.v1`。

验证：后端/前端 TypeScript 检查通过；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:market-bar-cache-preheat-worker` 通过。主验收 Operation `4bc2e7bf-8e04-43bc-8da7-be2f23eb9023` completed，`requestedSymbols=4`、`attemptedSymbols=1`、`successCount=1`、`failureCount=0`、`fetchedBars=120`，artifact 可读取；取消验收 Operation `209688b0-ece9-414a-9a31-6e3175ce9180` cancelled；恢复验收 Operation `69bf14eb-8bd3-4712-bfb2-24144ed1a2fc` completed，`recovery.reason=expired_lease_worker_recovery`。该节点继续填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架`，剩余未闭环项为 2000 样本 queued 预热压力验收和 SQLite provider health 写入 timeout 优化。

进度 2026-05-28：完成 P4.33.3 K线预热 queued 压力验收第一段。`MarketBarCacheService` 将 provider health 与 raw/canonical upsert 统一串行化，降低 SQLite 并发写 timeout 风险。新增 `run:market-bar-cache-preheat-pressure`，用于创建 queued Operation、worker 执行、校验 chunk、artifact、provider health 和 timeout/database locked。压力验收发现“刷新后仍 stale 但任务 completed”的假成功问题，现已增加 afterCoverage 校验：仍不充分的标的写入 `coverageWarnings / coverageWarningCount`，Operation 标为 `partial`。

验证：后端/前端 TypeScript 检查通过；P4.33.2 复验脚本通过。80 样本强制刷新 Operation `36ef53b1-ce33-4106-85a3-07efc29a8a76`，`requested=80`、`success=80`、`fetchedBars=9600`、`reportBytes=17600`、无 timeout/database locked。4 样本校验 Operation `a06153c5-0f7a-4d80-b861-cf8b09616750` 正确返回 `partial`、`coverageWarningCount=1`。40 样本压力 Operation `fbf8883f-1bfe-4c71-862b-da5bf0dfc6dc`，`status=partial`、`requested=40`、`success=40`、`fetchedBars=4800`、`coverageWarningCount=1`、`reportBytes=9448`、`sina healthy/closed`、无 timeout/database locked。该节点继续填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架`；剩余主要风险是 SQLite 下 2000 样本耗时预计约 70 分钟，下一步需做 200/300 样本压力或 PG/批量 upsert 评审。

进度 2026-05-28：完成 P4.33.4 K线 raw/canonical 批量写入优化。`MarketBarCacheService.upsertBars` 从逐条 raw/canonical upsert 改为按单标的批量事务：tradeDate 去重、删除当前范围旧 raw/canonical、`createMany` raw、回查 raw id/hash、`createMany` canonical。单只股票 120 日 K 线从约 240 次 upsert 降为 5 个批量操作，`sourceRefsJson` 保留 `rawId/symbol/tradeDate/provider/hash`。

验证：后端/前端 TypeScript 检查通过。4 样本 Operation `d36fad70-b439-440e-9ecd-4a1041c0dab6` elapsedMs `6756`，上一轮约 `18032`；40 样本 Operation `89868019-570d-4acd-bd2a-4fcfc32fa2d3` elapsedMs `26681`，上一轮约 `87634`；80 样本 Operation `8dc4706f-ebfb-4dfc-acf6-4d7c7536d2e0` elapsedMs `49169`，上一轮约 `166912`。三组均无 timeout/database locked，provider 为 `sina healthy/closed`。该节点继续填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架`；下一步重点从 force refresh 转向只补缺失交易日，避免全量重拉。

进度 2026-05-28：整合 GPT 架构评审并启动 P4.34。新的边界是：行情同步作为独立基础设施，AI 选股扫描默认只读本地 canonical / feature cache；缓存不足时应返回 warmup blocker 或关联 `market_data.warmup` Operation，而不是在扫描中实时拉全量外部 K 线。后续计划新增 `market_data_coverage`、fetch/validate/persist pipeline、provider health 聚合写、`market_feature_daily`，并把选股扫描和策略回测解耦。

进度 2026-05-28：完成 P4.34.1 `stock_screener` 默认只读 canonical cache。`ScreenerOptions` 新增 `marketDataMode=cache_only|live_fetch`，默认 `cache_only`；只有查询包含 `允许实时行情=1`、`allowLiveMarketFetch=1` 或环境变量 `FAMS_SCREENER_MARKET_DATA_MODE=live_fetch` 时才允许扫描中实时拉 provider。`marketBarCacheService` 新增 `getCachedHistory`，只读 `market_bar_canonical`，不写 raw/canonical/provider health。`dataQuality / observability / chunkSummary` 记录 `marketDataMode`。

验证：后端/前端 TypeScript 检查通过；`verify-operation-worker-readiness` 通过。验收 Operation `4d4ecc94-dfba-4da7-9083-1fc224815d41` completed，`scanned=2`、provider=`cache`、cacheHitRate=`100`、historySources=`cache:sina`、market data chunk duration=`17ms`、artifactRefs=`17`；恢复 Operation `448ec1a2-79d3-45a4-9203-01a8508da121` completed。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 中“扫描与实时行情抓取耦合”的缺口；下一步补 coverage 表和 warmup blocker。

进度 2026-05-28：完成 P4.34.2-P4.34.3 `market_data_coverage` 与 warmup blocker。新增 `MarketDataCoverage` 表，记录 symbol/market/timeframe/adjustType/dataVersion、complete_to、actual/expected/missing、missing ranges、status、stale reason 和验证时间。`marketBarCacheService.getCoverageReport` 会同步 upsert coverage；`stock_screener_full_scan` 新增 `market_data.coverage` task 和 `coverage_report.json` artifact。cache-only 模式下 coverage 不 sufficient 的标的不进入策略计算，failure code 为 `NEEDS_MARKET_DATA_WARMUP`，Operation 标为 partial，并自动创建 queued `market_bar_cache_preheat` 子 Operation。

验证：Prisma `db push` 和 client generate 通过；后端/前端 TypeScript 检查通过。常规小样本 Operation `81e2e61d-d95f-4313-bf2a-71187b490434` completed，tasks=`7`、artifactRefs=`18`、`coverage_report.json` 存在，`marketDataWarmupRequired=false`，coverage 表中 `000001 / 000002` 均为 sufficient。blocker Operation `fff93efd-524b-4d65-9ac7-1678cfc2f161` partial，stale 标的 `000004` 返回 `NEEDS_MARKET_DATA_WARMUP`，自动创建子 warmup Operation `7bec65cc-ad5b-4619-9d26-906912db07eb`。该节点继续填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架`；下一步把扫描前 coverage 判断改为优先 bulk 读 `market_data_coverage`。

进度 2026-05-29：完成 P4.34.4-P4.34.5 coverage bulk query 与 provider health 聚合写。`getCoverageReport` 先批量读取 `market_data_coverage`，仅对摘要缺失或不满足 requested days 的标的回查 canonical 聚合；coverage 写回改为分块 `deleteMany + createMany`。`provider_health` 改为内存窗口聚合，`getHistory` 不再每只股票立即写健康表，K 线预热 chunk 结束和健康报告读取前统一 flush。

验证：后端/前端 TypeScript 检查通过；coverage 直连验证 4 标的用时 `79ms`，sufficient=`2`、insufficient=`2`、stale=`2`；常规 worker Operation `2b63b43e-4f50-4386-bf01-3dcd01d63186` completed；blocker Operation `074280dd-87cf-44b6-b30f-da78ac8d057c` partial 并创建子 warmup `6dd2761a-54a8-4951-b5ab-ef8414292c23`；K 线预热 worker Operation `31c68662-ca7f-4c70-b6fd-61d5552275b0` partial，chunk completed，recovery Operation `8ec89f3f-ad24-46b7-8210-1572438e32d9` completed。该节点继续填补 `GAP-5 市场数据可靠性` 与 `GAP-7 异步任务骨架`；下一步进入 `market_feature_daily`，减少策略扫描时重复遍历 K 线。

进度 2026-05-29：完成 P4.34.6 `market_feature_daily` 特征缓存第一段。新增 `MarketFeatureDaily` 表和 `marketFeatureDailyService`，从 canonical K 线生成 return、MA、斜率、volume ratio、ATR、RSI、波动率、最大回撤、相对强弱、流动性/趋势/动量评分。`market_bar_cache_preheat` afterCoverage 后新增 `market_feature.compute` task；`stock_screener_full_scan` 新增 `market_feature.coverage` task 和 `market_feature_coverage.json` artifact。

验证：Prisma `db push` 通过；后端/前端 TypeScript 检查通过。K 线预热 Operation `50d663c5-126e-4f94-bb15-1e6ef7ba0d43` 生成 computedSymbols=`3`、featureRows=`324`；全市场扫描 Operation `f956fbe7-1c3a-4aad-a0bd-28e5cc87128a` completed，tasks=`8`、artifactRefs=`19`，`market_feature.coverage` completed，feature coverage=`100%`。该节点继续填补 `GAP-5 市场数据可靠性` 和 `GAP-6 决策建议结构化` 的技术事实缓存缺口；下一步将当前候选筛选迁移为 feature-first。

进度 2026-05-29：完成 P4.34.7 feature-first 当前候选筛选。`MarketFeatureDaily` 补充 `rollingHigh20 / rollingLow20 / rollingHigh60 / rollingLow60`；当前候选评分优先读取最新 `market_feature_daily`，缺少 feature 时才 fallback 到历史 K 线。`strategy.evaluate` task metrics 写入 `featureFirst / featureFirstEvaluatedCount / historyFallbackEvaluatedCount`，`dataQuality.featureFirstScreening` 记录当前筛选与回测解耦边界。

验证：Prisma `db push` 通过；后端/前端 TypeScript 检查通过。特征重算 `000001/000002/000004` 生成 `377` 行，rolling high/low 已写入。Operation `5185878a-45eb-4f3f-ab9f-f30407112349` 验证 `featureFirstEvaluatedCount=2`、`historyFallbackEvaluatedCount=0`，候选 `historySource=feature:market_feature_daily`，20 日振幅正常显示。增强后的 `verify-operation-worker-readiness` 通过，Operation `667e4cf4-d6fd-46d0-abc0-84fa59b71b38` completed。该节点继续填补 `GAP-5 市场数据可靠性` 与 `GAP-6 决策建议结构化`；下一步拆分当前筛选与回测 evidence 引用。

进度 2026-05-30：完成 P4.34.8 全 A 完整扫描验收第一段。全 A universe 来源 `sina_hs_a_all_a_share`，共 `5524` 只。K 线预热 Operation `73057da6-b372-4fd0-b11c-70e8078e493d` 拉取 `304316` 条 K 线，修复 afterCoverage 摘要旧口径后，120 日 K 线 sufficient=`5447`、insufficient=`77`、estimatedCacheHitRate=`99.22%`。补算 feature cache：requested=`5447`、computed=`5447`、featureRows=`551019`。完整扫描 Operation `5757bc50-59ea-4826-a83b-886ca9118acf` 生成 `19` 个 artifact，featureFirstEvaluatedCount=`5447`、historyFallbackEvaluatedCount=`0`、matchedCount=`3`，候选为 `002230 科大讯飞`、`600848 上海临港`、`600690 海尔智家`。

验证结论：全 A 功能链路已跑通，但 Operation status 为 `partial`。原因是 `77` 只标的历史 K 线不足/过期，本次 `验证天数=5` 未满足 `>=60` 长窗高可信门槛，factset coverage 仍为 `35.66%`。该节点填补 `GAP-5 市场数据可靠性` 和 `GAP-7 异步任务骨架` 的真实全 A 运行缺口；下一步进入长窗 evidence 解耦与事实集覆盖补齐。

进度 2026-05-30：完成 P4.34.9 策略证据异步化第一段。新增 `strategy_tournament_run` Operation 和 `POST /api/v1/operations/strategy-tournament-run`，支持 queued worker、恢复、重试、高成本全 A 确认保护和 evidence refs。该任务用于独立生成 60 日长窗策略证据，结果写入 `operationKind=strategy_tournament_run`、`evidenceMode=async_strategy_evidence`、`evidenceRefs.batchId/artifactRefs/backtestDays`。

验证结论：后端/前端 TypeScript 检查通过。Service 小样本 Operation `6a65f81e-8288-4676-b60c-79b20743b46c` 和 API 小样本 Operation `f04d3c65-1eb3-43b3-a96e-54499ad141e8` 均能由 worker 执行到 `partial`，生成 `19` 个 artifact；`evidenceRefs.backtestDays=60` 与 `longSampleAcceptance.summary.backtestDays=60` 一致。该节点继续填补 `GAP-7 异步任务骨架` 与 `GAP-6 决策建议结构化`；下一步让当前选股扫描引用最近有效 evidence，并继续补行业/市值事实集覆盖。

进度 2026-05-30：完成 P4.34.10 当前筛选引用异步 evidence。普通 AI 选股默认只做当前信号筛选，不再即时生成短窗 `strategyTournament`；结果新增 `asyncStrategyEvidence`，引用最近一次 `strategy_tournament_run` 的 Operation、batch、artifact、长窗天数、验收状态、可信度和 blocker gate。前端新增“异步策略证据引用”区块。显式调试入口保留：查询中加入 `即时回测=1` 才会运行旧的内联回测。

验证结论：后端/前端 TypeScript 检查通过。默认普通选股 `扫描上限=5` 返回 `hasInlineTournament=false`、`asyncStrategyEvidence.status=referenced`、引用 Operation `f04d3c65-1eb3-43b3-a96e-54499ad141e8`、`backtestDays=60`、`artifactRefs=19`、`usableForTradingAdvice=false`。显式 `即时回测=1` 返回 `hasInlineTournament=true`，同时仍引用异步 evidence。该节点继续填补 `GAP-6 决策建议结构化` 和 `GAP-7 异步任务骨架`；下一步执行受控全 A 60 日 evidence 或继续提高 factset coverage。

进度 2026-05-30：完成 P4.34.11-P4.34.12 60 日长窗口径修复、500 样本验收和全 A OOM 验收。`evaluateStrategyTournament` 实际 evaluationDays 上限已从 20 调整为 120，`longSampleAcceptance` 改为报告真实 `tournament.evaluationDays`。500 样本 60 日 Operation `c4723855-0e0b-4461-b043-716a15ad53d8` 在深度验证准入优化后，`backtest.aggregate` 从 211572ms 降至 77637ms，bestSampleSize=`281`、bestCredibility=`medium`。真实全 A 60 日 Operation `8c4f96d8-2352-4811-be5c-6de6a8ba3e07` 完成 universe/coverage/feature 输入阶段，但在 `backtest.aggregate` 触发 Node heap OOM，已收口为 failed。

验证结论：`GAP-5 市场数据可靠性` 的全 A 输入链路基本闭环，`GAP-7 异步任务骨架` 能正确暴露失败原因；新的主要 gap 是 `backtest.aggregate` 需要分片/流式化，不能再单进程持有全量 outcome、深度验证和 artifact。

进度 2026-05-30：完成 P4.34.13 全 A 60 日基础 evidence 验收。`backtest.aggregate` 去除大规模 signal metric 缓存，`auditHash` 改为摘要输入，全 A 基础聚合不再内联深度稳定性验证。真实全 A Operation `c3338ac1-0c8e-4e5d-8c38-bad4d257ccbb` 完成，scanned=`5524`、evaluated=`5447`、providerSuccessRate=`98.61%`、cacheHitRate=`99.95%`、backtestDays=`60`、signals=`243118`、rankedStrategies=`108`、bestSampleSize=`3766`、bestCredibility=`high`，`backtest.aggregate=429886ms`。Operation 仍为 `partial`，因为 validation evidence 未补齐，factset coverage=`35.66%`。

同步修复：`market_bar_cache_preheat` 的 result/artifact 改为摘要化 coverage，feature 重算范围改为本次尝试 symbols。复验 Operation `68630b63-1fc6-4ece-86be-a966e5104906` attempted=`77`、success=`16`、warnings=`61`、failures=`0`，artifact 可读取且明细已截断。

验证结论：`GAP-7 异步任务骨架` 的真实全 A 长任务可完成性从 OOM 推进到可完成但 partial；`GAP-5 市场数据可靠性` 仍剩 77 个 provider/coverage 缺口；`GAP-6 决策建议结构化` 仍不能把该 evidence 用于交易建议，下一步必须补 top-N 深度验证子任务、provider warning 分类和 factset coverage。

进度 2026-05-30：完成 P4.34.14 全 A top-3 深度验证补跑。全 A Operation `67d0ea3e-209f-4a2e-8fc5-d82cc0bc100d` 完成，elapsedMs=`549549`，`backtest.aggregate=528100ms`，scanned=`5524`，evaluated=`5447`，top-3 候选均补跑 out-of-sample、walk-forward、parameter sensitivity、group stability。三名候选的 walk-forward、参数敏感性和分组稳定性均通过，但 out-of-sample 均失败，因此 `validation_evidence` 仍为 failed，actual=`0`。

验证结论：`GAP-7 异步任务骨架` 已证明可以承载全 A top-3 深度验证；`GAP-6 决策建议结构化` 继续正确阻断交易建议，原因是样本外稳定性未通过。下一步重点从“扩大 top-N”转为诊断样本外失败原因，并补齐 `GAP-5` 的 provider warning 分类与 factset coverage。

进度 2026-05-30：完成 P4.34.15 样本外失败诊断 artifact。新增 `out_of_sample_diagnostics.json`，并在 `data_quality_report.json` 和 Operation result 中同步写入 `outOfSampleDiagnostics`。受控 Operation `02a8d944-5795-4590-9acb-b53ef256f07b` 完成，artifactRefs=`20`，`diagnosedCandidates=3`、`passedCount=0`、`failedCount=3`。诊断显示：训练窗口有正超额，样本外窗口超额转负，同时 walk-forward、参数敏感性和分组稳定性通过，因此优先怀疑时间切分窗口或近期市场状态变化，而不是直接放行策略。

验证结论：该节点继续填补 `GAP-6 决策建议结构化` 中“失败原因不可解释”的缺口；`GAP-5 市场数据可靠性` 仍需 provider warning 分类，避免 coverage warning 派生重复 warmup。

进度 2026-05-30：完成 P4.34.16 样本外窗口市场状态诊断 artifact。新增 `out_of_sample_market_state.json`，并在 `data_quality_report.json` 和 Operation result 中同步写入 `outOfSampleMarketStateDiagnostics`。受控 Operation `ddf2c8bd-6cf9-4327-aad8-665a0b2c8ab0` 完成，artifactRefs=`21`，`diagnosedCandidates=3`，`resultHasMarketDiag=true`，`dataQualityHasMarketDiag=true`。诊断基于 `market_feature_daily` 聚合训练窗口与样本外窗口的平均收益、回撤、波动率、趋势/动量/流动性和强弱趋势市场宽度；top-3 均显示训练窗口为 `弱势回撤`、样本外窗口为 `高波动震荡`，全局 findings 为“市场状态从弱势回撤切换为高波动震荡”。

验证结论：该节点继续填补 `GAP-6 决策建议结构化` 中“样本外失败原因缺少市场状态证据”的缺口；系统仍保持阻断，不把失败策略升级为交易建议。下一步回到 `GAP-5 市场数据可靠性` 与事实集覆盖：provider warning 分类、coverage warning 去重、factset coverage 补齐。

进度 2026-05-30：完成 P4.34.17 Provider / Coverage Warning 分类与去重。`MarketBarCoverageItem` 新增 `warningCategory / warningSeverity / retryable / recommendedAction`，`MarketBarCoverageReport` 新增 `retryableWarmupSymbols / nonRetryableWarningSymbols / warningSummary`。全 A coverage 验收显示 total=`5524`、sufficient=`5447`、insufficient=`77`，其中 `retryableWarmupCount=0`、`nonRetryableWarningCount=77`、`limited_listing_history=61`、`stale_after_preheat=16`。`stock_screener_full_scan / strategy_tournament_run` 仅在存在 retryable 缺口时创建 `market_bar_cache_preheat`；preheat 默认只尝试 retryable 缺口，非 retryable warning 写入产物但不重复拉取。

验证结论：该节点填补 `GAP-5 市场数据可靠性` 中“provider/coverage warning 无分类、重复派生 warmup”的缺口。小样本 Operation `626ffe0b-dc47-49e1-9672-266c54d86b23` 验证 `nextAction=null`、无 warmup 子任务；预热 Operation `a9ccfe1a-e2e6-49ba-a66f-15b30d903628` 验证 attemptedSymbols=`0`、nonRetryableCoverageWarningCount=`1`。下一步进入 factset coverage 补齐，解决 `GAP-6` 中行业、市值、持仓事实覆盖不足。

进度 2026-05-30：完成 P4.34.18 Factset Coverage 市值补齐子任务接入。`stock_screener_full_scan / strategy_tournament_run` 新增 `factsetNextAction`；当行业覆盖已达标但市值覆盖不足时，返回 `NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP`，并由 `OperationService` 自动创建 queued `quote_list_market_cap_warmup` 子 Operation。新增 `市值补齐上限 / quoteListMarketCapWarmupLimit / FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT` 控制补齐规模。受控 40 标的 warmup 将 canonical fullCoverageCount 从 `1970` 提升到 `2005`；500 样本扫描 factset coverage 达到 `99.8%`；阈值 100% 验收自动创建子任务 `f1a53cbe-1cba-48cb-8d9d-6573f15fe0f4` 并完成；500 标的批量 warmup `4b154e59-17ea-4460-b566-b3e0b56ce392` 成功 `500/500`，canonical fullCoverageCount 从 `2010` 提升到 `2510`，全 A screener factset coverage 提升到 `45.44%`。

验证结论：该节点继续填补 `GAP-6 决策建议结构化` 中“行业/市值事实覆盖不足导致分组稳定性降级”的缺口，并把补齐动作接入 `GAP-7 异步任务骨架`。剩余 gap：全 A coverage 距离 80% gate 仍不足，下一步继续分批市值补齐或评审更高吞吐免费市值源。
