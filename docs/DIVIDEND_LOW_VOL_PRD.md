# 红利低波行业龙头策略 PRD

更新时间：2026-06-26

## 1. 产品定位

`dividend_low_vol_leader_v1` 是 FAMS 的研究型策略模块，用于从全 A 样本中筛选股息率较高、分红可持续、行业地位较强、波动相对较低、估值不过热的股票，并输出候选池、低位观察、买入观察区间、高位观察、卖出观察区间、风险退出提醒和人工交易计划草案。

当前产品状态：

```text
researchWorkflowReady=true
manualTradeDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

2026-06-24 交互式策略回测阶段同步：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
manualDraftReady=true
formalReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

2026-06-25 正式交易级前置阶段校准：

```text
formalTradingPrerequisitesDocumented=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本阶段的新增目标不是开放正式交易，而是把“红利低波策略 + 组合策略回测 + 人工交易计划草案”整理成正式交易评审前置材料完整的产品路径。用户应能看懂候选、曲线、数据等级、模型有效性、人工草案和阻断原因；系统仍不得创建订单、不得输出正式 `ADD / REDUCE`，也不得开放 `AUTO_TRADE`。

2026-06-25 正式交易 release 文档校准：

```text
formalTradingReleaseDocsReady=true
longHorizonRealDataBacktestReady=true
formalTradingEligible=false
orderCreateAllowed=false
canCreateOrder=false
```

正式交易 release 需要另行满足正式 provider、官方或可信 total-return benchmark、formal validation、人工签核、paper/sandbox 执行隔离和 release gate 审计。本 PRD 当前只把这些能力定义为后续开发目标，不把红利低波候选、买卖观察区间或人工计划草案升级为正式交易动作。

红利低波篮子进入长周期组合回测时，必须按 1 年、3 年、5 年和自定义区间分别输出真实行情、分红、交易约束、benchmark 和模型验证证据。当前审计支持声明 `longHorizonRealDataBacktestReady=true`，但该声明只表示 formal-review-ready，不表示正式交易 release。

当前文档开发主线已经从“补齐长周期 replay”切换为“正式交易 release 前置评审”：红利低波策略负责提供候选篮子、买卖观察区间、分红/质量/低波/估值证据、组合回测输入和模型有效性证据；后续 FTR-1 到 FTR-6 需要分别关闭正式数据治理、可信 total-return benchmark、formal validation、人工签核、执行隔离和 release gate。任一 gate 未通过时，红利低波页面只能展示研究结论、观察区间和人工计划草案。

当前状态源：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/15_release_data_governance_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-12-17-124Z/03_frontend_runtime_and_operation_audit.json
```

该审计包已证明文档和前置审计路径可进入 formal review，但 release gate 仍 blocked。

红利低波进入组合回测和 release 前置评审时，字段级数据治理必须至少展示 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / coverageStatus / crossCheckStatus / evidenceRefs`。最新审计包已补齐 `asOfDate`，但正式 provider、官方 benchmark、formal validation 和人工签核仍未完成，因此只能保持研究、观察和人工计划草案。

当前 release gate 相关状态：

```text
executionIsolationAudit=ready_for_review
releaseGateAudit=blocked
dataGovernanceAudit=blocked
benchmarkQualificationAudit=review_ready
formalValidationAudit=warning
manualSignoffAudit=missing
```

红利低波策略在正式交易 release 中的职责是提供可审计的候选、观察区间、回测输入和模型有效性证据；它不能单独解锁正式 `ADD / REDUCE / ORDER_CREATE`。

红利低波策略可以作为组合回测目标架构中的策略篮子来源；当前已接入真实 `DividendLowVolDaily` 候选快照读取、等权 v1、tradeDate、selectionRules 和 evidenceRefs。若真实入篮数量低于最小 3 只、行业/单票约束不足或 evidenceRefs 不完整，`dividend_low_vol_basket` 必须保持 insufficient，不得用本地样本组合替代红利低波篮子。

允许动作：

```text
RESEARCH / OBSERVE / ALERT / PLAN_DRAFT / MANUAL_TRADE_DRAFT
```

