# 组合策略回测正式交易级前置开发及验收计划

更新时间：2026-06-25

## 1. 阶段定位

本计划承接 `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`。当前组合策略回测已达到：

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
portfolioBacktestFormalReviewReady=true
manualDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本文件定义的是正式交易前置阶段。正式交易 release 的下一阶段开发及验收计划维护在：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
```

该 release 计划只有在正式 provider、官方或可信 total-return benchmark、formal validation、人工签核、paper/sandbox 执行隔离和 release gate 审计准备完成后才可进入实现；当前仍保持 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`。

下一阶段目标不是立即放行交易，而是把系统从“组合回测正式评审 ready”推进到“正式交易级解锁前置材料完整”。完成后，项目应能让人工审核者清楚回答：

1. 数据是否足够可信。
2. 回测是否可复现。
3. 模型是否在样本外和不同市场环境中有效。
4. 人工交易计划草案是否遵守仓位、行业、流动性和交易约束。
5. 是否仍禁止自动交易。

本阶段完成后的目标体验：

1. 用户进入“策略回测”页面，能看到每条策略的数据等级、模型有效性、benchmark 状态和交易 gate。
2. 用户选择红利低波、永久组合、全天候、当前持仓或自定义组合后，能查看收益曲线、回撤曲线、关键指标和阻断原因。
3. 用户能从回测结果生成人工计划草案，但页面明确显示草案待人工复核，不构成交易指令。
4. 审计用户能通过一个审计包判断：数据是否可信、模型是否有效、草案是否合规、正式交易为什么仍未解锁。

## 2. 非目标

本阶段不自动完成以下事项：

```text
formal ADD
formal REDUCE
ORDER_CREATE
AUTO_TRADE
自动再平衡执行
把免费源 benchmark 伪装成官方授权 benchmark
把 tradeActionReady 解释成策略可自动交易
```

## 3. 当前支撑度评估

当前文档已能支撑后续开发：

