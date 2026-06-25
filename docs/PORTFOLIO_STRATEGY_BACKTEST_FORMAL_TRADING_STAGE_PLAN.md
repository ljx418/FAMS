# 组合策略回测正式交易级前置开发及验收计划

更新时间：2026-06-24

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

下一阶段目标不是立即放行交易，而是把系统从“组合回测正式评审 ready”推进到“正式交易级解锁前置材料完整”。完成后，项目应能让人工审核者清楚回答：

1. 数据是否足够可信。
2. 回测是否可复现。
3. 模型是否在样本外和不同市场环境中有效。
4. 人工交易计划草案是否遵守仓位、行业、流动性和交易约束。
5. 是否仍禁止自动交易。

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

## 4. 开发计划

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
- 页面明确显示“草案待人工确认，不构成交易指令”。

验收标准：

- 当前持仓已超单票或行业上限时，不生成建仓草案。
- 缺交易约束或价格 freshness 不通过时，只生成 blocked reason。
- `prohibitedActions` 始终包含 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`，直到人工正式解锁。

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
- 展示 `portfolioBacktestFormalReviewReady`、`modelEffectivenessStatus`、数据等级、交易 gate、人工复核状态。
- 对红利低波、当前持仓、永久组合、全天候分别展示可展开的验证证据。
- 保存浏览器截图审计。

验收标准：

- 用户能从页面判断哪些策略可比较，哪些只能观察，哪些被阻断。
- 页面不出现“可交易”“下单”“自动再平衡”误导文案。
- E2E 截图包含策略选择、曲线、数据等级、交易 gate 和草案阻断。

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

验收标准：

- 审计包可以独立解释当前状态。
- 审计包不包含 token、cookie、隐私数据或原始 DB 文件。
- `formalTradingUnlocked=false` 时必须列出 blocker。

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

## 6. 本阶段完成后可声明

```text
portfolio_strategy_backtest_formal_review_ready=true
manual_trade_plan_draft_review_ready=true
formal_trading_unlock_prerequisites_documented=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

## 7. 仍不能声明

```text
strategy_can_trade_automatically=true
formal_add_reduce_unlocked=true
order_create_allowed=true
auto_rebalance_ready=true
official_benchmark_certified=true
```

## 8. 审计入口

下一轮 ChatGPT 或独立审计应先读取：

```text
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/manifest.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/04_formal_review_prerequisite_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/06_trade_gate_contract.json
```
