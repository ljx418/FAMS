# C1-T 零资金前瞻影子开发合同

**版本：** `dlv3.c1t-operational-shadow.v1.1`  
**状态：** `FROZEN_PENDING_HUMAN_START_AUTHORIZATION`  
**Stage：** `C1T-SHADOW-L1`  
**当前 owner：** `null`（人工激活后才可指定 ClaudeCode 为唯一 C0 owner）

## 1. 前置与授权硬门

本合同只规划 readiness 之后的零资金 operational shadow。下列条件同时满足前不得实现、取数或启动：

1. checkpoint 明确激活本合同和 `109_CLAUDECODE_C1T_OPERATIONAL_SHADOW_C0_PROMPT.md`；
2. 人工固定首次 forward snapshot、最大 fact date、首次 decision/effective session 和 shadow clock；
3. checkpoint 固定 provider/endpoint allowlist、request budget、raw evidence root 和 credential policy；
4. checkpoint 固定 C1‑T readiness seal、C1 result、selector surface、U3 source、Gate 5/6 ledger source 与 policy hashes；
5. owner=`ClaudeCode`、attempt=`C0`、allowlist、forbidden actions、C0/R1 budgets 均存在且无冲突。
6. checkpoint 固定生产数据库 canonical roots 与 main/WAL/SHM 的精确 device/inode 身份；缺失时不允许实例化任何 SQLite/Prisma client。

文件存在不构成授权。缺任一条件只允许返回 `REFUSED_STALE_OR_UNAUTHORIZED_HANDOFF`。

## 2. 目标与非目标

目标是把已接受的 C1‑T plan builder 接到一个专用隔离 shadow store，以事前 prediction 和事后 realization
累计至少 20 个 distinct 合格交易日、40 日优选。它验证运营、因果、账本和重放，不证明 Alpha。

非目标：不调 C1 5%/25%/70% 上限，不改 selector/breaker/U3，不增加历史参数试验，不写生产数据库，
不启动生产 scheduler/MCP，不连接券商，不创建或传输任何外部订单，不投入资金，不实现 Stage 18。
隔离 shadow DB 内的 modeled intent/order/attempt/fill/order-state 是必须产物，不属于外部下单。

## 3. 架构

沿用模块化单体，新增边界限于：

```text
backend/src/research/dividend-low-vol-stock-v3/c1t-shadow/operational/**
backend/scripts/research/dividend-low-vol-stock-v3/dlv3-c1t-shadow-*
backend/package.json                         # 仅脚本别名
backend/tsconfig.dlv3-scripts.json           # 仅脚本纳入
backend/data/gpt-audit/.../scratch/<runId>/**
<candidate>/shadow/c1t-forward.db             # 专用隔离 SQLite
```

既有 C1‑T readiness、U3、C1 result、LONG25、Gate 5/6 模块和 artifacts 全部只读。

```text
BoundedFactAdapter -> ImmutableFactEnvelope
                    -> C1TPlanBuilder（既有、只读）
                    -> PredictionLedger（事前不可覆盖）
                    -> RealizationLedger（事后追加）
                    -> Gate5/6 Journal + Ledger + Corporate Actions
                    -> SessionQualification / ReadModel
                    -> IndependentReplayVerifier
```

业务层依赖 store/clock/provider ports，不依赖 REST、UI 或全局 Prisma。禁止第二套策略/账本引擎。

## 4. 事前/事后时序