| 领域 | 支撑度 | 说明 |
| --- | --- | --- |
| 目标体验 | 充分 | PRD、drawio 和阶段审计均描述了用户选择策略、配置参数、查看曲线、查看缺口和生成人工计划草案的路径。 |
| 目标架构 | 充分 | drawio 第 2、3、5、6 页说明当前架构、目标能力、开发计划和出门条件。 |
| 交易边界 | 充分 | 文档明确 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`。 |
| 后续正式交易前置 | 需要本文件补齐 | 原文档说明了风险，但缺少可直接执行的阶段化验收清单。本文件补齐。 |

结论：

```text
current_stage_documentation_support=complete
next_stage_development_plan_support=complete_after_this_file
formal_trading_unlock_support=blocked_until_human_review_and_official_data
```

本轮文档开发要求进一步收口：每个开发项都必须同时说明“代码实体、数据字段、用户界面、审计产物、验收命令”。不得只写抽象能力名，例如“完善数据层”或“增强模型验证”；必须写清由哪个页面、API、服务或 artifact 承接。

### 3.0 状态词典与 alias 规则

为避免把人工计划草案 ready 误读为正式交易 ready，本阶段统一使用以下状态词典：

| Canonical 字段 | 兼容 alias | 含义 | 交易含义 |
| --- | --- | --- | --- |
| `researchReady` | `researchWorkflowReady` | 研究筛选、组合比较和审计说明可用。 | 不允许正式交易。 |
| `portfolioBacktestFormalReviewReady` | `portfolioStrategyBacktestFormalReviewReady` | 组合回测材料可进入人工正式评审。 | 不等于正式交易 ready。 |
| `manualTradePlanDraftReviewReady` | `manualDraftReady`, `manualTradeDraftReady`, `manual_trade_plan_draft_review_ready` | 人工计划草案和草案复核材料 ready。 | 只表示草案，不创建订单。 |
| `formalTradingEligible` | 无 | 正式交易资格前置是否全部满足。 | 当前必须为 `false`。 |
| `formalTradingUnlocked` | 无 | 正式 `ADD / REDUCE / ORDER_CREATE` 是否解锁。 | 当前必须为 `false`。 |
| `autoTradeUnlocked` | 无 | 自动交易是否解锁。 | 当前必须为 `false`，本阶段不开放。 |

强规则：

```text
manualDraftReady == manualTradePlanDraftReviewReady
manualTradeDraftReady == manualTradePlanDraftReviewReady
manualTradePlanDraftReviewReady != formalTradingUnlocked
portfolioBacktestFormalReviewReady != formalTradingUnlocked
tradeActionReadiness passed 只能解释为 gate contract passed 或 ready_for_manual_trade_draft
```

每次审计包、前端 `readinessSummary`、API response 和文档摘要都必须保留 canonical 字段；alias 只能用于兼容旧文档或旧审计包。

### 3.1 统一实现实体

| 领域 | 实体 | 文档中必须说明的关系 |
| --- | --- | --- |
| 前端正式评审入口 | `frontend/src/pages/Backtest.tsx` | 读取组合回测结果，展示 `readinessSummary / dataGrade / modelEffectivenessStatus / manualPlanDraft / formalTradingBlockers`。 |
| 红利低波入口 | `frontend/src/pages/DividendLowVol.tsx` | 展示候选池、指标解释、买卖观察区间、滚动回测和交易锁定提示。 |
| 任务审计入口 | `frontend/src/pages/Operations.tsx` | 通过 Operation 和 artifactRefs 追溯扫描、回测、审计包和 HTML 验收报告。 |
| 组合回测 API | `backend/src/routes/portfolioBacktest.ts` | 暴露 templates、run、operation、reviews，不允许创建订单。 |
| 红利低波 API | `backend/src/routes/strategy.ts` | 暴露 candidate、trading-zones、rolling-backtest、manual acceptance 和 FIVD-R adapter。 |
| 组合回测核心 | `PortfolioBacktestInputBuilder / PortfolioBacktestEngine` | 构建组合输入并输出曲线、指标、数据等级、模型有效性和 readiness。 |
| 人工复核审计 | `portfolioBacktestReviewService` | 保存复核记录，返回 `canCreateOrder=false`、`formalTradingUnlocked=false`。 |
| 审计包 | `run:interactive-strategy-backtest-audit-package` | 生成 `SUMMARY_FOR_GPT.md` 与 09-12 JSON，解释为什么仍未解锁正式交易。 |

## 4. 开发计划

本阶段开发计划的产出必须同时覆盖三个层面：

- 产品层：用户能理解策略比较、草案和阻断原因。
- 架构层：数据等级、模型有效性、人工复核和交易 gate 有清晰边界。
- 验收层：每一项能力都有命令、截图或审计包证据。

### FT-1 官方与免费数据源分级

目标：

建立正式数据源、免费数据源、研究代理数据源的分级契约，防止数据状态混用。

开发内容：

- 在组合回测结果中统一输出 `dataGrade`。
- 区分 `official_authorized`、`free_source_cross_checked`、`price_index_only`、`research_proxy`、`insufficient`。
- 对 benchmark、行情、分红、交易约束分别输出 source grade。
- 审计包中列出每一类数据的来源、时间、新鲜度、覆盖率和阻断项。

验收标准：

- 前端能看到每条策略和 benchmark 的数据等级。
- 免费源 total-return benchmark 可以支撑 formal review，但不能标记为官方授权。
- `research_proxy` 不得进入正式交易解锁判断。

用户可见效果：

- 用户在 `/backtest` 能直接看到每条策略和 benchmark 的数据等级。
- 当数据为 `research_proxy` 或 `insufficient` 时，页面必须显示阻断原因，而不是只显示曲线。
- 审计用户能在 `09_data_grade_audit.json` 中核对数据来源、时间、新鲜度和覆盖率。

验收命令：

```bash
cd backend
node node_modules/typescript/bin/tsc --noEmit
npm run test:portfolio-backtest-formal-review-readiness
npm run run:interactive-strategy-backtest-audit-package
```

### FT-2 组合模型有效性验证

目标：

让组合策略从“能回测”升级为“有效性可审计”，覆盖不同时间窗口、市场状态和参数扰动。

开发内容：

- 为组合回测新增 OOS、walk-forward、参数敏感性和分组稳定性 artifact。
- 至少覆盖永久组合、全天候、红利低波篮子、当前持仓、自定义组合。
- 对每个策略输出 `modelEffectivenessStatus`：`passed / warning / insufficient / failed`。
- 对失败项输出 failure taxonomy，不允许只给笼统 insufficient。

验收标准：

- 至少 6 个 walk-forward 窗口。
- 每个策略输出样本内、样本外收益和最大回撤。
- 红利低波篮子必须单独输出行业、流动性和市场状态分组稳定性。
- 任一核心验证 insufficient 时，`formalTradingUnlocked=false`。

用户可见效果：

- 用户能看到每条策略是 `passed / warning / insufficient / failed`，并知道失败原因。
- 红利低波篮子必须单独展示样本外、walk-forward、参数扰动、行业/流动性/市场状态分组结论。
- 如果验证只是研究代理路径，页面和审计包都必须标记为 warning 或 insufficient。

验收命令：

```bash
cd backend
npm run test:portfolio-backtest-formal-review-readiness
npm run test:strategy-tournament-backtest
npm run test:dividend-low-vol-validation-retest
```

### FT-3 人工交易计划草案闭环

目标：

把组合回测结果连接到人工计划草案，但不创建订单。

开发内容：

- 生成 `manualPlanDraft` artifact。
- 每个草案包含策略来源、建议动作类型、目标权重、当前权重、偏离度、风险约束、人工复核 checklist。
- `formalTargetWeight` 在未解锁正式交易前保持 0。
- 新增只记录审计、不创建订单的人工复核接口：`GET /api/v1/portfolio-backtest/reviews/:runId` 与 `POST /api/v1/portfolio-backtest/reviews/:runId`。
- 人工复核记录必须保存 `reviewerId`、`reviewedAt`、`decision`、`notes`、`blockedReasons`、`humanReviewChecklist` 和安全断言。
- 页面明确显示“草案待人工确认，不构成交易指令”。

验收标准：

- 当前持仓已超单票或行业上限时，不生成建仓草案。
- 缺交易约束或价格 freshness 不通过时，只生成 blocked reason。
- `prohibitedActions` 始终包含 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`，直到人工正式解锁。
- 复核接口返回 `canCreateOrder=false`、`formalTargetWeightPercent=0`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`。

用户可见效果：

- 用户能看到草案来自哪条策略、当前权重、研究目标权重、偏离度、风险约束和复核 checklist。
- 页面明确显示“草案待人工复核，不构成交易指令”。
- 即使人工复核记录保存成功，也不得出现订单号、下单按钮或正式 ADD/REDUCE 状态。

验收命令：

```bash
cd backend
npm run test:trade-action-readiness
npm run test:fivd-r-trade-gate-contract
npm run test:portfolio-backtest-current-holdings-sample
```

### FT-4 前端正式评审工作台

目标：

让用户在前端完整看到“策略回测 -> 有效性验证 -> 人工草案 -> 阻断原因”的闭环。

开发内容：

- 在 `/backtest` 页面增加正式评审摘要区。
- 展示 `readinessSummary`、`portfolioBacktestFormalReviewReady`、`modelEffectivenessStatus`、数据等级、交易 gate、人工复核状态。
- 对红利低波、当前持仓、永久组合、全天候分别展示可展开的验证证据。
- 保存浏览器截图审计。

验收标准：

- 用户能从页面判断哪些策略可比较，哪些只能观察，哪些被阻断。
- 页面不出现“可交易”“下单”“自动再平衡”误导文案。
- E2E 截图包含策略选择、曲线、数据等级、交易 gate 和草案阻断。

用户可见效果：

- 用户能用一屏判断：哪些策略可以比较，哪些策略数据不足，哪些策略只能观察，正式交易为什么锁定。
- 前端必须把 `formalTradingUnlocked=false` 和 `autoTradeUnlocked=false` 放在评审摘要区，而不是隐藏到审计文件里。
- 红利低波页面与组合回测页面的术语必须一致：观察区间、人工计划草案、正式交易阻断。

验收命令：

```bash
cd backend
npm run test:portfolio-backtest-frontend-runtime

