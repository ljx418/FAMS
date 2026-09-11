# 第二子阶段：API、持久化与页面验收

验收完成：2026-08-31（Asia/Shanghai）

## API 与持久化

- `/run` 支持 `ruleMode=registry_fixed` 和周度起投敏感性配置。
- 新增轻量 `/fixed-rule-detail`，图二点选起投日时只生成固定规则主明细，不重复生成敏感性网格。
- 新增运行历史与详情读取接口，按用户读取 `portfolio_backtest_run`。
- Operation 新增 23/24/25 三项产物：固定规则主结果、交易台账、起投敏感性。
- 兼容API契约测试通过，旧 `classicPortfolioStudy` 协议未删除。

## 页面

- 图一支持总资产、累计盈亏、实际权重；权重视图可聚焦具体组合。
- 图二支持逐策略最高浮盈/年化收益/最大回撤，以及横截面最高收益/平均收益/最差回撤。
- 两图共享策略选择；点击图二或无障碍起点按钮会加载对应起点的图一和交易流水。
- 页面可从“打开已保存回测”恢复Operation结果。
- 固定规则路径不展示“优选规则”或基于历史表现的调仓建议。

## 浏览器证据

- 最新 E2E：`backend/data/gpt-audit/interactive-strategy-backtest/2026-08-30T16-05-13-221Z/03_frontend_runtime_and_operation_audit.json`
- `fixedRuleDetailRequestCaptured=true`
- `savedRunDetailRequestCaptured=true`
- 两张图均有有效 canvas，关键文字无缺失，控制台错误为 0。

## 审计结论

API、持久化、双图交互和历史恢复均通过。仅保留既有 Vite 大分块告警，属于非阻断性能风险；无致命或重大规格偏差。
