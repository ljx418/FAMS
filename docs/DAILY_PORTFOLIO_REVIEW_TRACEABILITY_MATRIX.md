# 每日持仓复盘需求追踪矩阵

更新时间：2026-08-27

| 需求 | 主要实现 | 自动化证据 | 人类验收项 | 当前状态 |
| --- | --- | --- | --- | --- |
| DPR-001 | DailyReviewService、ChatBox tool、可选 Scheduler | `test:daily-review-workflow` 的场次与幂等断言 | 1、4 | implemented_and_automated_accepted |
| DPR-002 | ScreenshotCaptureService、PositionSnapshot | 缺失持仓保持 open、`missingHoldingsClosed=0` | 2、3、8 | implemented_and_automated_accepted |
| DPR-003 | AssetTrendService、MarketSnapshot、ChatBox chart/detail | 真实 6 个非现金持仓均为新浪源、各 30 点、MA5/10/30 独立重算一致 | 5 | implemented_and_automated_accepted |
| DPR-004 | `classifyMaterialChange`、PositionAdvice facts | 重大变化、证据不足和上一轮比较断言 | 6 | implemented_and_automated_accepted |
| DPR-005 | `strategyAssessment` 汇总 | maintain/needs_review/insufficient 分支测试 | 6 | implemented_and_automated_accepted |
| DPR-006 | 持仓关注项及 DividendLowVolDaily 候选池 | 真实运行 6 个关注项均有来源、reason 与 evidenceRefs | 7 | implemented_and_automated_accepted |
| DPR-007 | GridStrategyService、fallback template、GridPlan/OrderDraft | 真实运行 6 个 GridPlan、12 个草案档位，上一轮变化与阻断可见 | 7 | implemented_and_automated_accepted |
| DPR-008 | `GET /api/v1/daily-reviews`、latest/detail | 十节点详情、历史过滤、四视口抽屉与导出运行时验收 | 8 | implemented_and_automated_accepted |
| DPR-009 | vision status、row PATCH、preview/confirm | 真实已确认截图 1 份/7 行；共用面板与单次视觉同意边界通过 | 2、3 | implemented_and_automated_accepted |
| DPR-010 | executionBoundary、Chat/MCP permission gate | 受保护三表哈希零漂移，四项交易权限恒 false，无订单创建 | 全部 | implemented_and_automated_accepted |
| DPR-011 | DailyReviewWorkflowService、DailyReviewWorkflowDag、DailyReviewAuditDrawer | 最终真实报告验证 10 节点、17 边、purpose/dependsOn 与无环；Playwright 四视口与 Chrome CDP 通过 | 8 | implemented_and_automated_accepted |
| DPR-012 | DailyReviewSynthesisService、reportJson.llmSynthesis、llmGate | MiniMax-M2.7 强制真实门禁通过；单次调用、严格 schema/白名单/证据/数值校验，刷新零调用 | 6、7 | implemented_and_automated_accepted |
| DPR-013 | DailyReviewDecisionPanel、DailyReviewAuditDrawer | Playwright 与 Chrome CDP 确认可读摘要与高级审计分层；原始 evidence id 不内联正文 | 7、8 | implemented_and_automated_accepted |
| DPR-014 | decisionSummary、grid.derivation、DailyReviewDecisionPanel | 六资产真实确定性推导可复算；收盘后 GridOrderDraft 为 0 且页面不伪造设置清单 | 7 | implemented_and_automated_accepted |
| DPR-015 | ValueAssessmentService、GridStrategyService 分侧门禁 | 六资产真实覆盖；价值背景与技术锚分离，重大变化只触发对应风险门禁 | 6、7 | implemented_and_automated_accepted |
| DPR-016 | ScreenshotCaptureService、账户摘要预览与确认 | 2026-08-25 真实截图 1 个账户摘要 + 6 个持仓确认；精确账户金额仅保留在本地私有证据；页眉差额留痕；二次运行幂等 | 2、3 | implemented_and_automated_accepted |
| DPR-017 | GridStrategyService、conditional_buyback GridPlan、DecisionPanel | 双计划持久化；父卖单绑定契约；成交前 `awaiting_parent_fill` 且不占现金；真实页面双清单通过四视口验收 | 7 | implemented_and_automated_accepted |
| DPR-018 | 市场步长、最大余数整手分配、组合现金池 | 0.01/0.001 tick、100 整手、5,000 元跨资产预算、15:00 关闭及真实收盘后运行 | 7 | implemented_and_automated_accepted |
| DPR-019 | 四标的买回摘要与上一轮比较 | 最终真实运行逐项核对；收盘后明确 `session_closed` 与父卖单不可用，不把技术锚伪装成买回点；四视口可见 | 7、8 | implemented_and_automated_accepted |

## 产品化工作台映射

| 页面区域 | 路由/组件责任 | 覆盖需求 | 产品化状态 |
| --- | --- | --- | --- |
| 运行与历史 | `/daily-reviews`、运行栏、历史选择器 | DPR-001、DPR-008 | implemented_and_automated_accepted |
| 十节点 DAG 审计 | DailyReviewWorkflowDag、DailyReviewAuditDrawer | DPR-001～DPR-019 | implemented_and_automated_accepted |
| 资产价格与均线 | AssetTrendChart | DPR-003 | implemented_and_automated_accepted |
| 事实、策略与关注项 | ResearchAssessment、DailyReviewDecisionPanel | DPR-004～DPR-006、DPR-012～DPR-015 | implemented_and_automated_accepted |
| 网格与历史比较 | DecisionSummary、OrderPlan、DerivationTrace、GridPlanTable | DPR-007、DPR-008、DPR-014、DPR-015、DPR-017～DPR-019 | implemented_and_automated_accepted |
| 截图台账 | 复用 ScreenshotCapturePanel | DPR-002、DPR-009、DPR-016 | implemented_and_automated_accepted |
| 执行锁 | ExecutionBoundaryBanner | DPR-010 | implemented_and_automated_accepted |

总体状态：需求追踪覆盖 `19/19`，DPR-001～DPR-019 均已完成实现和真实数据自动功能验收。最终强制真实 LLM 复盘已通过；2026-08-27 使用 Playwright 完成 1440×900、1024×768、768×1024、390×844 四视口验收，并使用 Windows Google Chrome CDP 完成桌面与手机抽检。原始 JSON、截图和账户数据仅保存在 Git 忽略的本地私有目录。人工验收未执行。

延期项：六项正式发布外部门禁及权威基线未冻结的 V2-PX 需求不计入本矩阵完成率。
