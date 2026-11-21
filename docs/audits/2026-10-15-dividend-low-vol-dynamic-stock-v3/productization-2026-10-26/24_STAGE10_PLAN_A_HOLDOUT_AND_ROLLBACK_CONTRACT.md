# DLV3 Stage 10 方案 A：一次性揭盲、基线保存与版本回退合同

**合同版本**：`dlv3.stage10-plan-a.v1`  
**状态**：Frozen / authorized by user on 2026-10-28  
**实施 owner**：Codex  
**统计 attempt**：`C0`，唯一一次；第一次打开任何 final hold-out value 即消费  
**最终人工门限**：Gate 10 接受、拒绝或不确定；任何结果均不自动激活生产

## 1. 目标与非目标

目标是在不改变冻结策略、代码、数据身份、分母、费用或判定阈值的前提下，对
`2025-10-01..2026-09-30` 执行一次 sealed final hold-out 揭盲，并由独立实现复算。

本 Stage 同时保证：

1. 揭盲前的 `3.0.0-research`、Gate 6 基线、Gate 7B 研究 artifact、Gate 8 UI 和 Gate 9A
   shadow 合同保持原字节、可追溯；
2. 结果不佳时只阻止晋级，不覆盖、不删除、不重新解释既有基线；
3. 后续改进必须创建新的 release identity 和新的 development Stage，不能把已揭盲区间再次
   当作未知 hold-out；
4. Gate 9B 生产 scheduler、生产 DB、MCP、券商、订单和自动交易继续关闭。

非目标：参数搜索、重新选臂、替换基准、改变费用/税制、补选最好窗口、生产激活、订单创建、
用揭盲结果改写 `3.0.0-research`，或因结果不好而再次运行。

## 2. 冻结研究基线

揭盲前必须先生成并封存 `25_STAGE10_PRE_REVEAL_BASELINE_MANIFEST.json`。权威基线包括：

- release：`dividend_low_vol_stock_v3 / 3.0.0-research`；
- release auditHash：`c4feebed2d5512942fce748f1bca7da5204846cb70a0b902879b9330cf42e689`；
- protocolHash：`5b9e690c63b5972097401f0ee2c16c9f5af9e114188015a776e824a57f6ad9bd`；
- Gate 6：`P4-RUN-G6-CODEX-20261026T080500Z`，payload tree
  `35ff4380dc95dcd9eca89ab6e055bd44c345cb3b6ff5c547e2feb9c11fd90018`；
- Gate 7B artifact：`c7d043ee9a9a95f82b8a04922e426479d4e1d18d6bd2e453bdf21e812c0790ec`；
- Gate 7B denominator：`03e0d7b767bab392aacc15db5a67cf6ba4c06967a10416716036ece6b35bd76b`；
- Gate 8 和 Gate 9A acceptance receipt identity；
- 冻结中心参数、风险自由利率口径、税费、成交、持仓生命周期和 R0/R1/R2/B0/B1/P0
  角色定义。

基线保存采用“已有 sealed bytes + 独立 manifest 引用”的方式，不复制或重写旧候选。任何基线
identity/hash 漂移在 value open 前返回 `BLOCKED_IDENTITY_DRIFT`，不消费统计 attempt。

## 3. 方案 A 的预注册判定

工程正确性与投资结果分开判定。工程失败不得包装成策略失败；投资表现不佳不得包装成工程失败。

对 R0/R1/R2 分别完整报告；R1-R0、R2-R1 只做预注册 paired attribution。不得在揭盲后选择
表现最好的臂作为事先主臂。策略家族按以下固定层级分类：

| 等级 | 固定条件 |
| --- | --- |
| `STRONG_TARGET` | Sharpe `>= 1.0`、最大回撤 `<= 8%`、相对 B0 与 B1 的总收益差均 `>= 0` |
| `RESEARCH_TARGET_MET` | Sharpe `>= 0.8`、最大回撤 `<= 8%`、相对 B0 总收益差 `>= 0` |
| `MINIMUM_VIABLE` | 总收益 `> 0`、Sharpe `>= 0.5`、最大回撤 `<= 10%` |
| `RESEARCH_REJECTED` | 未达到 `MINIMUM_VIABLE`，或风险/损失结果违反冻结风险条件 |

分类按每个策略臂分别输出；策略家族摘要必须同时展示三臂，不能用 best-of-three 代替。B1 是正式
主比较，P0 永远只作 proxy 旁证。阈值是 Stage 10 决策标签，不反向修改 Gate 7B 研究结论，也不
自动授权上线。

下列情况返回 `INCONCLUSIVE` 而非投资失败：身份漂移、覆盖不足、账本/归因不守恒、独立复算不一致、
基准语义错误、非有限值或不可恢复的运行中断。

## 4. 唯一揭盲工作流