禁止动作：

```text
ADD / REDUCE / AUTO_TRADE
```

FAMS 当前不能创建订单，不能绕过人工复核，不能把研究提醒、买入观察区间、卖出观察区间或人工计划草案包装成正式交易指令。

## 2. 本阶段目标

本阶段目标是把红利低波策略从“功能已实现”整理为“人类可理解、文档可驱动、自动化可继续开发、验收可复现”的研究与人工计划草案系统。

目标体验：

1. 用户从左侧菜单进入“红利低波策略”。
2. 页面顶部明确显示研究模式、禁止动作、最新数据状态。
3. 用户看到全 A 候选池，并能按行业、等级、综合分、股息率、低波分、质量分、估值分、低位分、高位分、数据状态筛选排序。
4. 用户打开单个候选时，能看到入选理由、剔除原因、行业龙头证据、分红事实、风险标记、数据来源和证据引用。
5. 用户查看买入/卖出观察区间时，能看到价格来源、交易日期、新鲜度、`priceAudit` 状态、失效条件和禁止正式交易动作提示。
6. 如果价格过期、来源未知或价格与均线锚点明显错配，系统显示“需刷新后重算”，不展示有效观察区间。
7. 用户可以生成人工计划草案、人工验收记录、观察池和 pretrade check，但系统仍保持 `formalTargetWeight=0`、`canCreateOrder=false`。
8. 用户能从审计包和任务中心追溯每日扫描、候选结果、回测、validation、manual acceptance 和 trade gate。

非本阶段目标：

1. 不放行正式 `ADD / REDUCE`。
2. 不开放 `AUTO_TRADE`。
3. 不承诺免费数据源每日 100% 最新。
4. 不把 proxy benchmark 说成 formal benchmark。
5. 不把 seed fallback 说成 verified industry leader。
6. 不用测试绕过 `validation_evidence`。

正式交易级前置阶段的非目标：

1. 不把 `tradeActionReady=true` 解释为可自动交易。
2. 不把免费源或 research proxy benchmark 解释为官方授权 benchmark。
3. 不把 formal-review-ready 解释为 formal-trading-ready。
4. 不在人工复核、正式 provider、官方 benchmark 和模型有效性验证完成前释放正式交易动作。

正式交易 release 阶段的非目标：

1. 不通过文档更新自动把 `formalTradingUnlocked` 改为 true。
2. 不把 paper trading 或 sandbox 结果解释为实盘成交。
3. 不在订单执行隔离评审前开放 `ORDER_CREATE`。
4. 不把 `AUTO_TRADE` 纳入本阶段 release 范围。

## 3. 用户角色与场景

### 3.1 研究用户

目标：快速筛出高股息、低波动、行业地位较强且数据证据充分的股票。

关键路径：

```text
进入红利低波策略 -> 查看数据状态 -> 筛选行业/分数 -> 查看候选详情 -> 加入观察或生成草案
```

### 3.2 持仓用户

目标：结合已有持仓判断是否需要观察低位、停止加仓、高位复核或风险退出。

关键路径：

```text
进入持仓/组合 -> 红利低波匹配持仓 -> 查看当前仓位/行业暴露 -> 查看提醒 -> 人工复核
```

### 3.3 审计用户

目标：判断系统结论是否有数据血缘、是否绕过交易 gate、是否满足当前阶段出门条件。

关键路径：

```text
打开任务中心/审计包 -> 查看 runtime/data/provider/priceAudit/validation/tradeGate -> 输出复核结论
```

## 4. 策略硬规则

候选池准入必须满足：

- `assetType=stock`
- 非 ST、非退市整理、非长期停牌
- 上市时间不少于 3 年
- TTM 股息率 `>= 4%`
- 三年平均股息率 `>= 3.5%`
- 最近三年连续现金分红
- 行业龙头证据至少达到 `leader_candidate`
- 建仓计划草案必须达到 `verified_industry_leader`
- 分红支付率在安全区间，极端高支付率直接剔除
- 经营现金流或金融行业替代指标可以支持分红
- 低波动、最大回撤、ATR、Beta 不触发硬性风险剔除
- `DividendTrapFlag=false`
- `EvidenceQualityScore>=60`