cd ../frontend
npm run build
```

### FT-5 审计包升级

目标：

把正式交易级前置评审所需材料集中到一个可复审目录。

开发内容：

- 扩展 `run:interactive-strategy-backtest-audit-package`。
- 新增或强化以下文件：
  - `09_data_grade_audit.json`
  - `10_model_effectiveness_audit.json`
  - `11_manual_plan_draft_audit.json`
  - `12_formal_trading_unlock_blockers.json`
- `SUMMARY_FOR_GPT.md` 必须明确：是否可正式交易、是否可自动交易、缺什么。
- `SUMMARY_FOR_GPT.md` 和 09-12 审计文件必须包含 `readinessSummary`，明确区分 research ready、formal review ready、manual draft ready、formal trading eligible、formal trading unlocked。

验收标准：

- 审计包可以独立解释当前状态。
- 审计包不包含 token、cookie、隐私数据或原始 DB 文件。
- `formalTradingUnlocked=false` 时必须列出 blocker。

用户可见效果：

- 人工或 ChatGPT 审计只读取审计包即可复核本阶段状态，不依赖口头汇报。
- `SUMMARY_FOR_GPT.md` 必须能独立说明 research-ready、formal-review-ready、manual-draft-ready 和 formal-trading-locked。

验收命令：

```bash
cd backend
npm run run:interactive-strategy-backtest-audit-package
```

### FT-6 正式交易解锁前最终闸门

目标：

定义但不自动执行正式交易解锁闸门。

开发内容：

- 新增 `formalTradingUnlockChecklist`。
- 要求人工确认官方 benchmark、模型有效性、交易约束、组合风险、价格 freshness 和合规提示。
- 保留 `AUTO_TRADE=false` 作为独立长期策略。

验收标准：

- 系统可以显示“尚未解锁正式交易”的具体原因。
- 人工未确认时，不能输出正式 `ADD / REDUCE / ORDER_CREATE`。
- 自动交易永远不因本阶段通过而解锁。

用户可见效果：

- 用户看到的是“正式交易解锁清单”和“当前 blocker”，不是交易授权。
- 清单必须展示官方 benchmark、正式 provider、交易约束、模型有效性、人工复核和合规确认是否完成。
- 本阶段只允许把 blocker 说明清楚，不允许改变交易锁定状态。

验收命令：

```bash
cd backend
npm run test:production-readiness
npm run test:trade-action-readiness
```

## 5. 端到端验收矩阵

| 用户场景 | 通过标准 | 证据 |
| --- | --- | --- |
| 多策略回测比较 | 7 条策略可比较，曲线、指标、benchmark、缺口可见 | 前端截图 + audit package |
| 数据等级检查 | 每条策略和 benchmark 均显示数据等级 | `09_data_grade_audit.json` |
| 模型有效性检查 | OOS、walk-forward、敏感性、分组稳定性有结果或 blocker | `10_model_effectiveness_audit.json` |
| 人工草案 | 能生成草案或明确 blocked reason，不创建订单 | `11_manual_plan_draft_audit.json` |
| 交易 gate | 正式动作和自动交易仍被禁止 | `06_trade_gate_contract.json` |

## 5.1 用户体验验收门槛

| 用户体验 | 必须达成 | 不允许出现 |
| --- | --- | --- |
| 策略比较 | 用户能看懂不同组合在同一区间的收益、回撤、benchmark 和缺口 | 只给曲线但不说明数据等级 |
| 红利低波联动 | 用户能从红利低波候选进入组合回测和人工计划草案 | 把买入观察区间写成正式买入建议 |
| 人工草案 | 用户能看到当前权重、目标研究权重、失效条件和复核 checklist | 生成订单或自动再平衡 |
| 审计追溯 | 用户能从任务中心或审计包追溯输入、曲线、指标、blockedReasons | 用 summary 代替证据文件 |
| 正式交易边界 | 用户能看到为什么尚未解锁正式交易 | 显示与当前锁定状态相反的误导文案 |

## 6. 本阶段完成后可声明

```text
portfolio_strategy_backtest_formal_review_ready=true
portfolioBacktestFormalReviewReady=true
portfolioStrategyBacktestFormalReviewReady=true
manual_trade_plan_draft_review_ready=true
manualTradePlanDraftReviewReady=true
formal_trading_unlock_prerequisites_documented=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

