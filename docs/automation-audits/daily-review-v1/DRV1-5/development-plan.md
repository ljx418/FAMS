# DRV1-5 数据契约与可复算推导链开发计划

日期：2026-08-21

## 目标

- 每日复盘读取本地深度事实缓存并显式标记证据新鲜度，禁止浅层缓存把缺证据误报为 `none`。
- 将价值评估基线与技术网格锚分开保存；价值评估不伪装成目标价。
- 扩展网格结果，保存锚点、ATR 间距、额度、整手归一化和分侧门禁的可复算输入。
- 将十节点工作流升级为显式无环依赖图契约。

## 验收标准

- 工作流十个节点均有非空 `purpose`，全部边引用合法节点且拓扑无环。
- 个股报告包含 valuation status/band/score/confidence/method；ETF 明确 `not_applicable`。
- 已验证重大变化只阻断买入；证据不足阻断双向；全局行情门禁仍阻断双向。
- 所有订单价格、数量均可由保存的 derivation 独立复算。
- 不修改持仓、交易或外部订单观察数据。

## 实施顺序

1. 扩展 GridStrategyService 的输入、分侧门禁与 derivation 输出。
2. DailyReviewService 接入深度缓存事实和价值评估，生成 decisionSummary。
3. DailyReviewWorkflowService 增加 purpose、dependsOn 和 edges。
4. 更新契约、专项测试和真实数据验收脚本。
