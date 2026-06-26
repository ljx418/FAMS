# 红利低波行业龙头策略开发与验收计划

更新时间：2026-06-25

## 1. 本阶段目标

本阶段目标是完成红利低波策略的文档、架构、开发计划和验收门槛收口，使后续自动化开发可以沿着同一套目标体验、目标架构、里程碑和出门条件推进。

当前策略状态：

```text
strategyId=dividend_low_vol_leader_v1
researchWorkflowReady=true
manualTradeDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

2026-06-24 交互式策略回测实现验收同步：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualDraftReady=true
formalReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
runtimeHealth=healthy
proxyEtfCoverage=ready
frontendRuntimeEvidence=passed
```

2026-06-25 正式交易级前置阶段校准：

```text
formalTradingPrerequisitesDocumented=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段把红利低波从“研究策略页面可用”继续校准为“可进入正式交易评审的前置材料完整”。开发和验收聚焦数据等级、模型有效性、人工草案、前端评审工作台、审计包和正式交易解锁清单；不释放正式交易动作。

正式交易 release 后续开发目标维护在：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
```

该文档把后续 release 拆为正式数据源、官方 total-return benchmark、formal validation、人工签核、paper/sandbox 执行隔离和 release gate 审计。红利低波当前仍只允许研究、观察、提醒、计划草案和人工计划草案。