## 7. 仍不能声明

```text
strategy_can_trade_automatically
formal_add_reduce_unlocked
order_create_allowed
auto_rebalance_ready
official_benchmark_certified
```

## 8. 审计入口

下一轮 ChatGPT 或独立审计应先读取：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/manifest.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/04_formal_review_prerequisite_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/06_trade_gate_contract.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/14_formal_trading_release_gate_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/18_manual_signoff_audit.json
```

## 9. 文档开发验收清单

本阶段文档开发完成后，必须执行以下检查：

```bash
rg -n "formalTradingUnlocked[=]true|autoTradeUnlocked[=]true" docs/DIVIDEND_LOW_VOL_PRD.md docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md docs/ARCHITECTURE_CURRENT_TARGET.md docs/TARGET_ARCHITECTURE_GAP.md docs/drawio-summary.txt docs/target-architecture-gap.drawio
rg -n "ORDER_CREATE|AUTO_TRADE" docs/DIVIDEND_LOW_VOL_PRD.md docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md docs/ARCHITECTURE_CURRENT_TARGET.md docs/TARGET_ARCHITECTURE_GAP.md docs/drawio-summary.txt docs/target-architecture-gap.drawio
rg -n "DividendLowVol.tsx|Backtest.tsx|Operations.tsx|portfolioBacktestReviewService|PortfolioBacktestEngine|dividendLowVolTradingZoneService" docs
rg -o "<diagram[^>]*name=\"[^\"]+\"" docs/target-architecture-gap.drawio
rg -n "researchReady|portfolioBacktestFormalReviewReady|manualTradePlanDraftReviewReady|dataGrade|modelEffectivenessStatus|manualPlanDraft|formalTradingUnlockChecklist" docs
node docs/read-drawio.mjs docs/target-architecture-gap.drawio > docs/read-drawio-output.txt
```

通过标准：

- drawio 页数不超过 8 页，当前固定为 7 页。
- PRD、目标架构、阶段计划和 drawio 摘要使用相同阶段状态字段。
- 每个关键能力都能定位到前端页面、后端 API、服务或审计产物。
- 文档中没有任何把人工计划草案、formal review ready 或 tradeActionReadiness 解释为正式交易放行的表述。
- `docs/read-drawio-output.txt` 必须能证明 drawio 原始 XML 本体可读，且每页节点绑定了真实实体、用户路径、验收产物或交易边界。

### 9.1 交易边界 grep 合同测试

以下命中必须视为 hard fail：

```text
formalTradingUnlocked 被写成 true
autoTradeUnlocked 被写成 true
orderCreateAllowed 被写成 true
canCreateOrder 被写成 true
formalTargetWeightPercent 被写成大于 0
formal ADD 被写成 unlocked
formal REDUCE 被写成 unlocked
ORDER_CREATE 被写成 allowed
AUTO_TRADE 被写成 allowed
```

以下命中允许存在，但必须处在 `prohibitedActions / cannot declare / non-goal / blocker / locked / 禁止 / 不允许 / 不能声明` 语境下：

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
formal trading
tradeActionReadiness
```

若自动 grep 命中 `ORDER_CREATE` 或 `AUTO_TRADE`，审计者必须检查上下文；仅出现“禁止、不能声明、locked、prohibitedActions includes”不构成失败。
