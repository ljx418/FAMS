# FAMS 正式交易 Release 开发及验收计划

更新时间：2026-06-26

## 1. 阶段定位

本文件定义 FAMS 从“正式交易前置评审 ready”进入“正式交易 release 可开发、可验收、可审计”的下一阶段文档规格。当前系统已经可以支撑研究筛选、组合策略回测、长周期真实数据回测、人工计划草案和审计追溯；但仍不能创建订单，也不能输出正式 `ADD / REDUCE`。

当前状态必须保持：

```text
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
longHorizonRealDataBacktestReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

本阶段文档完成后的目标不是立即放行交易，而是让后续工程开发者可以按文档实现正式交易 release 的前置能力，并让人工审核者能清楚判断每个 gate 是否满足。

## 1.1 当前实现状态快照

截至 2026-06-26 最新审计包 `backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md`，系统已经具备正式交易 release 的评审材料骨架，但 release gate 仍处于阻断状态：

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 交互式策略回测 | `ready` | `/backtest` 已支持多策略回测、曲线、指标、benchmark 状态和 readiness summary。 |
| 红利低波研究链路 | `ready_for_research` | `DividendLowVol.tsx` 已展示候选、观察区间、滚动策略、数据状态和交易锁定提示。 |
| 人工计划草案 | `ready_for_review` | `portfolioBacktestReviewService` 可保存草案复核材料，但 `formalTargetWeightPercent=0`。 |
| Paper / sandbox 执行隔离 | `ready_for_review` | 已定义 `paperOrderIntents` 和 `executionIsolationAudit`，不影响真实持仓。 |
| Release gate audit | `blocked` | 已输出 release gate 汇总，但数据治理、formal validation、人工签核仍未通过。 |
| 长周期真实数据组合回测 | `ready_for_formal_review` | 当前已实际重放 1 年、3 年、5 年和自定义区间，1 年/3 年/5 年覆盖率分别为 `96.43% / 95.90% / 95.71%`，7 个策略均可比较；该状态仍不等于正式交易 release。 |
| 数据治理 | `blocked` | 已有 `15_data_governance_audit.json`，字段级 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / coverageStatus / crossCheckStatus / evidenceRefs` 已补齐；但免费源和本地缓存仍不等于正式 provider 字段级证据。 |
| Benchmark 资格 | `review_ready` | 已有 `16_benchmark_qualification_audit.json`，free-source total return 可用于评审材料，仍不能等同官方或授权 benchmark。 |
| Formal validation | `warning` | OOS、walk-forward、参数敏感性和分组稳定性仍需正式通过。 |
| 人工签核 | `missing` | 数据、模型、风控、合规、最终 release 多角色签核尚未闭环。 |

当前可声明：

```text
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
paperSandboxReviewReady=true
```

当前不能声明：

```text
formalTradingUnlocked 不得为 true
autoTradeUnlocked 不得为 true
orderCreateAllowed 不得为 true
canCreateOrder 不得为 true
formal ADD / REDUCE released 不得出现
auto rebalance ready 不得出现
```

## 2. 目标体验

本阶段开发完成后，用户应能完成以下路径：

1. 在“红利低波策略”页面查看候选、入选原因、剔除原因、买入观察区间、卖出观察区间、数据来源和模型验证状态。
2. 在“策略回测”页面选择红利低波篮子、当前持仓、永久组合、全天候组合或自定义组合，查看不同起止时间的收益曲线、回撤曲线、benchmark 和风险指标。
3. 在“策略回测”页面切换 1 年、3 年、5 年和自定义区间，查看哪些组合具备长周期真实数据覆盖，哪些组合因数据不足被阻断。
4. 在“正式交易评审”视图中查看每条策略的数据等级、官方 benchmark 状态、formal validation 状态、交易约束覆盖、人工签核状态和阻断原因。
5. 在人工计划草案中查看当前权重、研究目标权重、正式目标权重、单票/行业上限、流动性约束、失效条件和复核 checklist。
6. 在任务中心和审计包中追溯输入数据、模型版本、回测参数、验证结果、人工签核、交易 gate 和最终出门结论。

