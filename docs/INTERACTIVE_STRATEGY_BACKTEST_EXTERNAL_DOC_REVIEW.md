# 交互式策略回测阶段外部文档审查

更新时间：2026-06-24

审查类型：外部文档审查 / 独立规格一致性复核

## 1. 审查结论

当前文档体系可以支撑本阶段剩余开发与验收。

结论状态：

```text
documentationSupport=complete_for_current_stage
fatalSpecDeviation=0
majorSpecDeviation=0
overPromiseRisk=controlled
canProceedToImplementation=true
researchGradeStrategyComparisonReady=true
manualDraftReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本结论只覆盖“交互式策略回测 + 研究级策略比较 + 人工计划草案前置”阶段，不代表系统已进入正式交易级。

## 2. 审查范围

本次复核覆盖以下文档和审计产物：

```text
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/INTERACTIVE_STRATEGY_BACKTEST_STAGE_AUDIT.md
docs/PORTFOLIO_STRATEGY_BACKTEST_STAGE_AUDIT.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-24T11-58-33-608Z/SUMMARY_FOR_GPT.md
```

## 3. 文档支撑度判断

| 开发目标 | 支撑度 | 复核结论 |
| --- | --- | --- |
| 多策略交互式回测 | 完整支撑 | 文档已覆盖策略模板、起止时间、资金、再平衡、分红处理、手续费、滑点、benchmark 和前端展示。 |
| 研究级策略比较 | 完整支撑 | 已明确收益曲线、回撤曲线、指标表、dataCoverage、blockedReasons、Operation artifact 和 evidenceRefs。 |
| 红利低波联动 | 完整支撑本阶段研究级目标 | 已覆盖红利低波篮子、买卖观察区间、候选快照和 evidenceRefs；真实快照读取已接入，当前入篮 3/3，可进入研究级组合比较。 |
| 人工计划草案 | 完整支撑 | 已明确只允许 PLAN_DRAFT / WATCHLIST / PRETRADE_CHECK，formalTargetWeight=0，canCreateOrder=false。 |
| 正式交易级评审 | 只支撑前置规划 | 文档已经列出 Runtime、Provider、Benchmark、Tradeability、Validation、Manual Review 等前置条件，但未承诺已通过。 |
| 自动交易 | 明确不支撑 | 文档一致声明 AUTO_TRADE=false，不开放自动下单和自动再平衡。 |

## 4. Drawio 文件审查

`docs/target-architecture-gap.drawio` 当前为 7 页，未超过 8 页限制，页面内容为中文，覆盖：

```text
1. 目标体验
2. 当前架构与目标架构
3. 交互式策略回测架构
4. 红利低波联动
5. 开发及验收计划
6. 里程碑与出门条件
7. 典型用户路径
```

颜色语义保持一致：

```text
灰色：已经实现或当前可用
黄色：需要修改或增强
橘黄：需要新增
红色：交易硬边界或禁止事项
```

审查结论：

```text
drawioPageCount=7
readability=acceptable
architectureCoverage=complete_for_current_stage
duplicateOrConflictContent=not_found
overPromiseContent=not_found
```

## 5. 当前不允许承诺的内容

以下内容仍不能在产品、文档或前端中表达为“已完成”：

```text
1. formalTradingUnlocked 被写成已解锁
2. autoTradeUnlocked 被写成已解锁
3. 正式 ADD / REDUCE 已放行
4. ORDER_CREATE 已放行
5. 自动再平衡或自动下单已放行
6. proxy benchmark 等同于正式 benchmark
7. 免费数据源保证 100% 实时和完整
8. tradeActionReadiness passed 等同于策略可交易
```

## 6. 剩余开发阻断项

当前剩余阻断项不是文档缺口，而是实现和真实验证缺口：

```text
1. dividend_low_vol_basket 已接入真实候选快照、等权权重、evidenceRefs 和 refreshTime；当前最小真实入篮数量已达 3/3，若后续刷新低于 3 只必须自动回退 insufficient。
2. 正式 total-return benchmark 仍需补齐或继续标记为 proxy / insufficient。
3. 涨跌停、停牌、退市、ST 等交易约束需要更完整的真实数据覆盖。
4. FIVD-R 与红利低波模型仍未完成正式历史有效性验证。
5. 正式交易级仍需要人工评审、模型验证和交易 gate 复核。
```

## 7. 验收建议

进入下一轮实质开发前，建议继续使用以下验收组合：

```bash
cd backend
node node_modules/typescript/bin/tsc --noEmit
npm run check:sqlite-health
npm run test:portfolio-strategy-backtest
npm run test:portfolio-backtest-api-contract
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

文档验收：

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
```

## 8. 外部审查意见

本阶段文档已经足以指导后续开发，不需要继续扩写文档才能开始实现。后续开发应聚焦真实数据闭环、红利低波篮子候选数量扩充、benchmark 和交易约束补齐、前端用户路径验证。

若后续目标切换到“正式交易级”，需要先新增单独的正式交易级 PRD、模型验证规格、风险控制规格、人工审核流程和合规边界文档，不能直接沿用当前研究级文档作为交易级验收依据。