硬规则失败必须归入：

```text
data_gap / hard_rule_failure / risk_flag / validation_blocker
```

不得把 `dividend_trap_risk`、`max_drawdown_250d_above_35`、`dps_consecutive_decline` 伪装成普通数据缺口。

## 5. 评分模型

总研究分：

```text
TotalResearchScore =
  0.20 * LeaderScore
+ 0.20 * DividendScore
+ 0.20 * DividendQualityScore
+ 0.15 * LowVolScore
+ 0.10 * ValuationScore
+ 0.10 * TimingScore
+ 0.05 * EvidenceQualityScore
- 0.20 * FinancialRiskPenalty
```

排序分：

```text
EvidenceAdjustedScore =
  TotalResearchScore
  * EvidenceMultiplier
  * ValidationMultiplierResearch
  * TradeabilityMultiplier
```

正式交易仓位在当前阶段始终为 0；研究计划仓位只作为人工复核草案输入。

## 6. 功能规格

### 6.1 后端能力

- 红利事实集：股息率、三年平均股息率、连续分红年数、DPS、支付率、分红风险。
- 行业龙头证据：市值排名、营收排名、净利润排名、ROE 分位、流动性排名、行业归属与 cross-check。
- 策略评分：红利吸引力、分红质量、低波动、估值、时机、风险、证据质量、综合分。
- 提醒：低位观察、建仓计划草案、加仓观察、高位观察、减仓提醒、退出风险。
- 交易区间模型：
  - `dividend_low_vol_yield_ma_reversion_v1`：股息率历史分位 + MA120/MA250 支撑/压力。
  - `dividend_low_vol_bollinger_reversion_v1`：布林下轨/中上轨均值回归，作为实验对照模型。
- `priceAudit`：
  - `currentPrice`
  - `tradeDate`
  - `sourceType`
  - `freshnessStatus`
  - `sanityStatus`
  - `priceToAnchorRatio`
  - `warnings`
- 回测：价格收益、分红贡献、资本利得、费用拖累、benchmark、超额收益、交易约束。
- 三年滚动回测：逐笔交易样本、胜率、总收益、最大回撤、股息贡献、成本拖累和 benchmark 对比。
- 验证：OOS、walk-forward、参数敏感性、行业分组、市场状态分组、流动性分组。
- 审计包：候选池、拒绝原因、龙头证据、分红事实、数据验证、价格审计、回测、validation、交易 gate、前端可见性、开发完成度。
- 调度：每日收盘后提交红利低波全 A scan，使用 idempotency key 防重复。

### 6.2 前端能力

- 左侧菜单独立页面：红利低波策略。
- 固定展示研究模式 banner 和禁止动作。
- 候选表展示所有策略指标，不隐藏数据状态。
- 支持行业、等级、综合分、股息率、低波分、质量分、估值分、低位分、高位分筛选排序。
- 拒绝原因按 `data_gap / hard_rule_failure / risk_flag / validation_blocker` 分组。
- 龙头证据、分红事实、回测诊断、validation matrix、manual acceptance 状态可见。
- 买卖区间区块显示价格来源、交易日、新鲜度、异常原因、失效条件。
- 建仓计划草案显示人工复核、仓位上限、失效条件和 formal action blocked。

## 7. 数据源策略

当前默认使用免费数据源形成 research-grade 证据闭环。Tushare Pro 保留为后续正式 provider 升级，不阻断当前研究态使用。

免费数据源必须满足：

- 字段级 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / evidenceRefs / coverageStatus`
- provider timeout、empty reply、stale cache 必须显式记录
- fallback provider 不能升级为 `verified_industry_leader`
- 正式数据缺失时只能显示 `insufficient` 或 optional upgrade warning
- 每日收盘扫描不能承诺 100% 最新，只能通过 freshness gate 和异常阻断保护用户体验

正式交易 release 数据要求维护在：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
```

红利低波进入正式交易 release 前，至少需要补齐：

