# 每日持仓复盘需求追踪矩阵

更新时间：2026-09-11

| 需求 | 主要实现 | 自动化证据 | 人类验收项 | 当前状态 |
| --- | --- | --- | --- | --- |
| DPR-001 | DailyReviewService、ChatBox tool、可选 Scheduler | `test:daily-review-workflow` 的场次与幂等断言 | 1、4 | implemented_and_automated_accepted |
| DPR-002 | ScreenshotCaptureService、PositionSnapshot | 缺失持仓保持 open、`missingHoldingsClosed=0` | 2、3、8 | implemented_and_automated_accepted |
| DPR-003 | AssetTrendService、MarketSnapshot、ChatBox chart/detail | S2 最新真实运行动态覆盖 14/14 个当前非现金持仓；各 30 个唯一升序收盘点，MA5/10/30 独立重算一致 | 5 | implemented_and_automated_accepted |
| DPR-004 | `classifyMaterialChange`、PositionAdvice facts | 重大变化、证据不足和上一轮比较断言 | 6 | implemented_and_automated_accepted |
| DPR-005 | `strategyAssessment` 汇总 | maintain/needs_review/insufficient 分支测试 | 6 | implemented_and_automated_accepted |
| DPR-006 | 持仓关注项及 DividendLowVolDaily 候选池 | S2 最新真实运行动态覆盖 14 个当前资产，均有来源、reason 与 evidenceRefs | 7 | implemented_and_automated_accepted |
| DPR-007 | GridStrategyService、fallback template、GridPlan/OrderDraft | S2 最新真实运行覆盖 14 个资产并持久化 28 个分侧 GridPlan；当前账户研究合同另验证 6 个人工计划草案及交易阻断 | 7 | implemented_and_automated_accepted |
| DPR-008 | `GET /api/v1/daily-reviews`、latest/detail | 十节点详情、历史过滤、四视口抽屉与导出运行时验收 | 8 | implemented_and_automated_accepted |
| DPR-009 | vision status、row PATCH、preview/confirm | 真实已确认截图 1 份/7 行；共用面板与单次视觉同意边界通过 | 2、3 | implemented_and_automated_accepted |
| DPR-010 | executionBoundary、Chat/MCP permission gate | 受保护三表哈希零漂移，四项交易权限恒 false，无订单创建 | 全部 | implemented_and_automated_accepted |
| DPR-011 | DailyReviewWorkflowService、DailyReviewWorkflowDag、DailyReviewAuditDrawer | 最终真实报告验证 10 节点、17 边、purpose/dependsOn 与无环；Playwright 四视口与 Chrome CDP 通过 | 8 | implemented_and_automated_accepted |
| DPR-012 | DailyReviewSynthesisService、reportJson.llmSynthesis、llmGate | S2 的 14 资产全账户运行由 MiniMax-M2.7 强制真实门禁通过；单次调用、零重试、严格 schema/白名单/证据/数值校验 | 6、7 | implemented_and_automated_accepted |
| DPR-013 | DailyReviewDecisionPanel、DailyReviewAuditDrawer | Playwright 与 Chrome CDP 确认可读摘要与高级审计分层；原始 evidence id 不内联正文 | 7、8 | implemented_and_automated_accepted |
| DPR-014 | decisionSummary、grid.derivation、DailyReviewDecisionPanel | S2 的 14 资产真实确定性推导可复算，GridPlan 数量满足每资产双侧合同；页面不得把失效或受阻草案伪装成可设置订单 | 7 | implemented_and_automated_accepted |
| DPR-015 | ValueAssessmentService、GridStrategyService 分侧门禁 | S2 动态覆盖 14 个当前资产；价值背景与技术锚分离，重大变化只触发对应风险门禁 | 6、7 | implemented_and_automated_accepted |
| DPR-016 | ScreenshotCaptureService、账户摘要预览与确认 | S2 动态合同读取 2026-09-08 最新已确认快照的 8 行并逐分对账；精确账户金额仅保留在本地私有证据 | 2、3 | implemented_and_automated_accepted |
| DPR-017 | GridStrategyService、conditional_buyback GridPlan、DecisionPanel | 双计划持久化；父卖单绑定契约；成交前 `awaiting_parent_fill` 且不占现金；真实页面双清单通过四视口验收 | 7 | implemented_and_automated_accepted |
| DPR-018 | 市场步长、最大余数整手分配、组合现金池 | 0.01/0.001 tick、100 整手、5,000 元跨资产预算、15:00 关闭及真实收盘后运行 | 7 | implemented_and_automated_accepted |
| DPR-019 | 四标的买回摘要与上一轮比较 | 最终真实运行逐项核对；收盘后明确 `session_closed` 与父卖单不可用，不把技术锚伪装成买回点；四视口可见 | 7、8 | implemented_and_automated_accepted |
| DPR-020 | `ScreenshotCaptureService`、总额型 `Position`、基金金额流水导入合同 | S2 最新已确认真实快照逐分对账、动态金额分桶、幂等重放和受保护表零漂移；公开矩阵不记录金额或标的 | 支付宝数据核对 | implemented_and_automated_accepted |
| DPR-021 | `AlipayOneClickReviewService`、`dailyReview.ts` 一键运行 API、数据/RRG/LLM 预检 | S2 动态当前账户合同验证无变化执行、复盘后再次声明变化但无新快照时阻断、真实 LLM 门禁和失败不冒充成功 | 支付宝一键运行 | implemented_and_automated_accepted |
| DPR-022 | `AllocationPolicyService`、`AlipayOneClickReviewService`、RRG 后续批次门禁 | 六项名义金额独立复算；5/25/25/45 偏离、流水约束、完整净值日和后续批次状态通过私有真实数据验收 | 支付宝报告复核 | implemented_and_automated_accepted |
| DPR-023 | `DailyReviewSynthesisService` 严格白名单与重试历史 | 首次失败证据保留；确定性数据仍新鲜时显式重试；新增数值、标的或事实均被拒绝 | LLM 摘要复核 | implemented_and_automated_accepted |
| DPR-024 | `AdviceExecution`、`AdviceAction`、`DailyReviews.tsx` 决定交互 | 接受/修改/拒绝只写审计决定；阻断项不可操作；Transaction、Position、外部订单零变化 | 人工计划交互 | implemented_and_automated_accepted |
| DPR-025 | `AnalysisWorkflowProfile`、工作流合同哈希 | 同版本合同漂移阻断；合同版本、步骤、用途和执行边界可重放 | 工作流合同复核 | implemented_and_automated_accepted |
| DPR-026 | `AlipayResearchWorkflowService`、`/portfolio-comparison`、`PortfolioComparison.tsx` | 三场次入口完成真实 HTTP 运行并关联 Operation/DailyReviewRun；历史读取保存结果不重算 | 固定入口体验 | implemented_and_automated_accepted |
| DPR-027 | `AlipayResearchWorkflowScheduler`、授权/租约/幂等合同 | 七天授权到期、撤销和截图变化均阻断；默认关闭；09:40/14:40 时槽及重复运行收敛通过 | 调度授权复核 | implemented_and_automated_accepted |
| DPR-028 | `AlipayPortfolioComparisonService`、压缩快照与 SHA-256 校验 | 私有真实运行保存完整行情、曲线、交易事件、规则和摘要；损坏/缺失拒绝静默重算 | 历史证据复核 | implemented_and_automated_accepted |
| DPR-029 | `AlipayPortfolioComparisonService` 双窗口径、`PortfolioComparison.tsx` | 连续路径切片和窗口重启共享同一快照与有效区间；不足 20 个共同交易日阻断 | 双窗口径体验 | implemented_and_automated_accepted |
| DPR-030 | `AllocationPolicyService`、`AnalysisWorkflowProfile`、LLM 投影和页面用途标签 | 5/25/25/45 仅进入手工草案，10/25/40/25 仅进入研究比较；API、调度、LLM 和页面均保持隔离 | 用途边界复核 | implemented_and_automated_accepted |

