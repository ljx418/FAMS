# DRV1-5 数据契约与可复算推导链验收审计

日期：2026-08-21
结论：`REAL_DATA_ACCEPTANCE_PENDING — CODE_AND_CONTRACT_PASS`

## 已通过

- 后端 TypeScript 构建通过。
- `test:daily-review-v2-contract` 通过：重大变化场景生成 2 个卖出草案、0 个买入草案；证据不足场景保持全局阻断。
- 网格结果保存 `fams.grid-derivation.v1`，覆盖锚点、ATR 间距、资金/仓位容量、整手归一化和 global/buy/sell 分侧门禁。
- 工作流契约升级为 `fams.daily-review-audit-workflow.v2`；专项测试确认 10 个节点、17 条合法边、非空 purpose/dependsOn 和拓扑无环。
- 报告契约升级为 `fams.daily-portfolio-review.v2`，包含 valuationContext 与 decisionSummary；个股价值背景不生成目标价。

## 恢复后状态与未执行项

- SQLite 主库已从完整性为 `ok` 的最新快照恢复；恢复后的工作流、审计工作流和数据库复检通过。
- 真实六持仓新 v2 复盘未在恢复后重新执行，尚未生成可用于逐资产验收的新报告。
- 因此“真实资产 derivation 可复算”“真实 decisionSummary 与数据库 GridOrderDraft 逐项相等”仍未完成验收。
- 受保护表没有被本阶段主动修改；验收脚本已在调用前落盘数量与规范化 SHA-256。

未关闭致命代码规格偏差：0。
未关闭重大产品代码偏差：0。
未关闭重大基础设施风险：0（原损坏库已隔离保留，当前主库复检为 `ok`）。
未完成真实验收项：1（六持仓新 v2 复盘）。

不得把本结论升级为完整真实验收通过。完成维护窗口真实 E2E 前，DRV1-5 保持 pending。