在所有 gate 通过前，前端仍必须显示“正式交易未解锁”，不得出现下单按钮、自动再平衡按钮或自动交易入口。

## 3. 非目标

以下事项不由文档自动放行：

```text
formal ADD
formal REDUCE
ORDER_CREATE
AUTO_TRADE
自动再平衡执行
绕过人工复核
把免费源 benchmark 包装为官方 benchmark
把 research validation 包装为 formal validation
```

`AUTO_TRADE` 不属于本阶段目标。即使未来正式交易 release 通过，也必须另立独立授权项目和人工审批。

## 4. 状态词典

| 字段 | 含义 | 当前值 | release 出门要求 |
| --- | --- | --- | --- |
| `researchReady` | 研究筛选和策略比较可用 | `true` | 继续为 `true` |
| `portfolioBacktestFormalReviewReady` | 组合回测材料可进入正式评审 | `true` | 继续为 `true` |
| `manualTradePlanDraftReviewReady` | 人工计划草案可复核 | `true` | 继续为 `true` |
| `longHorizonRealDataBacktestReady` | 1 年/3 年/5 年真实数据组合回测是否完成验收 | `true` | 已达到 formal-review-ready；正式交易 release 仍需其他 gate |
| `formalTradingEligible` | 正式交易资格前置是否全部满足 | `false` | 全部 release gate 通过后才可为 `true` |
| `formalTradingUnlocked` | 正式 `ADD / REDUCE / ORDER_CREATE` 是否解锁 | `false` | 只能由人工签核和 release gate 共同解锁 |
| `autoTradeUnlocked` | 自动交易是否解锁 | `false` | 本阶段仍为 `false` |
| `canCreateOrder` | 是否允许创建订单 | `false` | 只在订单执行隔离评审通过后才可讨论 |
| `orderCreateAllowed` | 是否允许下单动作 | `false` | 只在正式交易 release 通过后才可讨论 |

强规则：

```text
manualTradePlanDraftReviewReady != formalTradingUnlocked
portfolioBacktestFormalReviewReady != formalTradingUnlocked
tradeActionReadiness passed != orderCreateAllowed
longHorizonRealDataBacktestReady != formalTradingUnlocked
formalTradingEligible != autoTradeUnlocked
```

## 5. 目标架构

正式交易 release 目标架构必须沿用当前实现实体，不新增绕过 gate 的独立路径。

### 5.1 前端层

| 页面 | 职责 |
| --- | --- |
| `DividendLowVol.tsx` | 展示红利低波候选、指标解释、买卖观察区间、rolling backtest、数据缺口和交易锁定提示。 |
| `Backtest.tsx` | 展示多策略曲线、数据等级、模型有效性、人工计划草案、正式交易 unlock checklist 和 blockers。 |
| `Operations.tsx` | 追溯 Operation、artifactRefs、审计包、HTML 验收报告和 release gate 产物。 |
| `Analysis.tsx` | 展示 FIVD-R 统一分析结果和交易 gate 阻断说明，不输出正式交易指令。 |

### 5.2 后端层

| API / 服务 | 职责 |
| --- | --- |
| `/api/v1/strategy/dividend-low-vol/*` | 候选池、交易区间、滚动回测、FIVD-R adapter、manual acceptance。 |
| `/api/v1/portfolio-backtest/*` | 策略模板、组合回测、Operation artifact、人工复核审计。 |
| `PortfolioBacktestInputBuilder` | 构建红利低波篮子、当前持仓、永久组合、全天候和自定义组合输入。 |
| `PortfolioBacktestEngine` | 输出曲线、指标、dataGrade、modelEffectivenessStatus、readinessSummary。 |
| `portfolioBacktestReviewService` | 保存人工复核记录，当前仍返回 `canCreateOrder=false`。 |
| `dividendLowVolTradingZoneService` | 输出买入/卖出观察区间、priceAudit、失效条件和 rolling 策略结果。 |

### 5.3 数据与审计层

正式 release 需要补齐：