最新阶段审计包：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T11-58-33-608Z/SUMMARY_FOR_GPT.md
```

允许动作：

```text
RESEARCH / OBSERVE / ALERT / PLAN_DRAFT / MANUAL_TRADE_DRAFT
```

禁止动作：

```text
ADD / REDUCE / AUTO_TRADE
```

本阶段完成后的目标体验：

1. 用户能从左侧菜单进入红利低波策略页面，快速理解这是研究/观察/人工计划草案系统。
2. 用户能看到每日数据状态、价格来源、交易日、新鲜度和异常阻断原因。
3. 用户能筛选全 A 候选、查看所有策略指标、理解入选/剔除原因。
4. 用户能查看买入观察区间、卖出观察区间、止损/失效条件，但不会误解为正式交易指令。
5. 用户能生成人工计划草案、记录人工验收、进入观察池和 pretrade check。
6. 用户能从审计包追溯数据源、价格审计、候选池、回测、validation 和 trade gate。

## 2. 当前基线

已具备：

- 红利低波独立前端页面。
- 全 A research-grade 候选池。
- 候选筛选、排序、指标解释。
- 龙头证据、分红事实、风险标记、拒绝原因分类。
- 买入/卖出观察区间与三年滚动策略回测。
- `priceAudit`：价格来源、交易日、新鲜度、价格/锚点错配阻断。
- 600887 价格错配回归测试。
- 每日收盘后 red-low-vol daily scan scheduler。
- manual draft、manual acceptance、watchlist、pretrade check 用户路径。
- GPT audit package 与 validation retest artifact。

2026-06-24 本阶段新增目标：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
dividendLowVolBasketBacktestReady=research_grade
manualTradeDraftReady=true
formalReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

红利低波不再只作为独立候选页面验收，还必须能作为组合策略回测中的一个策略篮子参与比较。用户应能从红利低波候选池进入策略回测视角，并与当前持仓、永久组合、全天候组合、本地真实样本组合和自定义权重组合对比收益、回撤、benchmark、分红贡献和数据缺口。

仍未完成：

- 正式 provider 字段覆盖。
- 官方 total-return benchmark 授权数据。
- formal-grade validation evidence。
- 正式 `ADD / REDUCE` 解锁。
- `AUTO_TRADE`。
- 红利低波篮子从真实候选快照进入组合回测；当前已接入快照读取、等权规则和 evidenceRefs，真实入篮数量已达 3 只，可进入研究级 completed 曲线。若后续刷新低于最小 3 只、行业/单票约束或 evidenceRefs 不完整，必须自动回退 insufficient。

## 3. 开发阶段与验收标准

### D1 文档与架构闭环

开发项：

- 更新 `DIVIDEND_LOW_VOL_PRD.md`。
- 更新 `DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md`。
- 更新 `TARGET_ARCHITECTURE_GAP.md`。
- 更新 `target-architecture-gap.drawio`。
- drawio 页数不超过 8 页，中文书写，包含目标体验、架构差异、开发计划、里程碑、验收门槛和出门条件。

验收标准：

- `node docs/read-drawio.mjs docs/target-architecture-gap.drawio` 可解析。
- drawio 不出现互相冲突的交易放行描述。
- Markdown 与 drawio 均明确 `ADD / REDUCE / AUTO_TRADE` 禁止。
- 文档能说明当前架构与目标架构关系：灰色已实现，黄色需增强，橘黄新增目标，红色交易边界。

### D2 真实数据研究链路稳定化

开发项：

- 免费数据源继续作为默认 research provider。
- Tushare 保留为可选升级功能，不阻断当前研究链路。
- 字段级 evidence、freshness、coverage、fallback audit 持续完善。
- 每日收盘后调度红利低波 full-A scan。
- 页面显示数据最新性和价格审计状态。

验收标准：

- 全 A 扫描覆盖率 `>=80%`。
- provider success rate `>=95%`。
- cache hit rate `>=80%`。
- best sample size `>=100`。
- 页面候选表无空白指标；无法获得的字段显示 `insufficient`、`not_applicable` 或 upgrade warning。
- 买卖区间必须展示 `tradeDate / sourceType / freshnessStatus / sanityStatus`。
- `freshnessStatus != fresh` 或 `sanityStatus != aligned` 时，区间显示“需刷新后重算”。

### D3 行业龙头与分红事实正式化

开发项：

- 龙头证据输出 `verified_industry_leader / leader_candidate / leader_partial / not_leader / insufficient`。
- 建仓计划草案要求 `verified_industry_leader`。
- 分红事实包含 TTM 股息率、三年平均股息率、DPS、支付率、special dividend、dividend cut、trap flag。
- 剔除原因按 `data_gap / hard_rule_failure / risk_flag / validation_blocker` 聚合。

验收标准：

- seed fallback 不得成为 verified leader。
- 没有营收、净利润、ROE 证据不得成为 verified leader。
- `dividend_trap_risk` 归为 risk flag 或硬规则失败。
- `max_drawdown_250d_above_35` 不归为 data gap。
- 用户能在前端看懂“为什么入选”和“为什么剔除”。

### D4 含分红回测与研究验证

开发项：

- 支持 price-only、cash dividend、reinvestment、费用、滑点、月度调仓、行业/单票上限。
- benchmark 缺正式 total return 时标记 proxy。
- validation 输出 OOS、walk-forward、参数敏感性、行业分组、市场状态、流动性分组。
- rolling strategy 输出胜率、收益、回撤、交易样本和不可用原因。

验收标准：

- `effectivePathCount>=30`。
- `industryGroupCount>=3`。
- `walkForwardWindows>=6`。
- `walkForwardPassedWindows / walkForwardWindows >=60%`。
- 参数敏感性和分组稳定性不得是 `insufficient` 才能进入更高 gate。
- proxy benchmark 不得解锁 formal validation。
- rolling backtest 不能解锁正式交易动作。

### D5 人工交易计划草案用户路径

开发项：

- 用户从候选池查看 top candidates。
- 生成 manual trade draft。
- 查看 manual acceptance review。
- 记录 manual decision。
- watchlist 与 pretrade check 可追溯。
- 持仓、行业暴露、单票上限进入草案约束。

验收标准：

- 页面明确显示“研究/观察/计划草案”。
- `formalTargetWeight=0`。
- `canCreateOrder=false`。
- 已超单票或行业上限时不生成建仓草案。
- validation 未通过时不得出现正式买入、加仓、减仓、卖出指令文案。
- 用户能完成：候选查看 -> 草案生成 -> 人工验收 -> 观察池 -> pretrade check。

### D6 正式交易评审前置

开发项：

- 正式 provider 接入或等价可信数据源完成字段级覆盖。
- 官方 total-return benchmark 接入。
- 交易约束完整覆盖涨跌停、停牌、退市风险。
- 人工验收和审计包复核完成。
- formal validation 全部 gate 通过后，才允许进入“正式交易评审”讨论。

验收标准：

- 所有 formal gates passed。
- 人工确认允许进入正式交易评审。
- 即使正式交易评审通过，`AUTO_TRADE` 仍保持禁止，除非另立独立项目和人工授权。

### D8 正式交易级前置文档与审计升级

开发项：

- 对齐红利低波 PRD、组合策略回测 PRD、目标架构、里程碑、验收门槛和 drawio。
- 明确 `formalReviewReady=true` 只代表可进入正式评审，不代表正式交易解锁。
- 为红利低波联动组合回测补充数据等级、模型有效性、人工草案和阻断项的验收口径。
- drawio 维持不超过 8 页，使用灰色表示已实现、黄色表示需修改、橘黄表示新增，红色表示交易边界。

验收标准：

- 文档中当前状态统一为 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`。
- 用户能从文档理解：已能研究筛选、组合回测和出人工计划草案；仍不能下单或自动交易。
- 每个正式交易级前置开发项都有用户体验目标、技术产物和验收标准。
- drawio 能完整表达目标体验、当前/目标架构关系、开发计划、里程碑、验收门槛、出门条件和关键用户路径。

### D7 交互式策略回测联动

开发项：

