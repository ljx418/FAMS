# DRV1-10 验收审计：可交易网格约束与条件买回

日期：2026-08-25（Asia/Shanghai）

## 结论

结论：**PASS**。机械约束契约、真实账户服务验收和执行隔离均通过；人类验收状态为 `not_performed`。

## 确定性契约

`npm run test:daily-review-v3-grid-contract` 通过：

- A 股价格步长 0.01 元，ETF 价格步长 0.001 元。
- 买价向下、卖价向上取整；数量为 100 股/份整数倍。
- 一手跨三档按最大余数分配为 `[100, 0, 0]`，没有被逐档取整全部抹掉。
- 5,000 元组合级预算在两个资产间合计使用 4,969.40 元，未超配。
- 三项真实形态的父卖单分别生成一项条件买回，状态均为 `awaiting_parent_fill`，父计划和父订单 ID 可核对，`consumesImmediateCashBeforeFill=false`。
- 上海时间 15:00 后即时网格返回 `session_closed`，订单数为 0。

## 真实数据端到端验收

- 运行端口：隔离加载当前源码的 `http://127.0.0.1:4100`。
- 真实复盘编号：`ee2e00b7-a490-499c-94f0-5a5c72b4715f`。
- 真实行情来源：六项资产全部为 `sina`，区间 2026-07-15 至 2026-08-25，各 30 个完整收盘价；MA5/MA10/MA30 独立重算完全一致。
- 持久化：六项资产各保存一份即时计划和一份条件买回计划，共 12 个 GridPlan。
- 运行时间已为 16:49（Asia/Shanghai），因此 12 个计划均按规格输出收盘后观察结果，GridOrderDraft 为 0；没有伪造仍有效的当日订单。
- Position、Transaction、ExternalOrderObservation 三类受保护数据前后哈希完全一致。
- 固定四项交易权限均为 false。

## 打回与修复记录

首次真实验收命中了 4000 端口的旧长驻进程，错误地产生旧版 6 个单网格计划和收盘后订单，并因“缺少条件买回 GridPlan”失败。该轮编号 `3ee05cc4-ef70-4586-8c9d-38bac3213cf8` 被明确判定为失败证据，不用于验收。随后在 4100 端口冷启动当前源码，重新运行并通过。

## 构建与回归

- `backend npm run build`：PASS。
- `npm run test:daily-review-v2-contract`：PASS，重大变化仍只阻断买侧，卖侧风险降低草案逻辑未回归。
- `npm run test:daily-review-v3-grid-contract`：PASS。
- `npm run test:daily-review-real-data-e2e`（4100 端口）：PASS。

## 剩余说明

由于真实运行发生在收盘后，本阶段没有把任何价格展示为“当前仍可挂单”。重点标的会在 DRV1-11 页面明确显示 `session_closed`，并在下一个交易时段重新运行后展示当日有效价位；这不是验收缺失，而是 DPR-018 的强制安全结果。
