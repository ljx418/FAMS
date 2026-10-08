# FAMS 工作流注册表

更新时间：2026-10-08

## 按工作流

| 工作流 | 规格 | 状态 | 触发 | 主执行者 |
| --- | --- | --- | --- | --- |
| 每日持仓复盘 | `../DAILY_PORTFOLIO_REVIEW_PRD.md` | Approved | ChatBox、每日复盘页、可选调度器 | DailyReviewService |
| 券商波动交易每日复盘 | `WORKFLOW-broker-volatility-daily-review.md` | Implemented / Verified 2026-10-08 | 同花顺截图、ChatBox、每日复盘页、09:40/14:40提醒 | BrokerReviewReconciliationService / DailyReviewService |
| 波动策略委托草案安全编译 | `WORKFLOW-volatility-order-draft-safety.md` | Implemented / Verified | 券商波动交易每日复盘生成网格草案 | GridStrategyService / DailyReviewService |
| 支付宝一键投资复盘 | `WORKFLOW-alipay-one-click-review.md` | Implemented | 每日复盘页“一键生成复盘与金额草案” | AlipayOneClickReviewService |
| 支付宝持仓组合持久化与滑动窗口比较 | `WORKFLOW-alipay-portfolio-window-comparison.md` | Implemented | 持仓组合对比页手动运行、历史选择、可选调度器 | AlipayResearchWorkflowService |
| 截图导入与人工确认 | `../DAILY_PORTFOLIO_REVIEW_PRD.md` | Approved | ScreenshotCapturePanel | ScreenshotCaptureService |
| 交易事实采集与对账 | `WORKFLOW-trade-fact-ingestion-reconciliation.md` | Implemented / Verified 2026-10-08 | 宿主结构化截图、CSV、人工补录、复盘前检 | TradeLedgerService / ScreenshotCaptureService / TransactionService / BrokerReviewReconciliationService |
| 人工交易计划与执行生命周期 | `WORKFLOW-trade-plan-execution-lifecycle.md` | Implemented / Verified 2026-10-08 | 仓位调整复盘、轮动波动策略、后续委托与成交回填 | DailyReviewService / RotationVolatilityStrategyService / PlanExecutionService / GridReplayService |
| 组合相对轮动 | `../RRG_WATCHLIST_PRD.md` | Approved | RRG页面、组合分析 | PortfolioRelativeRotationService |
| 自动或正式交易 | `../TRADE_BOUNDARY_CONTRACT.md` | Deprecated/Locked | 无 | 无 |

## 按组件

| 组件 | 参与工作流 |
| --- | --- |
| DailyReviews / DailyReviewService | 每日持仓复盘、券商波动交易每日复盘、波动策略委托草案安全编译、支付宝一键投资复盘 |
| BrokerReviewReconciliationService / DailyReviewHtmlService | 券商波动交易每日复盘、波动策略委托草案安全编译 |
| ScreenshotCapturePanel / ScreenshotCaptureService | 截图导入与人工确认、支付宝一键投资复盘 |
| AllocationPolicyService | 支付宝一键投资复盘 |
| PortfolioRelativeRotationService | 组合相对轮动、支付宝一键投资复盘 |
| DailyReviewSynthesisService | 每日持仓复盘、支付宝一键投资复盘 |
| Advice / AdviceAction | 每日持仓复盘、支付宝一键投资复盘 |
| PortfolioComparison / AlipayPortfolioComparisonService | 支付宝持仓组合持久化与滑动窗口比较 |
| AnalysisWorkflowProfile / Operation | 支付宝一键投资复盘、支付宝持仓组合持久化与滑动窗口比较 |
| AlipayResearchWorkflowScheduler / SchedulerLease | 支付宝一键投资复盘、支付宝持仓组合持久化与滑动窗口比较 |
| BrokerReviewReminderScheduler / Alert / ChatBox | 券商波动交易每日复盘提醒（不自动运行、不下单） |
| TradeLedgerService / TransactionService / ScreenshotCaptureService | 交易事实采集与对账 |
| PlanExecutionService / GridOrderDraftEvent / PlanExecutionLink | 人工交易计划与执行生命周期 |
| InvestmentResearchSnapshot / GridPlan / GridOrderDraft | 人工交易计划与执行生命周期 |
| GridStrategyService / DailyReviewService | 波动策略委托草案安全编译 |
| GridReplayService | 人工交易计划与执行生命周期、建议质量回放 |

## 按用户旅程

| 用户体验 | 工作流 | 入口 |
| --- | --- | --- |
| 持仓或交易变化后上传支付宝截图 | 截图导入与人工确认 | `/daily-reviews` |
| 上传同花顺持仓/成交/委托截图并先对账 | 券商波动交易每日复盘 | `/daily-reviews` |
| 检查成交是否重复、是否影响仓位以及对账是否完整 | 交易事实采集与对账 | `/daily-reviews`、截图面板、MCP |
| 查看人工计划是否已挂、部分成交、成交或失效 | 人工交易计划与执行生命周期 | `/daily-reviews/:reviewId`、相对轮动持仓策略面板 |
| 浏览五段式对账、30日均线、日频RRG及订单草案 | 券商波动交易每日复盘 | `/daily-reviews/:reviewId`、HTML报告 |
| 核对每档为何活动、休眠或需人工确认 | 波动策略委托草案安全编译 | `/daily-reviews/:reviewId`、HTML报告、MCP结果 |
| 无需聊天，一键得到今日建议 | 支付宝一键投资复盘 | `/daily-reviews` |
| 检查价格、均线、轮动和证据 | 每日持仓复盘、组合相对轮动 | `/daily-reviews/:reviewId` |
| 接受、修改或拒绝名义金额草案 | 支付宝一键投资复盘 | `/daily-reviews/:reviewId` |
| 不用聊天，一次完成分析并保存组合研究 | 支付宝一键投资复盘、持仓组合持久化 | `/portfolio-comparison` |
| 选择旧运行并拖动时间窗比较两种口径 | 支付宝持仓组合持久化与滑动窗口比较 | `/portfolio-comparison` |
| 授权七天截图复用并启用工作日时槽 | 支付宝一键投资复盘 | `/portfolio-comparison` |

## 按状态

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `preflight_blocked` | 截图、LLM或持仓核对不满足 | 修复后重新预检 |
| `refreshing_data` | 预检通过 | 行情完成或失败 |
| `analyzing` | 行情达到最低门槛 | 确定性分析完成或失败 |
| `llm_synthesizing` | 确定性分析完成 | 严格LLM校验通过或失败 |
| `ready_for_human_review` | LLM成功且交易边界锁定 | 人工接受、修改、拒绝或过期 |
| `failed` | 任一步骤不可恢复失败 | 用户修复后发起新运行 |
| `scheduler_blocked` | 截图授权到期、撤销或最新截图变化 | 更新并确认截图后重新授权 |
| `comparison_saved` | 十组研究完成并通过压缩校验 | 选择历史报告或滑动窗口 |
| `ingestion_preview_ready` | 输入已标准化并完成去重预览 | 人工确认、修正或忽略 |
| `reconciliation_ready/warning/blocked` | 成交与持仓/资金/委托覆盖完成核对 | 运行策略、补充证据或显式确认零变化 |
| `plan_proposed/submitted/partially_filled/filled` | 计划创建、观察到委托或确认成交 | 人工执行、继续回填、撤销/到期/替代 |
| `active/awaiting_parent_fill/awaiting_sellability/dormant/retired_for_position/manual_confirmation_required` | 固定档位与本轮事实完成安全编译 | 新事实、父单成交、T+1释放、人工确认或新策略版本 |