- 正式 provider 字段级证据：行情、分红、财务、行业、交易约束。
- 官方或可授权 total-return benchmark。
- Formal validation artifact：OOS、walk-forward、参数敏感性、行业/市场/流动性分组稳定性。
- 人工签核 artifact：数据签核、模型签核、风控签核、合规签核、最终 release 签核。
- 订单执行隔离审计：paper trading / sandbox / production adapter 明确隔离。

当前和目标审计产物分层：

| 产物 | 当前用途 | release 用途 |
| --- | --- | --- |
| `09_data_grade_audit.json` | 说明 research/formal-review 数据等级 | 继续作为 release 数据治理输入 |
| `10_model_effectiveness_audit.json` | 说明模型有效性现状 | 作为 formal validation 输入 |
| `11_manual_plan_draft_audit.json` | 说明人工计划草案和权重锁定 | 作为人工签核输入 |
| `12_formal_trading_unlock_blockers.json` | 说明当前 unlock blockers | 作为 release gate blocker 输入 |
| `13_execution_isolation_audit.json` | 说明 paper/sandbox 与真实持仓隔离 | release 执行隔离 gate |
| `14_release_gate_audit.json` | 汇总 release gate 当前状态 | 最终 release 出门 gate |
| `15_data_governance_audit.json` | 字段级 provider、freshness、coverage、cross-check | 正式数据治理 gate |
| `16_benchmark_qualification_audit.json` | benchmark 类型、覆盖率、资格 | 正式 benchmark gate |
| `17_formal_validation_audit.json` | OOS、walk-forward、参数和分组稳定性 | formal validation gate |
| `18_manual_signoff_audit.json` | 数据/模型/风控/合规/最终 release 签核 | 人工签核 gate |

## 6. 开发及验收计划

### FTR-1 正式数据源与数据治理

目标：把免费源 research-grade 证据升级为可进入正式 release 评审的数据证据。

当前状态：`dataGovernanceAudit` 已存在但 `DataGovernanceStatus=blocked`。下一步不是新增抽象“数据层”，而是让已有字段级审计从 blocked 变为可评审。

开发内容：

- 为行情、分红、财务、行业、交易约束建立字段级 provider contract。
- 输出 `sourceProvider / sourceEndpoint / asOfDate / fetchedAt / freshnessStatus / coverageStatus / evidenceRefs`。
- 增加跨源一致性检查和 provider fallback 审计。
- 当前免费源可保留为 fallback，但不能升级为 `official_authorized`。

验收标准：

- 关键字段覆盖率、freshness 和 evidenceRefs 可审计。
- `15_data_governance_audit.json` 中每个 release 关键字段都有 `sourceProvider / asOfDate / fetchedAt / freshnessStatus / coverageStatus / crossCheckStatus / evidenceRefs`。
- 免费源、proxy、手工补录不得被标成 `official_authorized`。
- Provider timeout、empty reply、stale cache 不得静默忽略。
- 任一关键字段缺正式证据时，`formalTradingEligible=false`。

用户可见效果：用户能看到哪些数据来自正式 provider，哪些来自免费源或 proxy；数据不足时页面显示阻断原因，不显示“可交易”。

### FTR-1A 长周期真实数据组合回测

目标：让正式 release 评审前具备 1 年、3 年、5 年和自定义区间的真实数据组合回测材料。

当前状态：已达到 formal-review-ready。最新审计包显示 `LongHorizonRealDataBacktestReady=true`，1 年、3 年、5 年覆盖率分别为 `96.43% / 95.90% / 95.71%`，7 个策略均可比较。后续只需在 FTR-1/FTR-2/FTR-3 中继续提升数据治理、benchmark 和 formal validation。

开发内容：

- 保留已实现的 1 年、3 年、5 年和自定义区间实际 replay 路径，后续只补真实数据覆盖、分红事件、交易约束和 benchmark 证据。
- 为红利低波篮子、当前持仓、永久组合、全天候组合和自定义组合建立长周期数据覆盖报告。
- 每个区间输出行情、分红、交易约束、benchmark 的 coverage、freshness、crossCheckStatus 和 evidenceRefs。
- 缺少长周期数据时，策略结果保持 `insufficient`，不得用短窗口回测替代。
- 生成长周期 HTML 可视化验收报告，包含截图、曲线、指标和阻断项。