- prediction 只由 `record-prediction --decision-date --effective-date` 创建；ID 由 canonical input hash 派生；
- `predictionRecordedAt` 由 runner 的可信时钟写入 receipt，调用方不得提供；
- `earliestOutcomeAvailableAt` 为 effective session 上海时间 09:15，若交易所正式价格发现更早则取更早者；
- 必须 `predictionRecordedAt < earliestOutcomeAvailableAt`；迟写直接拒绝发布，不能用延迟抓 realization 绕过；
- realization 只由 `record-realization --trade-date --prediction-id` 在已收盘后追加；无默认 today；
- 每个事实 envelope 保存 provider、request、retrievedAt、availability/effective time、raw bytes hash；
- prediction receipt 与其消费的完整 input exact-set 在同一事务原子提交；每个 envelope 必须已持久化，且
  `availableAt <= retrievedAt <= predictionRecordedAt`；`effectiveAt` 保留真实经济生效时点，允许晚于 receipt，
  事件只能在 `effectiveAt` 到达后影响对应 realization/ledger；禁止空 receipt、占位 receipt 或 receipt 后补输入；
- 预测、事实、realization 和 NAV 均 append-only；修订生成新 revision，绝不 UPDATE/DELETE。

## 5. 冻结经济路径

C0 必须直接复用 checkpoint 钉住 hash 的 Gate 5/6 journal、order、fill、cost、corporate-action、scheduler
和 `p4-ledger` 模块：

1. v1 强制初始持仓、acquisition lots、应收和未结算现金全部为空；初始现金 `initialEquityFen` 由启动授权固定。非零持仓迁移属于后续独立 Stage；
2. C1‑T target 只使用已接受 selector、5/25/70 caps 与既有 U3 multiplier；空候选明确全现金；
3. intent 在下一交易日 raw open 执行；禁止同 bar；卖出/降仓优先，买入按可用现金；
4. 买入向下取 100 股整手，卖出允许合规全额零股；T+1、可卖量、现金、停牌、涨停买、跌停卖、unknown 均 fail closed；
5. 未成交 intent 最多沿既有 scheduler 重试五个交易日，第六日终止；不得按后见 NAV 每日重建目标；
6. 佣金双边 5 bps、最低 10 CNY；卖方印花税按已接受 policy；slippage、红利税 FIFO、现金分红、送转、应收/付息日按 Gate 6 policy identity；
7. 日终用 raw close 计价；停牌用可验证最近有效 raw close；金额为整数 fen，现金+应收+市值=NAV，误差 0 fen。
   费用、印花税、滑点和红利税已在 p4-ledger 的现金路径扣除，只作为 attribution/利润路径独立闭合项，禁止从 NAV 二次扣减；
8. B0/B1 使用同日官方 total-return close；缺任一必需事实时整日暂停且零 NAV/fill/state 提交；
9. 月末旧状态先完成收盘计价，再封存下一 effective session 的新 prediction；换仓仍走同一生命周期。

启动 receipt 必须固定 initial equity、reconciliation、commission/stamp/slippage/dividend-tax、mark-price、
calendar/open boundary 与所有复用源文件 hash；缺失即拒绝 C0。

### 5.1 本次启动的资金口径

- operational shadow 的唯一初始现金固定为 `10_000_000 fen`（100,000 CNY）；初始持仓、lots、应收和未结算现金仍全部为空；
- 已接受的 300,000 CNY Gate 6/U2 历史基线保持不可变，不回写、不重命名、不用 100,000 CNY 结果替代；
- C0 只允许额外生成一次纯机械的 100,000 CNY 历史 scale-sensitivity：复用同一冻结信号、日期、成交与费用规则，
  不搜索第二个资金档、不调阈值、不作晋升证据；整手、最低佣金和现金利用率造成的差异必须完整披露；
- 该敏感性只能使用已接受的历史输入，禁止打开新历史窗口、最终 hold-out 或当前前瞻 realization。

## 6. 数据模型与 canonical identity

建议表及不可弱化唯一键：

- `FactEnvelope(domain, identity, factDate, contentHash)`；
- `Prediction(strategyVersion, decisionDate, inputHash)`；
- `TargetPosition(predictionId, symbol)`；
- `Realization(predictionId, tradingDate, inputHash)`；
- `DailyNav(realizationId, revision, inputHash)`；
- `SessionQualification(strategyVersion, tradingDate, revision)`；
- `Lease(scope)`，token CAS。

