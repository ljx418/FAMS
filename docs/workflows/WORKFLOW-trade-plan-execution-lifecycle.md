# WORKFLOW: 人工交易计划与执行生命周期

**版本**：1.0  
**日期**：2026-10-08  
**状态**：Approved for controlled implementation / implementation in progress  

## 目标与参与者

确保仓位调整复盘和轮动波动策略的每条人工计划都持久化，并能与用户在券商侧产生的委托观察、部分成交和最终成交建立可审计关系。系统仍不创建券商订单。

## 工作流树

1. `PREFLIGHT`：读取最近有效对账。blocked 时只允许研究，不生成精确价格/数量。
2. `FREEZE_INPUT`：保存不可变研究快照及策略运行，幂等键冲突时复用同一运行。
3. `BUILD_RESULT`：运行现有 MA/RRG/网格逻辑，不改变策略公式。
4. `PERSIST_PLAN`：
   - 新草案创建 GridPlan/GridOrderDraft，并返回稳定 ID。
   - 有效旧计划被复用时引用旧 ID，不复制。
   - 新计划替代旧计划时追加 superseded 事件并保留 previousPlanId。
5. `OBSERVE_BROKER`：后续截图只写 ExternalOrderObservation/Transaction，不宣称系统下单。
6. `MATCH_EXECUTION`：
   - 显式 draft id 或外部编号唯一映射可确认为 exact。
   - 组合规则只生成 suggested；多个候选必须人工选择。
   - 无候选标记 unmatched/unplanned。
7. `DERIVE_LIFECYCLE`：根据已确认事件聚合 submitted/partial/filled/cancelled/expired/superseded 和剩余数量。
8. `REPLAY_AND_SCORE`：历史回放分别展示计划触发、模拟成交、实际执行，并报告证据覆盖率。

## 状态与约束

```text
proposed -> accepted -> submitted -> partially_filled -> filled
                       \-> cancelled
proposed/accepted/submitted -> expired
proposed/accepted/submitted/partial -> superseded
```

- 状态只能由追加事件派生；终态后不得回到活动态。
- 一条交易最多确认关联一条通用计划网格；一条计划网格可有多笔成交。
- 成交累计数量不得超过草案数量；超过时关系阻断，但真实 Transaction 保留。
- 卖出不得因匹配而突破最新可卖数量；匹配不修改真实成交事实。
- 条件回补继续受父单真实成交数量约束。

## 失败与恢复

| 分支 | 处理 |
| --- | --- |
| 数据时点过期 | 运行保存为 blocked/observe，不产生精确新草案 |
| 策略计算成功但计划落库失败 | 同一事务回滚本次运行计划，运行 failed；旧计划不变 |
| 并发同幂等键 | 复用已有 StrategyRun |
| 多候选匹配 | 保存 suggested candidates，等待人工确认 |
| 部分成交超过计划量 | 关系 blocked，真实成交保持 unmatched 部分 |
| 旧计划到期/被替代 | 追加事件，不删除计划或历史匹配 |
| 回放缺日内证据 | 返回 insufficient，不倒推成交 |

## 可观测状态

- 用户：看到运行 ID、计划 ID、来源、有效期、替代链、匹配方式、已成交/剩余数量和状态理由。
- 操作者：看到幂等键、快照 hash、事件流、候选匹配和错误码。
- 数据库：运行、计划、事件和执行关系均可独立查询。
- 日志：记录 ID 和状态变化，不输出账户敏感原文。

## 交接合同

策略结果必须包含：`strategyRunId`、`inputSnapshotId`、`snapshotHash`、每个 target 的 `gridPlanId/orderDraftIds`、`previousPlanComparison`、`manualOrderDrafts`、`permissionState`。

执行关系必须包含：`matchStatus`、`matchMethod`、`confidence`、`confirmedBy`、`transactionId|externalOrderObservationId`、`gridOrderDraftId` 和 evidence refs。

## 核心测试

对应开发计划 AC-07 至 AC-16、AC-18、AC-19、AC-20。