保留验收标准：

- 1 年、3 年、5 年区间均有独立 artifact。
- `multi_period_backtest_result.json` 必须证明区间 replay 已 materialized，不能出现 `period_replay_not_materialized_in_current_request`。
- 1 年、3 年、5 年区间覆盖率均达到 `>=80%`。
- 分红、交易约束、benchmark 若仍是 research/proxy 证据，必须进入 FTR-1/FTR-2/FTR-3 的正式 release blocker，而不是影响长周期 replay 是否 materialized。
- 至少三个组合在同一区间可比较；不可比较的组合必须展示阻断原因。
- `longHorizonRealDataBacktestReady` 在本阶段表示长周期 replay 与覆盖率达到 formal-review-ready；若 benchmark、分红或交易约束仍是 research/proxy 证据，必须继续阻断 formal trading release。

用户可见效果：用户能按不同起止时间判断策略是否稳定，而不是只看到短窗口曲线。

### FTR-2 官方或可信 total-return benchmark

目标：让组合策略和红利低波回测具备正式 benchmark 对照。

当前状态：`BenchmarkQualificationStatus=passed` 只表示 formal-review-ready；`official_authorized_total_return_benchmark_not_reviewed` 仍是正式 release blocker。

开发内容：

- 接入官方或授权 total-return benchmark。
- 区分 `formal_total_return / free_source_total_return / price_index / research_proxy / unavailable`。
- 在组合回测和审计包中输出 benchmark 数据等级、覆盖率和阻断项。

验收标准：

- `research_proxy` 不得参与 formal trading unlock。
- `free_source_total_return` 必须明确标记为 formal-review-ready，不得自动升级为 official benchmark。
- 缺官方或可信 total-return benchmark 时，formal validation 不能 passed。

用户可见效果：用户能看懂收益曲线相对哪个 benchmark，benchmark 是否具备正式评审资格。

### FTR-3 Formal validation

目标：把“能回测”升级为“历史有效性可进入正式评审”。

当前状态：`FormalValidationStatus=warning`。已能输出 OOS、walk-forward、参数敏感性和分组稳定性审计，但仍存在样本外收益、超额收益和 proxy replay 风险。

开发内容：

- 对红利低波篮子、当前持仓、永久组合、全天候和自定义组合输出 formal validation artifact。
- 验证项包括 OOS、walk-forward、参数敏感性、行业分组、市场状态分组、流动性分组。
- 输出 `modelEffectivenessStatus` 和 failure taxonomy。

验收标准：

- Walk-forward 至少 6 个窗口。
- OOS 和超额收益不得为负仍被升级 passed。
- 参数敏感性和分组稳定性不得以单点或单组结果替代。
- 任一核心 gate insufficient 或 failed 时，`formalTradingEligible=false`。

用户可见效果：用户能看到策略是 passed、warning、insufficient 还是 failed，并能看到失败原因。

### FTR-4 人工签核与计划草案升级

目标：把人工计划草案变成可正式评审的人工签核流程，但仍不自动创建订单。

当前状态：`ManualSignoffStatus=missing`。`portfolioBacktestReviewService` 已可保存复核材料，但 release 所需多角色签核尚未闭环。

开发内容：

- 为数据、模型、风控、合规、最终 release 增加签核 checklist。
- 每条签核记录包含 `reviewerId / reviewedAt / decision / notes / blockedReasons / evidenceRefs`。
- 页面展示签核状态和缺失签核项。

验收标准：

- 未完成所有签核时，`formalTradingUnlocked=false`。
- 签核通过前 `formalTargetWeightPercent=0`、`canCreateOrder=false`。
- 签核通过也只能解除人工复核 blocker，不能绕过数据、benchmark、formal validation 和 release gate。

用户可见效果：用户能看到计划草案为什么还不能下单，缺哪项人工确认。

### FTR-5 Paper trading / sandbox 执行隔离

目标：在正式交易 release 前验证执行路径，但不连接实盘交易。

当前状态：`PaperSandboxReviewReady=true`，但 `production_order_adapter_not_enabled` 仍是 release blocker。

开发内容：

