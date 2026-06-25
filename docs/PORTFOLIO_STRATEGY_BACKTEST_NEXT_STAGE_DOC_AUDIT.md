# 组合策略回测下一阶段文档审计

更新时间：2026-06-24

## 1. 审计结论

当前文档已能完整支撑下一阶段自动化开发，但正式交易解锁仍必须由人工复核和独立 gate 决定。

```text
documentationCoverage=complete_for_formal_trading_prerequisite_development
currentStageCoverage=complete_for_portfolio_backtest_formal_review_ready
formalTradingCoverage=blocked_until_human_review
autoTradeCoverage=blocked_by_policy
overPromiseRisk=controlled
humanConfirmationRequiredBeforeDevelopment=false
humanConfirmationRequiredBeforeTradingUnlock=true
```

## 2. 已审计文档

本轮重新阅读并交叉检查：

```text
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
```

## 3. 当前实现状态

```text
interactiveStrategyBacktestReady=true
researchGradeStrategyComparisonReady=true
portfolioBacktestFormalReviewReady=true
manualDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
completedStrategies=7/7
tradeConstraintCoveragePercent=99.69
freeSourceTotalReturnBenchmarkReady=true
runtimeHealth=healthy
frontendRuntimeEvidence=passed
```

状态来源：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
```

## 4. 文档修正记录

| 问题 | 处理 |
| --- | --- |
| PRD 仍保留早期缺口描述，与最新审计包状态不一致 | 已改为：免费源 total-return benchmark 与审计用户持仓样本已支撑 formal review；官方授权 benchmark、正式分红链路和人工复核仍是正式交易前置 |
| 目标架构仍保留旧的 formal review 状态 | 已改为：`portfolioBacktestFormalReviewReady=true`，但 `formalTradingUnlocked=false` |
| drawio 第 5 页只描述 PBT-0 到 PBT-11，缺少下一阶段开发入口 | 已补充 FT-1 到 FT-6 正式交易级前置计划摘要 |
| 审计入口过多且状态分散 | 已新增 `PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md` 作为下一阶段主计划 |

## 5. 支撑度矩阵

| 目标 | 文档支撑度 | 结论 |
| --- | --- | --- |
| 用户选择多策略并回测 | 充分 | PRD、drawio、阶段审计均覆盖路径和验收。 |
| 前端展示收益曲线、回撤、benchmark、分红贡献、缺口 | 充分 | PRD 与 drawio 第 1、3、6、7 页覆盖。 |
| 组合回测 formal review ready | 充分 | PRD、审计包、阶段审计和 drawio 均一致。 |
| 下一阶段数据等级开发 | 充分 | FT-1 已定义开发项、验收标准和命令。 |
| 下一阶段模型有效性验证 | 充分 | FT-2 已定义 OOS、walk-forward、敏感性和分组稳定性。 |
| 人工交易计划草案闭环 | 充分 | FT-3 已定义 artifact、前端边界和交易阻断。 |
| 前端正式评审工作台 | 充分 | FT-4 已定义页面元素和截图验收。 |
| 审计包升级 | 充分 | FT-5 已定义新增审计文件。 |
| 正式交易解锁 | 仅前置充分 | FT-6 只定义 checklist 和阻断，不允许自动解锁。 |

## 6. 下一阶段开发及验收大纲

### FT-1 数据等级

开发目标：

- 为行情、benchmark、分红、交易约束分别输出数据等级。
- 等级包括 `official_authorized / free_source_cross_checked / price_index_only / research_proxy / insufficient`。

验收标准：

- 前端和审计包均可看到数据等级。
- 免费源不能被展示为官方授权。
- `research_proxy` 不得进入正式交易解锁判断。

### FT-2 模型有效性

开发目标：

- 为组合策略新增 OOS、walk-forward、参数敏感性和分组稳定性 artifact。

验收标准：

- 至少 6 个 walk-forward 窗口。
- 每个策略输出样本内、样本外收益和最大回撤。
- 任一核心验证 insufficient 时，`formalTradingUnlocked=false`。

### FT-3 人工交易计划草案

开发目标：

- 生成 `manualPlanDraft` artifact，连接组合回测结果和人工复核 checklist。

验收标准：

- 不创建订单。
- 未通过价格、仓位、行业、交易约束时只输出 blocked reason。
- `prohibitedActions` 包含 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

### FT-4 前端正式评审工作台

开发目标：

- 在 `/backtest` 增加正式评审摘要区，展示 formal review、数据等级、模型有效性、人工复核和交易 gate。

验收标准：

- 用户能判断策略可比较、可观察、或被阻断。
- 页面无“可交易”“自动下单”等误导文案。
- 浏览器截图覆盖关键路径。

### FT-5 审计包升级

开发目标：

- 扩展交互式策略回测审计包，新增数据等级、模型有效性、人工草案和正式交易 blocker 文件。

验收标准：

- `SUMMARY_FOR_GPT.md` 可独立解释当前状态。
- 不包含 token、cookie、`.env` 或原始 DB 文件。

### FT-6 正式交易解锁闸门

开发目标：

- 定义 `formalTradingUnlockChecklist`，但不自动解锁交易。

验收标准：

- 未经人工确认时不得输出正式 `ADD / REDUCE / ORDER_CREATE`。
- `AUTO_TRADE=false` 保持独立长期锁定。

## 7. 统一验收命令

```bash
cd backend
node node_modules/typescript/bin/tsc --noEmit
npm run check:sqlite-health
npm run test:portfolio-backtest-formal-review-readiness
npm run test:portfolio-backtest-api-contract
npm run test:portfolio-backtest-current-holdings-sample
npm run test:portfolio-backtest-frontend-runtime
npm run test:production-readiness
npm run test:trade-action-readiness
npm run run:interactive-strategy-backtest-audit-package

cd ../frontend
npm run build
```

## 8. 审计意见

当前没有新增致命或重大规格偏差。文档已经可以指导下一阶段开发。

剩余风险不是文档不足，而是正式交易级客观前置：

- 官方授权 benchmark 和正式 provider 仍需后续接入或人工确认。
- 模型有效性不能只靠可回测证明，必须补 OOS、walk-forward、敏感性和分组稳定性。
- 人工复核记录必须独立于自动化流程。
- 自动交易仍不得由本阶段解锁。

## 9. 审计文件清单

建议 ChatGPT 或独立审计读取以下文件，数量小于 20：

```text
docs/PORTFOLIO_STRATEGY_BACKTEST_NEXT_STAGE_DOC_AUDIT.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/manifest.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/04_formal_review_prerequisite_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T13-44-15-125Z/06_trade_gate_contract.json
```
