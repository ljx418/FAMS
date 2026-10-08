# WORKFLOW: 交易事实采集与对账

**版本**：1.0  
**日期**：2026-10-08  
**状态**：Implemented / Verified 2026-10-08

## 目标与参与者

把宿主视觉、截图、CSV 或人工提供的成交事实转换成去重、可确认、可追溯的本地台账，并与最新持仓、现金和可卖数量进行对账。用户是事实确认者；宿主只负责提供结构化输入；FAMS 负责校验、保存和对账。

## 前置条件与触发

- 用户和资产身份已存在；图片由宿主识别时必须提供原始 capture 引用。
- 触发：截图提取、交易导入、人工补录，或每日复盘前检。
- 没有新成交时，用户可以提交有时间范围的显式零成交确认。

## 工作流树

1. `STAGE_INPUT`：保存来源、覆盖窗口、输入哈希和原始证据，状态 `staged`。
   - 相同输入哈希与账户范围重复：返回原批次。
   - 来源缺失或时间无效：400，无业务写入。
2. `NORMALIZE_AND_VALIDATE`：规范代码、方向、数量、价格、费用、时间和外部编号。
   - 行级错误进入 blocked；其余行继续预览。
   - 同一外部编号但经济事实冲突：整批 `blocked`，禁止确认。
3. `DEDUPE_PREVIEW`：按外部编号、import key、capture row、组合指纹分为 new/duplicate/conflict/low-confidence。
4. `HUMAN_CONFIRM`：要求确认人和 `apply|record_only`。
   - `record_only` 创建 Transaction 但 Position/Cash 哈希必须保持不变。
   - `apply` 在单一数据库事务中写 Transaction 并更新 Position/Cash，一次且仅一次。
5. `RECONCILE`：读取最新已确认持仓、资金、成交和委托覆盖，保存不可变对账运行。
6. `PUBLISH_READINESS`：输出 `ready|warning|blocked` 和可恢复动作，供策略工作流门禁使用。

## 失败、并发和恢复

| 分支 | 数据库状态 | 用户可见 | 恢复 |
| --- | --- | --- | --- |
| 输入格式错误 | batch failed/row blocked | 具体字段错误 | 修正后新建或重新预览 |
| 重复输入 | 原批次/原交易复用 | 标记 duplicate | 无需操作 |
| 外部编号冲突 | batch blocked | 两份事实差异 | 人工选择正确来源，不覆盖旧值 |
| 并发确认 | 唯一键保证一个提交成功 | 另一个返回 idempotent/conflict | 刷新预览 |
| 写入中途失败 | 事务回滚，batch failed | 无部分仓位变化 | 修复后使用同幂等键重试 |
| 持仓变化无成交 | reconciliation blocked/warning | “不编造成交” | 补成交或确认仅采用快照 |
| 委托截图缺失 | warning | 新增前人工查重 | 上传截图或明确零委托 |

## 可观测状态

- 用户：看到批次状态、覆盖时间、新增/重复/冲突数、position-effect 和对账等式。
- 操作者：能按 batch/reconciliation id 查询输入哈希、错误码和恢复动作。
- 数据库：已确认事实追加保存；对账结果不可覆盖。
- 日志：记录 id/user/source/hash/counts，不记录图片正文或账户敏感内容。

## 交接合同

输出至少包含：`ingestionBatchId`、`coverage`、`positionEffectPolicy`、`counts`、`reconciliationRunId`、`readiness`、`differences`、`evidenceRefs` 及四项交易权限锁。

超时：本地数据库步骤 10 秒；宿主视觉不在本工作流内。超时不得重放已提交事务，重试必须通过批次幂等键解析。

## 核心测试

对应开发计划 AC-01 至 AC-06、AC-17、AC-19、AC-20。

实现入口：`TradeLedgerService`、`TransactionService`、`ScreenshotCaptureService`、`BrokerReviewReconciliationService`、`/api/v1/trade-ledger/*` 与同名 MCP 工具。验收结果记录于 `../audits/2026-10-08-trade-plan-ledger/README.md`。