- 定义 paper trading adapter 和 sandbox order intent。
- 明确隔离 `PLAN_DRAFT`、`PAPER_ORDER_INTENT`、`ORDER_CREATE`。
- 所有 paper 结果进入 Operation artifact 和审计包。

验收标准：

- Paper trading 不得改变真实持仓。
- Sandbox 失败不得回退到实盘路径。
- 生产订单适配器缺失时 `orderCreateAllowed=false`。

用户可见效果：用户可以看到模拟执行结果和风险，但不会误以为已经下单。

### FTR-6 Release gate 与审计包

目标：形成正式交易 release 的最终出门审计。

当前状态：`ReleaseGateStatus=blocked`，阻断来源包括 data governance、benchmark qualification、formal validation、manual signoff、production adapter 和 auto trade policy。

开发内容：

- 新增 release gate audit package。
- 汇总 runtime health、provider、benchmark、formal validation、人工签核、paper trading、订单隔离和前端误导检查。
- 输出最终 `formalTradingEligible / formalTradingUnlocked / autoTradeUnlocked / orderCreateAllowed`。

验收标准：

- 缺任一 gate 时，release gate 必须 failed 或 blocked。
- 审计包能独立解释为什么通过或为什么阻断。
- `AUTO_TRADE` 仍保持 false，除非另立独立项目。
- 文档、API、前端、审计包中的 `formalTradingUnlocked / autoTradeUnlocked / orderCreateAllowed / canCreateOrder` 必须一致。

用户可见效果：用户能通过一个审计报告判断项目是否真的进入正式交易 release。

## 7. 里程碑

| 里程碑 | 目标状态 | 出门条件 |
| --- | --- | --- |
| M1 Release Docs Ready | 文档可指导正式交易 release 开发 | PRD、目标架构、drawio、验收门槛和审计清单一致 |
| M2 Long Horizon Review Ready | 长周期真实数据组合回测可评审 | 1 年/3 年/5 年覆盖率均 >=80%，当前已完成 |
| M3 Formal Data Ready | 正式数据源可评审 | 字段级 evidence、freshness、coverage、跨源一致性达标 |
| M4 Formal Benchmark Ready | benchmark 可正式评审 | 官方或可信 total-return benchmark 接入并可追溯 |
| M5 Formal Validation Ready | 模型有效性可正式评审 | OOS、walk-forward、参数、分组稳定性全部可审计且 passed |
| M6 Manual Signoff Ready | 人工签核闭环 | 数据、模型、风控、合规、最终 release 签核完成 |
| M7 Formal Trading Release Review | 进入正式 release 评审 | 所有 gate passed，人工确认是否解锁正式动作 |

## 8. 出门条件

正式交易 release 只有在以下条件全部满足后才可讨论：

- Runtime health healthy。
- 正式 provider 或等价可信数据源覆盖关键字段。
- 官方或可信 total-return benchmark 可用。
- 交易约束完整：涨跌停、停牌、流动性、单票上限、行业上限、费用、滑点。
- Formal validation 全部 gate passed。
- 人工签核全部 passed。
- Paper trading / sandbox 执行隔离通过。
- 前端没有误导文案。
- 审计包可独立复核。

仍不能自动声明：

```text
autoTradeUnlocked 被写成 true
AUTO_TRADE 不得放行
无人值守自动再平衡
绕过人工复核的 ORDER_CREATE
```

### 8.1 高风险点与备选技术路线

以下风险不是文档措辞问题，而是后续开发能否达成正式交易 release 的真实阻断项。当前文档已经把它们放入 release gate，因此不会影响本阶段“可指导自动化开发”的结论；但如果风险无法在开发中消减，系统只能停留在 research / formal-review-ready，不能声明正式交易 release。