- 正式 provider 或等价可信数据源的字段级 evidence。
- 官方或可信 total-return benchmark。
- 行情、分红、财务、行业、交易约束的 freshness 和 coverage 审计。
- OOS、walk-forward、参数敏感性、行业/市场/流动性分组稳定性。
- 数据、模型、风控、合规和最终 release 人工签核。
- Paper trading / sandbox 执行隔离验证。

数据最新性口径：

```text
fresh：最近交易日或验收窗口内可用
stale：超过 freshness 窗口
unknown：无法确认交易日或来源
price_zone_mismatch：价格与均线/区间锚点明显错配
```

当 `freshnessStatus != fresh` 或 `sanityStatus != aligned` 时，买卖观察区间不得显示为可用。

## 8. 验收状态

截至 2026-06-24：

- 全 A 研究链路已可运行。
- v2 研究验证状态为 `research_candidate_passed`。
- 策略 evidence export 状态为 `ready_for_manual_trade_draft`。
- 买入/卖出观察区间、三年滚动策略回测、价格审计和前端可见性已接入。
- 600887 价格错配回归已覆盖：25 元事实价格不得生成 7 元观察区间。
- 每日收盘后红利低波 scan 已接入 scheduler，使用 daily idempotency key 防重复。
- 审计包显示 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`。
- 组合回测页面已达到 research-grade：支持多策略曲线、benchmark、分红贡献、成本拖累、Operation artifact 和前端 runtime 验收。
- 红利低波候选篮子已进入组合回测输入构建；通过免费源扩容后当前真实入篮数量为 3/3，入篮标的为 `000513 / 601398 / 000333`，可在研究级组合回测中展示 completed 曲线。
- 红利低波独立策略的 formal validation 仍未解锁正式交易动作；`tradeActionReadiness=true` 只能解释为 `ready_for_manual_trade_draft`。

2026-06-25 文档校准后的出门状态：

```text
researchReady=yes
manualDraftReady=yes_if_gate_evidence_ready
formalReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

该状态表示用户能完成研究筛选、策略回测、买卖观察区间查看、人工计划草案和审计追溯；不表示策略已经具备正式买入、卖出、下单或自动交易能力。

## 8.1 组合策略回测联动

红利低波策略后续需要进入组合策略回测视角，而不是只看单只候选或单一策略曲线。组合回测能力的目标是让用户比较：

- 红利低波候选篮子。
- 当前真实持仓。
- 永久组合。
- 全天候组合。
- 用户自定义权重组合。
- 本地真实行情样本组合。

当前组合回测专项已达到 research-grade：

- `/backtest` 页面可以展示多组合曲线。
- 默认路径可用本地真实 `market_bar_canonical` 生成 3 条 completed 策略曲线。
- `local_equal_weight_20` 可作为研究 benchmark，显示 benchmarkReturn 和 excessReturn。
- 永久组合和全天候组合已有研究级代理行情路径；当 ETF 代理行情覆盖满足时可返回 completed 曲线，缺 ETF 数据时仍显示 insufficient，且不等同于正式 total-return benchmark 验证。
- 当前持仓组合因为 open positions 为 0 继续显示 insufficient。
- 红利低波篮子当前可用真实候选快照返回 completed 曲线，但回测结果为研究级，benchmark 仍包含 price index / research proxy，不能用于正式交易放行。

红利低波组合进入组合回测前必须满足：

- 候选快照有明确 tradeDate、strategyVersion、selectionRules 和 evidenceRefs。
- 组合权重规则可解释，例如等权、分数加权、行业上限、单票上限。
- 分红总回报可区分 price-only、dividend cash、dividend reinvest。
- benchmark 状态必须区分 formal total-return、price index 和 research proxy。
- 任一数据缺口不能被填成 0 或静默跳过，必须进入 `blockedReasons / warnings / dataCoverage`。
- 红利低波篮子缺真实候选快照、真实入篮数量低于最小 3 只或 evidenceRefs 不完整时，前端必须显示 insufficient / blockedReasons，不能显示 completed 曲线。

组合回测不能改变红利低波交易边界：

