# DRV1-2 开发计划：正式每日复盘工作台

日期：2026-08-20  
状态：已完成

## 目标

将批准原型的核心信息架构接入正式 React 应用，完成运行、历史、十节点、价格均线、研究判断、关注标的、网格和执行锁展示。

## 路由与组件

- `/daily-reviews`：打开最新复盘或真实空状态。
- `/daily-reviews/:reviewId`：可恢复、可分享的具体复盘深链。
- 导航放在“资产与组合”分组；ChatBox 历史和结果可跳转到工作台。
- 页面组件：ReviewCommandBar、ReviewSummary、WorkflowRail、NodeInspector、AssetTrendChart、ResearchAssessment、AttentionList、GridPlanTable、ExecutionBoundaryBanner。

## 交互

1. 选择 open/pre_close/manual，确认后使用唯一幂等键启动一次 inline 复盘。
2. 历史列表支持场次和状态筛选，选择后更新 URL。
3. 点击节点独立检查输入、输出、证据和阻断项。
4. 切换资产查看真实最新价、来源、30 点收盘与 MA5/10/30。
5. 网格只展示数据库草案和观察计划，不提供下单按钮。

## 出门标准

- 前后端构建通过。
- 页面无硬编码原型行情或网格数据。
- 正式路由、导航和深链存在。
- 页面静态合同覆盖十节点、30 日图、三条均线、关注项、网格与四项锁。
- 截图导入本阶段保持指向既有 ChatBox；组件复用在 DRV1-3 完成。
