# C1-T 前瞻影子 readiness — Codex 验收

**合同：** `dlv3.c1t-forward-shadow-readiness.v1`  
**合同 SHA-256：** `52be77eee6ba69d234027176a8a585d2d6eacbf3344c076cea2276e334aeac62`  
**C0：** `DLV3-C1T-SHADOW-C0-20261031T095521Z`（保留，未接受）  
**最终候选：** `DLV3-C1T-SHADOW-CODEX-FIX-20261031T101000Z`  
**结论：** `READINESS_ACCEPTED_AWAITING_HUMAN_SHADOW_START`

## 1. 冻结内容

C1-T 只组合已经检查过的两项机制：C1 的 5% 单股、25% PIT 行业、70% 总权益上限，与
Stage 14 已接受实现中的 U3 GREEN/AMBER/RED 状态机。它不改选股、评分、breaker、状态机
参数或交易语义，不增加第三个历史参数试验。

输入身份被固定为：

- C1/C2 R1 result SHA-256：`fc643e0ce7bfc6914ee456f008bce61bac241cca54ad0c610529952e7721c079`；
- selector target surface SHA-256：`987fa0fd9ec87535240eb8c15a675bb4699a685b81cc135439cad5a8043c5617`；
- U3 直接调用 `adaptive/state-machine.ts`，没有复制状态机。

## 2. 实现与纠正

新增 `c1t-shadow/contracts.ts` 和 `c1t-shadow/plan.ts`，生成只读 `review_buy/review_sell/hold`
意图。所有计划固定 `canCreateOrder=false`、`brokerWriteAllowed=false`、
`capitalAuthority=false`、`productionDatabaseAllowed=false`。

实现过程中测试捕获一个调用缺陷：若只把单个决策日传给 U3 状态机，状态会因没有连续
路径而永久 RED。最终实现传入完整的历史状态日历，并仅加入一个不进入因果窗口的决策日
索引标记；决策状态只使用此前 B1 值。上升夹具确认 RED 经两级五日滞后恢复到 GREEN。

C0 封存后的 Codex 审查又发现缩仓顺序错误：它先乘 U3 multiplier，再累计行业/总量配额，
会在 RED 状态把更多名字纳入组合。C0 原样保留且不被接受。Codex-owned root fix 改为先形成
完整 C1 配置身份，再对每个已配置权重统一缩放；新增差分测试证明 GREEN 与 RED 的标的身份
相同，RED 总权重恰为 70%/3。没有新增参数、历史绩效运行或经济试验。

## 3. 验证

- unit：13/13，0 failed，0 skipped；
- control→fault→recovery：5/5，覆盖未来数据、未对账持仓、重复候选、半日行情和 release
  身份漂移；
- 独立公式验证：0 finding；20 个输入候选形成 14 个目标、总权重恰为 70%，行业均不超过
  25%；验证器不调用 C1-T plan builder 做目标边界复算；
- 全 backend TypeScript 与 DLV3 scripts TypeScript：exit 0；
- 最终候选 17 个文件，`sha256sum -c SHA256SUMS` 全部通过；seal SHA-256
  `7cc3a948036a79fc754cb9caca6de13d3c7480c4ec7759b30723a35d1c9cb5bb`。

## 4. 投资判断和风险边界

C1 的历史描述性结果优于 U2 的资金利用率，但证据强度仍低：年化 2.26%、Sharpe 0.568、
最大回撤 7.49%、平均权益仓位 12.64%，且短持有期正收益比例没有改善。U3 在既有历史中
降低了收益效率，因此 C1-T 不是“更优策略”的结论，而是事前冻结的风险缩放观察臂。

空候选会明确输出全现金，不会放宽门槛。影子硬 breaker 包括 5%/25%/70% 超限、理论回撤
超过 5%、累计收益低于 -3%、连续两次缺失快照、任何身份/PIT/对账/租约/禁止能力问题。

## 5. 下一门限

本次没有读取当前行情、没有运行历史绩效、没有启动服务或 scheduler，也没有访问生产库、
MCP、券商、订单或资金。下一步只能在人工批准
`HUMAN_C1T_SHADOW_START_AUTHORIZATION` 后冻结首次前瞻快照并开始零资金人工影子。

影子至少完成 20 个真实交易日（40 日优选）才能请求 Stage 18。周一小规模实盘不在本次
授权内；Stage 18 仍需精确账户、最高资金、人工计划、备份/对账、回滚和 kill switch 的
单独人工批准，且最高不得超过另行批准目标资本的 5%。

