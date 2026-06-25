# 正式交易前置文档验收审计

更新时间：2026-06-25

## 1. 审计结论

```text
status = pass_formal_trading_prerequisite_docs
formalTradingReady = false
formalTradingUnlocked = false
autoTradeUnlocked = false
```

本轮审计结论：当前文档可以支撑 `formal-trading-prerequisite` 阶段自动化开发。该结论只表示“正式交易解锁前置材料、组合回测正式评审材料、人工计划草案复核材料”已经具备文档支撑，不表示正式交易 release，不表示订单创建或自动交易可用。

## 2. 本轮修订内容

已根据 ChatGPT 审计建议补充以下内容：

- 在 `PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md` 增加状态词典与 alias 规则。
- 在 `DIVIDEND_LOW_VOL_PRD.md` 增加 `manualDraftReady / manualTradeDraftReady / manualTradePlanDraftReviewReady` 的等价关系。
- 增加 `tradeActionReadiness` 的解释口径：只能表示 gate contract passed 或 ready_for_manual_draft，不代表交易可用。
- 增加 drawio 本体读取证据：`docs/read-drawio-output.txt`。
- 增加机器可读审计结果：`backend/data/gpt-audit/interactive-strategy-backtest/2026-06-25T09-14-45-971Z/doc_acceptance_audit.json`。
- 修正 hard-fail 示例，避免文档中的合同测试文本自命中。

## 3. 状态词典验收

Canonical 状态：

```text
researchReady
portfolioBacktestFormalReviewReady
portfolioStrategyBacktestFormalReviewReady
manualTradePlanDraftReviewReady
formalTradingEligible
formalTradingUnlocked=false
autoTradeUnlocked=false
```

兼容 alias：

```text
manualDraftReady == manualTradeDraftReady == manualTradePlanDraftReviewReady
manual_trade_plan_draft_review_ready == manualTradePlanDraftReviewReady
```

强制解释：

```text
manualTradePlanDraftReviewReady != formalTradingUnlocked
portfolioBacktestFormalReviewReady != formalTradingUnlocked
tradeActionReadiness passed = gate_contract_passed_or_manual_draft_ready
```

## 4. drawio 本体验收

drawio 原始文件：

```text
docs/target-architecture-gap.drawio
```

读取输出：

```text
docs/read-drawio-output.txt
```

读取结果：

```text
pageCount = 7
pageLimit = 8
```

页面：

```text
1 目标体验与用户路径
2 分层架构与调用关系
3 组合回测实现路径
4 红利低波实现路径
5 数据可信与模型验证
6 开发及验收计划
7 里程碑出门与审计
```

本体验收结论：通过。图中已绑定前端页面、后端 API、服务、数据证据、Operation artifact、审计产物和交易边界，不再只依赖摘要审计。

## 5. 交易边界验收

Hard fail 检查项未命中：

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

允许出现但必须处于禁止语境的词：

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
tradeActionReadiness
formal trading
```

当前文档中这些词均用于 `prohibitedActions / non-goal / blocker / locked / 禁止 / 不允许 / 不能声明` 语境，未发现交易放行承诺。

## 6. 用户路径验收

文档当前可以解释以下路径：

- 红利低波筛选。
- 买卖观察区间查看。
- 组合策略回测。
- 人工计划草案。
- 任务审计追溯。
- 为什么仍不能正式交易。

## 7. 需要给 ChatGPT 复审的路径

```text
docs/DIVIDEND_LOW_VOL_PRD.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/read-drawio-output.txt
docs/FORMAL_TRADING_PREREQUISITE_DOC_AUDIT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-25T09-14-45-971Z/doc_acceptance_audit.json
```

## 8. 最终边界

本审计通过不代表正式交易可用。下一阶段仍必须保留：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

正式交易 release 仍需后续独立完成官方 benchmark、正式 provider、完整交易约束、模型有效性 formal passed、人工签核、合规/风控签核和订单执行隔离评审。
