# S2 PRD 规格复核

日期：2026-09-12

## 复核范围

- `docs/DAILY_PORTFOLIO_REVIEW_PRD.md` 与 DPR-001～DPR-030。
- 红利低波、组合回测、ChatBox、UX-F7 和交易边界现行文档。
- `docs/current-stage-state.json` 的当前状态口径。
- 本轮代码差异、真实数据测试、API 结果和 headless 截图。

## 独立复核结论

```text
requirementCoverage=30_of_30
fatalSpecificationDeviationCount=0
majorUnclosedSpecificationDeviationCount=0
falseAcceptanceRiskFoundAndUnclosed=false
historicalFixtureAssumptionsRemoved=true
realAccountPrivacyBoundaryPassed=true
expertPagesPreserved=true
chatBoxFirstClassPathPassed=true
formalTradingReleaseReady=false
prdReviewDecision=PASS_FOR_S2_EXIT
```

## 一致性判断

1. PRD 要求覆盖“当前全部非现金持仓”，不是固定六个；验收脚本已改为动态集合相等和逐项结果守恒，最新证据为 14/14。
2. 当前账户事实来自最新已确认快照，旧截图 ID、固定金额和固定标的不再作为 public contract。
3. 研究分桶、人工草案和组合研究用途继续隔离；草案不会写 Transaction、Position 或外部订单。
4. ChatBox 是普通用户第一业务入口，但 Dashboard、DividendLowVol、Backtest、Operations、Analysis 等专家路径仍保留。
5. `formal-review-ready`、`manual-draft-ready` 和研究回测通过均未被解释为 `formal-trading-ready`。

## 测试覆盖判断

本轮覆盖运行时健康、当前行情时点、真实账户复盘、严格 LLM、持久化研究、轮动多市场数据、长周期组合回测、ChatBox 工具/权限/图表、交易锁、API、前端构建以及 1440/768/390 视口。对本次修改的高风险路径已有正向、阻断和防副作用断言。

仍未由自动化替代的内容是产品体验人工判断、正式数据授权、正式 benchmark 资格、正式模型签核和 release 审批；这些属于已声明的高风险外部门禁，不是本轮虚假 PASS。

## 交易边界

```text
allowed=RESEARCH,OBSERVE,COMPARE,ALERT,PLAN_DRAFT,MANUAL_TRADE_DRAFT
prohibited=ADD,REDUCE,ORDER_CREATE,AUTO_TRADE
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```