```text
allowedActions = RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT
prohibitedActions = ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

即使组合回测研究结果较好，也必须通过正式 validation evidence 和人工复核，才可能进入人工交易计划草案；自动交易仍不开放。

## 8.2 本阶段正式交易级前置联动

2026-06-24 起，红利低波策略纳入“交互式策略回测与正式交易级前置阶段”。这不会改变红利低波的交易边界，但会改变用户体验目标：用户不仅能看单只红利候选，还能把红利低波候选篮子放入策略回测页面，与当前持仓、永久组合、全天候组合、本地真实样本组合和自定义权重组合比较。

完成后的红利低波联动体验：

1. 在红利低波页面筛选候选，查看行业、股息率、分红质量、低波、估值、低位/高位、priceAudit 和 evidenceRefs。
2. 选择红利低波篮子进入策略回测视角。
3. 在策略回测页设置起止时间、再平衡频率、分红模式、费用、滑点和 benchmark。
4. 查看红利低波篮子与其他组合的收益曲线、回撤曲线、benchmarkReturn、excessReturn、dividendContribution 和 blockedReasons。
5. 若结果满足人工计划草案 gate，系统只生成人工计划草案；仍不得创建订单或输出正式买卖指令。

红利低波进入策略回测必须满足：

- 候选快照包含 `strategyVersion / tradeDate / selectionRules / evidenceRefs`。
- 权重规则可解释，例如等权、分数加权、行业上限、单票上限。
- `priceAudit` 必须为 fresh/aligned，或前端显示“需刷新后重算”。
- benchmark 状态必须明确区分 `formal_total_return / price_index / research_proxy`。
- 缺数据时进入 `blockedReasons`，不得把缺失指标填 0。

本阶段出门状态：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
dividendLowVolBasketBacktestReady=research_grade_completed
manualTradeDraftReady=true
formalReviewReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

说明：`dividendLowVolBasketBacktestReady=research_grade_completed` 表示已从真实候选快照构建红利低波篮子并达到最小 3 只入篮要求；该结论只代表研究级组合回测可用，不代表 formal validation 或正式交易动作可用。

## 9. 自动化开发边界

当前可以继续自动化执行：

- 文档、drawio、审计包、验收脚本和前端可见性增强。
- 免费数据源 research-grade ingestion、coverage、freshness、evidenceRefs 和 fallback audit。
- 红利低波候选池、指标展示、筛选排序、拒绝原因分类、人工草案路径和交易 gate contract。
- research validation、proxy benchmark 标记、失败归因和 audit package 生成。

当前不能全自动完成：

- 正式 provider 凭证、权限和商业数据授权。
- 官方 total-return benchmark 授权数据接入。
- 真实人工验收结论。
- 正式 `ADD / REDUCE` 交易动作解锁。
- `AUTO_TRADE`。

自动化准入结论：

```text
automationStatus = documentation_and_research_workflow_ready
fullAutomationStatus = blocked_by_external_provider_and_manual_review
```

## 10. 本阶段统一字段索引

红利低波策略进入交互式组合回测和正式交易前置评审后，产品、后端、
前端和审计包必须使用同一组字段，避免把研究级结论误解为正式交易放行。

```text
portfolioBacktestFormalReviewReady=true
portfolioStrategyBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
manualTradeDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

组合回测和红利低波联动页面必须展示或传递：