- 红利低波候选快照输出 `strategyVersion / tradeDate / selectionRules / evidenceRefs`。
- 红利低波篮子可进入组合策略回测，权重规则可解释。
- 策略回测页可展示红利低波篮子与永久组合、全天候、当前持仓、自定义组合的多曲线对比。
- 回测结果展示收益曲线、回撤曲线、benchmarkReturn、excessReturn、dividendContribution、dataCoverage 和 blockedReasons。
- runtime health、benchmark proxy、价格 stale、priceAudit mismatch 或 validation insufficient 时，前端必须显示阻断原因。

验收标准：

- 用户能完成：红利低波页面筛选候选 -> 进入策略回测 -> 选择近 1 年或近 3 年 -> 运行 -> 查看多组合曲线 -> 查看数据缺口 -> 返回人工计划草案。
- 红利低波篮子缺少候选快照、真实入篮数量低于最小 3 只、权重规则或 evidenceRefs 时，不允许进入 completed 状态。
- 红利低波篮子回测不得解锁正式 `ADD / REDUCE`。
- `AUTO_TRADE` 继续禁止。
- 端到端验收报告必须包含红利低波页面截图、策略回测页面截图、任务中心 artifact 截图和 trade gate 结果。

## 4. 项目里程碑

| 里程碑 | 目标体验 | 出门条件 | 当前状态 |
| --- | --- | --- | --- |
| M0 Research Evidence Ready | 用户能筛选候选、看懂指标和数据证据 | 审计包完整、候选池可解释、研究验证 passed | 已基本完成 |
| M1 Manual Draft Ready | 用户能生成人工计划草案并复核 | manual acceptance 可记录、不能创建订单 | 已基本完成 |
| M2 Documentation Gate Ready | 人类能通过文档和 drawio 理解目标体验与架构 | PRD、计划、gap、drawio 更新并可解析 | 本阶段目标 |
| M3 Daily Freshness Gate Ready | 用户能看到每日数据状态和价格异常阻断 | daily scan、priceAudit、前端展示、回归测试通过 | 已实现，需文档收口 |
| M4 Formal Data Upgrade Ready | 正式 provider 与 benchmark 可评审 | 字段级 evidence、freshness、coverage 达标 | 未完成 |
| M5 Formal Validation Review | 进入正式交易 gate 评审 | OOS、walk-forward、参数、分组、交易约束全部通过 | 未完成 |
| M6 Interactive Strategy Backtest Ready | 用户可交互式比较红利低波、永久组合、全天候、当前持仓和自定义组合 | 多曲线、指标、缺口、artifact、非交易 gate 全部可见 | 本阶段目标 |
| M7 Formal Trading Review Prerequisites | 正式交易级评审前置证据齐全但不自动放行 | runtime/provider/benchmark/tradeability/validation/manual review artifact 完整 | 前置文档完成，formal review 未解锁 |
| M8 Formal Trading Release Docs Ready | 后续正式交易 release 可开发、可验收、可审计 | release PRD、目标架构、drawio、验收门槛和审计清单一致 | 本轮文档目标 |
| M9 Paper/Sandbox Trading Review | 模拟执行路径隔离验证 | paper/sandbox 不影响真实持仓，订单 gate 可审计 | 后续开发 |

## 5. 验收命令

文档验收：

```bash
cd /mnt/c/workspace/financial-asset-manager
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
```

