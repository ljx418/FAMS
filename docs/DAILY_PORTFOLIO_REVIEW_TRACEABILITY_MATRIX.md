# 每日持仓复盘需求追踪矩阵

更新时间：2026-08-21

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

## 产品化工作台映射

| 页面区域 | 路由/组件责任 | 覆盖需求 | 产品化状态 |
| --- | --- | --- | --- |
| 运行与历史 | `/daily-reviews`、运行栏、历史选择器 | DPR-001、DPR-008 | implemented_and_automated_accepted |
| 十节点审计 | WorkflowRail、NodeInspector、EvidenceDrawer | DPR-001～DPR-010 | implemented_and_automated_accepted |
| 资产价格与均线 | AssetTrendChart | DPR-003 | implemented_and_automated_accepted |
| 事实、策略与关注项 | ResearchAssessment、AttentionList | DPR-004～DPR-006 | implemented_and_automated_accepted |
| 网格与历史比较 | GridPlanTable、PreviousRunComparison | DPR-007、DPR-008 | implemented_and_automated_accepted |
| 截图台账 | 复用 ScreenshotCapturePanel | DPR-002、DPR-009 | implemented_and_automated_accepted |
| 执行锁 | ExecutionBoundaryBanner | DPR-010 | implemented_and_automated_accepted |

总体状态：需求追踪覆盖 `10/10`；十节点工作台与共享截图工作流已完成真实数据自动功能验收；人工验收未执行。自动验收证据见 `docs/automation-audits/daily-review-v1/DRV1-4/acceptance-audit.md`。

延期项：六项正式发布外部门禁及权威基线未冻结的 V2-PX 需求不计入本矩阵完成率。