```text
readinessSummary
dataGrade
modelEffectiveness
modelEffectivenessStatus
manualPlanDraft
formalTradingUnlockChecklist
formalTradingBlockers
allowedActions=RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT / MANUAL_TRADE_DRAFT
prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

`readinessSummary` 统一解释研究、正式评审前置、人工计划草案、正式交易资格和交易解锁状态：

```text
researchReady
formalReviewReady
manualDraftReady
formalTradingEligible
formalTradingUnlocked=false
autoTradeUnlocked=false
```

这些字段只用于解释数据可信度、模型有效性、人工草案和阻断原因，不允许
作为自动下单、自动再平衡或正式 ADD / REDUCE 的触发条件。

状态 alias 规则：

```text
manualDraftReady == manualTradeDraftReady == manualTradePlanDraftReviewReady
manual_trade_plan_draft_review_ready 是 manualTradePlanDraftReviewReady 的机器可读别名
manualTradePlanDraftReviewReady != formalTradingUnlocked
portfolioBacktestFormalReviewReady != formalTradingUnlocked
```

`tradeActionReadiness=true` 或测试 passed 在当前阶段只能解释为：

```text
tradeActionReadinessPassedMeaning = gate_contract_passed_or_manual_draft_ready
formalTradingUnlocked = false
orderCreateAllowed = false
canCreateOrder = false
```

任何文档、前端文案或审计包不得把 `manualDraftReady`、`manualTradeDraftReady`、`manualTradePlanDraftReviewReady`、`portfolioBacktestFormalReviewReady` 解释为正式交易、正式下单或自动交易 ready。

## 11. 本阶段文档开发收口要求

本阶段文档只服务于“正式交易前置评审 ready”，不服务于交易执行。PRD、目标架构、阶段计划和 drawio 必须使用同一套实现实体和验收口径，避免开发者把抽象目标误解为新增交易能力。

### 11.1 代码实体映射

红利低波页面与组合回测页面必须在文档中明确绑定到以下实现实体：

| 层级 | 实体 | 本阶段职责 |
| --- | --- | --- |
| 前端页面 | `DividendLowVol.tsx` | 展示候选、筛选排序、指标解释、买卖观察区间、滚动回测、人工计划草案入口和交易锁定提示。 |
| 前端页面 | `Backtest.tsx` | 展示多策略回测、收益曲线、回撤、数据等级、模型有效性、人工复核记录和正式交易阻断原因。 |
| 前端页面 | `Operations.tsx` | 展示 Operation 与 artifactRefs，支撑审计用户追溯扫描、回测和验收报告。 |
| 后端 API | `/api/v1/strategy/dividend-low-vol/*` | 提供候选池、交易区间、滚动回测、FIVD-R adapter、manual acceptance 和 readiness 数据。 |
| 后端 API | `/api/v1/portfolio-backtest/*` | 提供策略模板、组合回测运行、Operation artifact 和人工复核审计记录。 |
| 红利低波服务 | `dividendLowVolStrategyService` | 生成候选池、拒绝原因、评分、disposition 和 evidenceRefs。 |
| 红利低波服务 | `dividendLowVolTradingZoneService` | 生成买入/卖出观察区间、价格审计、区间失效条件和滚动策略结果。 |
| 组合回测服务 | `PortfolioBacktestInputBuilder` | 将红利低波篮子、当前持仓、永久组合、全天候和自定义组合转换为回测输入。 |
| 组合回测服务 | `PortfolioBacktestEngine` | 输出 equityCurve、drawdown、metrics、dataGrade、modelEffectiveness 和 readinessSummary。 |
| 审计服务 | `portfolioBacktestReviewService` | 只保存人工复核审计，不创建订单，不改变交易锁定状态。 |

### 11.2 用户体验验收门槛

完成本阶段文档后，后续开发和验收必须能回答以下用户问题：

- 我现在看到的是研究候选、观察区间还是正式买卖指令。
- 这只红利股为什么入选、为什么被剔除、缺少什么数据。
- 当前价格、均线和买卖观察区间的数据日期是否可信。
- 红利低波篮子与其他组合在同一区间的收益、回撤、分红贡献和 benchmark 表现如何。
- 哪些数据来自免费源、哪些是 proxy、哪些不足以进入正式交易。
- 人工计划草案为什么不能直接创建订单。
- 系统为什么仍保持 `formalTradingUnlocked=false` 和 `autoTradeUnlocked=false`。

### 11.3 文档禁止事项

以下表述不得出现在 PRD、架构图、阶段计划或审计摘要中：

- 把 `manualTradeDraftReady` 写成正式买入、卖出或下单 ready。
- 把 `portfolioBacktestFormalReviewReady` 写成正式交易 ready。
- 把免费源 total-return 或 research proxy 写成官方授权 benchmark。
- 把 `tradeActionReadiness=true` 写成交易动作已经放行。
- 把 `formalTargetWeight=0` 之外的正式仓位写入当前阶段出门条件。