```text
AUTHORIZED
  -> FREEZE_PRE_REVEAL_BASELINE
  -> PREFLIGHT_IDENTITIES_AND_DENOMINATORS
       -> BLOCKED_BEFORE_OPEN        # attempt 未消费
       -> OPEN_FINAL_HOLDOUT_ONCE     # attempt 在首个 value open 原子消费
            -> RUN_FROZEN_R0_R1_R2_B0_B1_P0
            -> SEAL_RAW_RESULT_AND_EXPOSURE_LEDGER
            -> INDEPENDENT_RECOMPUTE
                 -> VALID_RESULT
                      -> STRONG_TARGET / RESEARCH_TARGET_MET /
                         MINIMUM_VIABLE / RESEARCH_REJECTED
                 -> INCONCLUSIVE
            -> HUMAN_GATE_10
```

首个 value open 后，只允许以完全相同的 input/code/release/denominator/contract hash 恢复同一
attempt。不得改变代码后重跑，不得建立第二个 C0/R1，不得用新 runId 获得新的统计尝试。若 correctness
缺陷需要改变任何冻结 identity，本次结果封存为 `INCONCLUSIVE`，后续必须等待新的、未暴露评估窗口。

## 5. 失败回退与后续研究分支

Stage 10 不修改活动生产指针，因此正常回退是“保持揭盲前状态”：

- `3.0.0-research` 保持 `frozen_research`，不原位升级、不删除；
- Gate 9A development shadow 可继续作为历史只读基线，但 Gate 9B scheduler 仍 disabled；
- 未达标的 Stage 10 候选标记 `research_rejected`，不得 promotion；
- 揭盲数据、负结果、失败窗口、日志和 exposure ledger 全部封存，禁止从报告分母删除；
- UI/API 必须同时展示基线身份、揭盲结果和“未晋级/不确定”状态，不得回退成无结果。

若要改进策略，创建新 scope（建议名 `DLV3-STAGE10-RD1`）并满足：

1. 新 releaseId/version/auditHash；不能覆盖 `3.0.0-research`；
2. 以明确因果假设列出相对基线的经济逻辑 delta，优先复用数据、账本、统计和 UI，不进行全量推倒；
3. 已揭盲的 `2025-10-01..2026-09-30` 只能作为 exposed diagnostic，不能再充当验证或 hold-out；
4. 新版本必须重新走 development/validation/robustness，最终晋级需要新的未来未暴露窗口或足够长的
   forward shadow；
5. 不得因为 Stage 10 表现选择参数邻域中的最佳点并宣称其为预注册结果。

## 6. 并发、超时和恢复

- 唯一 owner 为 Codex；其他 Agent 只能只读审查，不能修改 Stage 10 输入、代码或 artifact；
- 揭盲过程中禁止另一个 writer 写输出根；使用 owner lease 和 append-only exposure ledger；
- value open 前超时/外部数据缺失：`BLOCKED_EXTERNAL`，attempt 未消费；
- value open 后进程中断：保留部分 artifact，只能按相同 hashes 幂等恢复；
- 任一 hash、exact-set、seal 或 lease 冲突：立即停止，不做自动清理，不删除部分证据。

## 7. 验收与负控

揭盲前必须通过：

1. baseline manifest、合同、Gate 6/7B/8/9A identity 全部匹配；
2. frozen release、代码闭包、输入 manifest、denominator、费用/税制和基准角色精确匹配；
3. 0 hold-out reads 的 preflight trace；
4. 第一次 value open 与 attempt-consumed receipt 原子绑定；
5. 修改参数、替换臂/基准、删除亏损分片、best-of-three、第二 runId、后写 manifest、hash 漂移均被负控拒绝；
6. 日账守恒、归因守恒、coverage、时间边界与 independent recomputation 全部通过；
7. 揭盲结果无论好坏均封存，展示真实 failed/blocked/inconclusive；
8. production DB/scheduler、MCP、broker/order 和自动交易触达均为 0。

Gate 10 的有效结论只有：`ACCEPTED_RESEARCH`、`REJECTED_RESEARCH` 或 `INCONCLUSIVE`。前两者表示
统计 attempt 有效，后者表示结果不能用于投资结论。三者都需要人工最终确认，且都不等于生产授权。

## 8. 授权边界

用户在 2026-10-28 明确同意按方案 A 揭盲，并要求失败时可回退且保存研究基线。本授权只覆盖：

- 冻结揭盲前基线；
- 对精确区间 `2025-10-01..2026-09-30` 的唯一一次 Stage 10 value read；
- 冻结策略家族和基准的预注册运行、独立复算、封存与人工 Gate 10 报告。

本授权不覆盖生产数据库写入、生产服务或 scheduler 启动、网络补采、schema migration、MCP、券商、
订单、实盘或对既有 release 的原位修改。