经济 canonical bytes 包含规范排序后的 strategy/rule/input、prediction、target、intent、fill、cash、holding、
receivable、fee/tax/action、NAV、B0/B1、qualification 和 schema version。ID 由经济字段 hash 派生。
runId、绝对路径、inode、PID、lease token、transport timestamp 不进入经济 hash，但保留在 lineage envelope。
数组按 `(tradingDate,eventSequence,symbol,eventType,derivedId)` 排序，测试使用注入时钟。

## 7. 合格 session、修订和门限

一个日期只计一次，并须：已收盘；适用 prediction receipt 早于 09:15；PIT/exact-set/交易状态/公司行动/
B0/B1 完整；账本守恒；无 identity、lease、reconciliation 或 breaker。bootstrap、unknown、paused、drift
不计 forward。19 日不达门，20 日达到最低运营证据，40 日标记 preferred。

事实变更产生新 revision；同日存在不同 completed input/result 时标记 drift，该日期不计合格 session，
保留所有版本等待人工裁决。未被经济引擎消费的披露变化不改 decision identity；被消费事实必须改变。

## 8. 并发、失败与恢复

- 两并发调用恰好一个 `recorded`，另一个返回同 identity 的 `in_progress/already_recorded`；
- 最终恰好一组 prediction/realization/NAV/fill；loser 丢 lease 后不能提交；
- 事务失败不占唯一键，winner 回滚后同日可重试；
- lease token CAS，到期接管只有一个胜者；
- 缺数据为 `blocked_external/paused`，不弱化规则、不重置 C0/R1；
- 激活 receipt 必须固定 forbidden production DB canonical roots 以及 main/WAL/SHM 的 exact device/inode；
  runner 在实例化 SQLite/Prisma 前用 `lstat -> realpath -> bigint stat` 同时比较路径和身份；相对/大小写别名、
  symlink、hardlink 或全局 Prisma import 均须在任何 DB open 前拒绝。

### 8.1 网络边界

激活 receipt 必须逐 HTTP endpoint 固定 `https` scheme、host、path、method（只允许 GET/HEAD）、查询参数域、
credential alias（默认 `none`）、最大响应字节、timeout、retry count 与总 attempt budget。每次初始请求和
每次 retry 都消耗一个 budget；redirect 默认拒绝，若某 endpoint 明确允许 redirect，则每一跳和 final URL
都必须重新通过相同 allowlist，跨 scheme/host/path 立即失败。每个 attempt 保存 request ledger、status、
redirect chain、response headers 摘要、raw bytes SHA-256 和终态；认证头/secret 不得落盘。预算耗尽返回
`blocked_external`，不得切换未授权 provider。

BaoStock 公共 SDK 是唯一允许的非 HTTP 传输例外。激活 receipt 必须钉住 package version、TCP host/port、
方法白名单、字段/日期参数域、timeout/retry 和与 HTTP 共用的总 attempt budget；只允许无凭证 login 及白名单
query 方法。任何 host/port、package bytes、方法或参数漂移都在连接前拒绝。TCP attempt 同样逐次记账并保存
规范化 request、响应原始 bytes hash 和终态；不得把该例外推广到其他 SDK、socket 或 provider。

## 9. 验收矩阵