## 产品化工作台映射

| 页面区域 | 路由/组件责任 | 覆盖需求 | 产品化状态 |
| --- | --- | --- | --- |
| 运行与历史 | `/daily-reviews`、运行栏、历史选择器 | DPR-001、DPR-008 | implemented_and_automated_accepted |
| 十节点 DAG 审计 | DailyReviewWorkflowDag、DailyReviewAuditDrawer | DPR-001～DPR-030 | implemented_and_automated_accepted |
| 资产价格与均线 | AssetTrendChart | DPR-003 | implemented_and_automated_accepted |
| 事实、策略与关注项 | ResearchAssessment、DailyReviewDecisionPanel | DPR-004～DPR-006、DPR-012～DPR-015 | implemented_and_automated_accepted |
| 网格与历史比较 | DecisionSummary、OrderPlan、DerivationTrace、GridPlanTable | DPR-007、DPR-008、DPR-014、DPR-015、DPR-017～DPR-019 | implemented_and_automated_accepted |
| 截图台账 | 复用 ScreenshotCapturePanel | DPR-002、DPR-009、DPR-016 | implemented_and_automated_accepted |
| 执行锁 | ExecutionBoundaryBanner | DPR-010 | implemented_and_automated_accepted |
| 支付宝一键复核 | AlipayOneClickReviewService、DailyReviews 支付宝工作区 | DPR-020～DPR-024 | implemented_and_automated_accepted |
| 持久化组合研究 | AlipayResearchWorkflowService、PortfolioComparison | DPR-025～DPR-030 | implemented_and_automated_accepted |

总体状态：需求追踪覆盖 `30/30`，DPR-001～DPR-030 均有实现和自动化证据。S2 在 2026-09-11 行情与最新已确认账户快照上重新完成全账户、持久化研究、组合回测、ChatBox、真实 API 和 24 张 headless 截图回归；DPR-020～DPR-030 的金额断言、截图和原始报告仅保存在 Git 忽略的本地私有目录，公开矩阵只记录脱敏结论。人工验收未执行。

延期项：六项正式发布外部门禁及权威基线未冻结的 V2-PX 需求不计入本矩阵完成率。
