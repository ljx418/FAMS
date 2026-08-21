# DRV1-4 开发前审计

日期：2026-08-20  
结论：`PASS — 允许一次受控真实运行`

## 入口事实

- `default` 当前 7 个 open 持仓，其中 6 个非现金资产；最新真实复盘 `3686c4e5…` 状态 completed。
- 最新复盘有 6 个 PositionSnapshot、6 个 MarketSnapshot、6 个 GridPlan、12 个 GridOrderDraft；provider 为 `sina`。
- 已确认截图台账为 1 份 capture、7 行 confirmed。
- DRV1-0～DRV1-3 均已通过，未关闭致命/重大规格偏差为 0。
- 四项交易权限当前均 false；本阶段没有权限改变授权。

## 风险与闭环

| 风险 | 等级 | 进入开发前闭环 |
| --- | --- | --- |
| 真实验收破坏持仓/交易 | 致命 | online backup + 三表前后哈希 + 运行前明确允许写表 |
| 重复触发多轮复盘 | 重大 | 唯一幂等键，脚本只调用一次并验证新增 review 数为 1 |
| fixture 被冒充真实行情 | 重大 | provider/source 全文拒绝 mock/fixture/workflow_test |
| MA 只看展示值不验数学 | 重大 | 从 30 个收盘点独立重算三条均线 |
| 自动浏览器误触视觉模型 | 重大 | 不点击 vision-extract；断言请求数 0 |
| 自动化结果冒充人类验收 | 重大 | humanAcceptanceStatus 固定 not_performed |
| 并发任务污染哈希判断 | 重大 | 哈希只覆盖 Position/Transaction/ExternalOrderObservation，并记录运行窗口 |
| SQLite DrvFS 大小写别名 | 重大 | DRV1-3 已修复为仓库实际路径大小写，独立 Prisma 连接已通过 |

未关闭致命意见：0。  
未关闭重大意见：0。  
允许执行一次受控真实复盘；若受保护表漂移或 provider 不真实，立即停止并从备份取证，不继续产品状态晋级。