| ID | 必须通过的正向证据 | 决定性负控 |
| --- | --- | --- |
| C1TL1-01 | readiness/C1/U3/ledger/policy hashes 全绑定 | 改一 hash 拒绝启动 |
| C1TL1-02 | 事前 prediction receipt + 原子 input exact-set | 收盘后写 prediction、删一个 receipt 前输入、把 retrievedAt 改到 receipt 后、receipt 后补 envelope 均拒绝 |
| C1TL1-03 | C1 5/25/70 + U3 完全复用 | 新 symbol、cap breach、复制状态机均失败 |
| C1TL1-04 | 空候选显式全现金 | 不得用 fallback 填仓 |
| C1TL1-05 | 完整事实提交单日 realization/NAV | 删除任一 bar/B0/B1 后零经济提交且可重试 |
| C1TL1-06 | golden execution/action fixture 精确逐日结果；现金路径与利润归因路径分别闭合且相等 | 已公告未生效行动不提前入账；篡改现金、股数、税费、应收被捕获 |
| C1TL1-07 | 同输入幂等 | 第二次 already_recorded、计数/hash 不变 |
| C1TL1-08 | 并发单 owner | 恰好一 recorded、一同 identity loser、无重复 |
| C1TL1-09 | lease CAS/接管 | 旧 token 续租或写入失败 |
| C1TL1-10 | revision/drift 不覆盖 | 改消费事实后旧版本保留、当日不合格 |
| C1TL1-11 | canonical 双根一致 | 两独立进程/DB 经济 hash 相同；同 DB/空 hash 失败 |
| C1TL1-12 | distinct 日期门限 | 同日四行=1；19 false、20 true、40 preferred |
| C1TL1-13 | provenance 隔离 | historical/bootstrap/unknown 不计 forward |
| C1TL1-14 | 生产边界零打开 | 精确生产身份下 path aliases/link/Prisma import 在 open 前拒绝 |
| C1TL1-15 | 外部禁止能力全 false | modeled order 必须存在；任一 broker/external order transmission/capital/production write 使 verifier 失败 |
| C1TL1-16 | 控制器 breaker | >5% shadow DD、<-3% return、连续两次缺 snapshot 均暂停 |
| C1TL1-17 | 网络授权闭合 | 越界 redirect、未授权 method/host/path、超预算 retry 均失败并有 request ledger |
| C1TL1-18 | 100,000 CNY 启动与单次机械规模敏感性 | 运行时非 `10_000_000 fen`、覆盖 300,000 CNY 基线、增加第二资金档或改变信号/阈值均失败 |

独立 verifier 不得调用 C1‑T plan builder 或生产 reducer 计算答案。它必须从原始事实、prediction 和 journal
独立重算 caps、状态、现金、数量、公司行动、费用税、NAV、benchmark、资格和 breaker。golden fixture
必须含“公司行动已公告但尚未 effective”的正向日期，并证明提前入账 mutation 被拒绝；同时分别验证
`cash + receivable + marketValue = NAV` 与费用税 attribution/利润路径，二者不得重复扣费。

## 10. 测试和候选返回

开发期只跑纯函数与 disposable DB component tests；稳定后一次运行 affected integration、backend build/tsc、
DLV3 scripts typecheck。网络/真实时钟单列，不能替代决定性回归。

C0 返回必须含合同/hash、启动 receipt、changed files、命令/退出码、全部计数/hash、双 DB path/inode/result、
C1TL1-01..18、known limitations、forbidden touch=0 和尝试账本。只允许一个完整 C0。

## 11. 尝试、终态与下一门

激活后：C0=1，R1<=1，R2=0。合法终态：

- `REFUSED_STALE_OR_UNAUTHORIZED_HANDOFF`（不消耗 C0）；
- `C1T_OPERATIONAL_SHADOW_CANDIDATE_AWAITING_CODEX`；
- `C1T_OPERATIONAL_SHADOW_BLOCKED_EXTERNAL`；
- `C1T_OPERATIONAL_SHADOW_FAILED_CORRECTNESS`；
- `C1T_OPERATIONAL_SHADOW_INCIDENT`；
- `CANCELLED`。

代码接受后仍需真实累计 20/40 sessions。20 日只能证明运营 readiness，不能证明 Alpha。Stage 18 仍需独立
账户、资本上限（<=另行批准目标资本 5%）、人工订单、备份、对账、kill switch 和回滚授权。