| 风险点 | 对开发目标的影响 | 推荐路线 | 备选路线 | 优劣对比 |
| --- | --- | --- | --- | --- |
| 免费数据源覆盖不足或字段不可追溯 | 无法完整证明长周期真实数据回测和行业龙头证据 | 路线 A：免费源优先，字段级 evidence 和 freshness 严格标记 | 路线 B：接入正式 provider；路线 C：免费源 + 正式 provider 混合 | A 成本低但只能 research-grade；B 可信度高但依赖 token、权限和费用；C 最适合分阶段推进 |
| 官方或可信 total-return benchmark 缺失 | benchmark qualification 不能通过，formal validation 不能升级 | 路线 C：先使用 free-source proxy 并显式标记 proxy，再补官方 benchmark adapter | 路线 B：优先采购或接入官方 benchmark 数据 | C 能继续开发体验和审计链路，但 release gate 继续 blocked；B 更接近正式交易评审，但交付风险取决于数据授权 |
| 涨跌停、停牌、流动性约束不完整 | 回测收益可能高估，不能声明真实可交易 | 先把 tradeability constraint 作为 hard blocker 写入 backtest audit | 若数据源不足，只允许展示价格路径和研究曲线 | blocker 路线更严格，避免虚假验收；研究曲线可用但不能进入 release |
| Formal validation 样本量、OOS、walk-forward 或稳定性不足 | 模型有效性不能证明，manual signoff 不应通过 | 扩展有效样本和多区间回测，失败时输出 taxonomy | 降级为策略研究对比和人工观察 | 扩样能提高可信度但耗时；降级可保持产品可用但不得交易 |
| 人工签核缺失 | 即便技术 gate 通过，也不能解锁正式交易动作 | 保留 manualSignoffStatus=missing，前端显示阻断原因 | 只开放人工计划草案和 paper sandbox | 保守但符合产品边界；避免把草案误读为订单授权 |

当前推荐路线：

```text
路线 C：免费源 + 本地缓存 + 严格 evidence/freshness + proxy 明示 + 后续正式 provider 升级
```

选择原因：

- 符合当前“先完成真实数据研究体验和 formal-review-ready”的目标。
- 不把免费源验证包装成正式交易 release。
- 可以在不等待 Tushare 或商业 provider 的前提下继续打通用户路径、审计包、回测曲线和人工计划草案。
- 后续如果接入正式 provider，可以复用同一套字段级 evidence、benchmark qualification、formal validation 和 release gate。

## 9. 文档验收命令

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio > docs/read-drawio-output.txt
rg -o "<diagram[^>]*name=\"[^\"]+\"" docs/target-architecture-gap.drawio
rg -n "DividendLowVol.tsx|Backtest.tsx|Operations.tsx|portfolioBacktest.ts|PortfolioBacktestEngine|portfolioBacktestReviewService|dividendLowVolTradingZoneService" docs
rg -n "formalTradingUnlocked 不得为 true|autoTradeUnlocked 不得为 true|orderCreateAllowed 不得为 true|canCreateOrder 不得为 true" docs
rg -n "formalTradingUnlocked=false|autoTradeUnlocked=false|canCreateOrder=false|orderCreateAllowed=false" docs
P_TRUE="true"
rg -n "formalTradingUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|autoTradeUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|orderCreateAllowed[[:space:]]*=[[:space:]]*$P_TRUE|canCreateOrder[[:space:]]*=[[:space:]]*$P_TRUE" docs backend/src frontend/src backend/scripts
git diff --check -- docs
```

通过标准：

- Drawio 页数不超过 8 页。
- 所有关键能力绑定真实页面、API、服务、数据或审计 artifact。
- 文档没有把 formal-review-ready、manual-draft-ready 或 tradeActionReadiness 写成正式交易放行。
- Release 计划能指导后续开发，但明确当前仍未解锁正式交易。
- 若 hard-fail 检查命中，必须逐条确认是否处于“禁止、阻断、非目标、不得声明”语境；任何正向放行语境都必须打回修订。

## 10. 审计入口

正式交易 release 文档审计应读取：

```text
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/DIVIDEND_LOW_VOL_PRD.md
docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md
docs/PORTFOLIO_STRATEGY_BACKTEST_FORMAL_TRADING_STAGE_PLAN.md
docs/DIVIDEND_LOW_VOL_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/ARCHITECTURE_CURRENT_TARGET.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/target-architecture-gap.drawio
docs/drawio-summary.txt
docs/read-drawio-output.txt
docs/FORMAL_TRADING_PREREQUISITE_DOC_AUDIT.md
docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md
```