后端验收：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:dividend-low-vol-api
npm run test:dividend-low-vol-rolling-backtest
npm run test:factset-refresh-scheduler
npm run test:production-readiness
npm run test:trade-action-readiness
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
npm run test:portfolio-backtest-frontend-runtime
```

前端验收：

```bash
cd frontend
npm run build
```

审计验收：

```bash
cd backend
npm run run:dividend-low-vol-audit-package
npm run run:interactive-strategy-backtest-audit-package
```

## 6. 本阶段出门条件

可以出门为：

```text
documentation_and_research_workflow_ready
manual_trade_draft_ready
daily_freshness_gate_documented
formal_trading_locked
auto_trade_locked
```

当前实现验收结果：

```text
interactive_strategy_backtest_ready=true
research_grade_strategy_comparison_ready=true
manual_trade_draft_ready=true
runtime_health_gate_consistent=true
frontend_runtime_evidence=passed
formal_review_ready=false
formal_trading_locked=true
auto_trade_locked=true
```

必须满足：

- 文档与架构图完整反映红利低波策略规格、功能、架构、gap、里程碑、验收门槛。
- drawio 页数不超过 8 页，中文书写，可被解析。
- 前后端用户路径能完成研究候选到人工草案。
- 价格审计、每日扫描、免费源边界、异常阻断均写入文档。
- 审计包能证明策略没有绕过交易 gate。
- `ADD / REDUCE / AUTO_TRADE` 仍被禁止。

不能出门为：

```text
formal_trade_action_ready
auto_trade_ready
```

除非后续正式 provider、正式 benchmark、交易约束和 formal validation 全部通过。

## 7. 自动化开发准入判断

当前判断：

```text
documentationAutomationReady=true
researchWorkflowAutomationReady=true
manualDraftWorkflowAutomationReady=true
dailyFreshnessGateAutomationReady=true
formalTradingAutomationReady=false
autoTradeAutomationReady=false
```

可以自动执行：

- D1 文档与架构更新。
- D2 免费数据源研究链路增强。
- D3 龙头、分红事实和拒绝原因分类增强。
- D4 research-grade 回测、验证诊断、proxy benchmark 明示和审计包生成。
- D5 人工草案路径、前端可见性、交易 gate contract 和端到端用户路径验证。

不能自动完成：

- D6 中依赖正式 provider 凭证、正式数据授权、官方 total-return benchmark 授权数据和真实人工验收结论的部分。
- 任意正式 `ADD / REDUCE` 解锁。
- 任意 `AUTO_TRADE`。

自动化继续条件：

- 每次自动化开发后必须执行 drawio 解析、后端 TypeScript、相关红利低波测试、production readiness、trade action readiness 和前端 build。
- 任一验收失败时，停止进入下一阶段，先补审计产物和失败归因。
- 若缺口来自外部数据授权或人工验收，不得伪造通过；必须以 blocker 写入 audit package 和本文档。

## 8. 文档支撑度自评与防偏移检查

当前文档对本阶段开发的支撑结论：

```text
stageDocumentationCoverage=complete_for_D1_to_D5
formalTradingCoverage=prerequisite_only_for_D6
overPromiseRisk=controlled
```

已完整支撑的开发内容：

- D1 文档与架构闭环：PRD、目标架构、gap、里程碑、验收门槛和 drawio 已形成同一套口径。
- D2 真实数据研究链路：免费数据源、日更调度、价格新鲜度、coverage、fallback 和异常阻断均有目标体验与验收标准。
- D3 龙头与分红事实：行业龙头状态、分红事实集、风险标记、拒绝原因分类和 evidenceRefs 均有规格约束。
- D4 研究级回测与验证：含分红回测、滚动策略、proxy benchmark 明示、validation insufficient 阻断和审计产物均有验收口径。
- D5 人工交易计划草案：候选查看、草案生成、人工验收、观察池、pretrade check、`formalTargetWeight=0` 和 `canCreateOrder=false` 均有用户路径和验收标准。

仅支撑前置开发、不能自动完成的内容：

- D6 正式交易评审：文档只定义正式 provider、官方 total-return benchmark、完整交易约束、formal validation 和人工复核的进入条件，不承诺本阶段完成。
- 正式 `ADD / REDUCE`：只能在后续独立 formal validation gate 与人工复核通过后评审，不能由当前文档或自动化开发直接解锁。
- `AUTO_TRADE`：不属于本阶段目标，即使未来正式交易评审通过，也必须另立独立授权项目。
- 免费数据源实时性：只能承诺自动拉取、freshness 校验、异常阻断和刷新提示，不能承诺 100% 每日最新。

开发方向防偏移检查：

- 若新增功能不能提升“候选可解释、数据可追溯、价格可信、人工草案可复核、交易 gate 不误放”中的至少一项，应暂缓进入本阶段。
- 若实现内容会让用户误以为系统已经可以正式买入、加仓、减仓、卖出或自动交易，应改为研究提醒、观察状态、人工草案或阻断提示。
- 若正式数据、正式 benchmark、人工验收或监管合规结论缺失，不得把状态从 `researchWorkflowReady` 升级为 `formalTradeActionReady`。
- 若前端展示出现空白指标，应改为数值、状态、`insufficient`、`stale`、`unknown` 或“需刷新后重算”，不得静默留空。

## 9. 本阶段开发字段与验收索引

后续开发和自动化验收必须把红利低波、组合回测、任务中心和审计包对齐到
同一组阶段状态：

```text
portfolioBacktestFormalReviewReady=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
manualTradeDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

必须实现和验证的公共字段：

```text
dataGrade
modelEffectiveness
modelEffectivenessStatus
manualPlanDraft
formalTradingUnlockChecklist
formalTradingBlockers
allowedActions=RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT / MANUAL_TRADE_DRAFT
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

必要审计产物：

```text
09_data_grade_audit.json
10_model_effectiveness_audit.json
11_manual_plan_draft_audit.json
12_formal_trading_unlock_blockers.json
acceptance-report.html
SUMMARY_FOR_GPT.md
```

验收结论只能写为“正式交易前置评审 ready”或“人工交易计划草案 ready”；
不得写为与 `formalTradingUnlocked=false` 或 `autoTradeUnlocked=false` 相反的结论。
