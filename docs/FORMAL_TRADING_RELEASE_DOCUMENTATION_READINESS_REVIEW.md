# 正式交易 Release 文档可开发性评估

更新时间：2026-06-26

## 1. 结论

```text
documentationReadyForCurrentStage=true
supportsAutomatedDevelopment=true
supportsExitAcceptance=true
supportsFormalReviewReady=true
supportsFormalTradingReleaseWithoutExternalEvidence=false
fatalSpecificationGap=none_found
majorOverPromiseRisk=controlled_by_release_gate
requiresHumanChoiceBeforeDevelopment=false
```

当前文档已经可以支撑本阶段后续自动化开发。这里的“本阶段”是正式交易 release 前置评审与 release gate 能力建设，不是正式交易动作放行。

本阶段开发完成后，可以达成：

```text
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
longHorizonRealDataBacktestReady=true
releaseGateAuditReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

不能达成、也不得承诺：

```text
不得出现正式 ADD / REDUCE 已发布
不得出现 ORDER_CREATE 放行
不得出现 AUTO_TRADE 放行
不得出现自动再平衡 ready
formalTradingUnlocked 不得为 true
```

## 2. 本轮评估范围

本轮只评估文档能否指导后续开发和验收，不进入业务代码开发。

已复核文档：

```text
docs/DIVIDEND_LOW_VOL_PRD.md
docs/TARGET_ARCHITECTURE_GAP.md
docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
docs/drawio-summary.txt
docs/target-architecture-gap.drawio
docs/read-drawio-output.txt
docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md
docs/FORMAL_TRADING_PREREQUISITE_DOC_AUDIT.md
```

当前状态源：

```text
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/SUMMARY_FOR_GPT.md
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-10-58-875Z/15_release_data_governance_audit.json
backend/data/gpt-audit/interactive-strategy-backtest/2026-06-26T13-12-17-124Z/03_frontend_runtime_and_operation_audit.json
```

## 3. PRD 目标到开发计划的可追溯矩阵

| PRD / 用户目标 | 已绑定的文档与架构实体 | 后续开发项 | 验收口径 |
| --- | --- | --- | --- |
| 用户能查看红利低波候选、买入观察区间、卖出观察区间和 priceAudit | `DIVIDEND_LOW_VOL_PRD.md`、`DividendLowVol.tsx`、`dividendLowVolTradingZoneService`、drawio 第 1/2/4 页 | FTR-1 数据治理、FTR-3 模型有效性、FTR-6 release gate | 页面显示数据来源、新鲜度、阻断原因；无正式交易文案 |
| 用户能比较红利低波、当前持仓、永久组合、全天候组合和自定义组合 | `PORTFOLIO_STRATEGY_BACKTEST_PLAN.md`、`Backtest.tsx`、`PortfolioBacktestInputBuilder`、`PortfolioBacktestEngine`、drawio 第 3 页 | FTR-1A 长周期回测维持与数据治理升级、FTR-2 benchmark | 1 年/3 年/5 年和自定义区间有独立 artifact；缺数据显示 insufficient |
| 用户能看到数据等级和模型有效性 | `TARGET_ARCHITECTURE_GAP.md`、`09_data_grade_audit.json`、`10_model_effectiveness_audit.json`、drawio 第 4/5 页 | FTR-1、FTR-2、FTR-3 | 字段级 evidence、benchmark 资格、OOS/walk-forward/参数/分组稳定性可审计 |
| 用户能生成人工计划草案但不能下单 | `portfolioBacktestReviewService`、`11_manual_plan_draft_audit.json`、drawio 第 1/2 页 | FTR-4 人工签核 | `formalTargetWeightPercent=0`，`canCreateOrder=false`，签核缺失时 release blocked |
| 用户能追溯任务和审计包 | `Operations.tsx`、Operation artifact、`SUMMARY_FOR_GPT.md`、drawio 第 1/6/7 页 | FTR-6 release gate 与审计包 | 13-18 审计产物可解释 release passed/blocked |
| 用户能知道为什么还不能正式交易 | `FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md`、drawio 第 5/7 页 | FTR-6 | release gate 汇总显示 data governance、benchmark、validation、manual signoff、execution isolation 状态 |

## 4. 文档完整性评估

| 维度 | 评估 | 结论 |
| --- | --- | --- |
| 目标体验 | 已覆盖红利低波筛选、组合回测、人工计划草案、任务审计和 release blockers | 通过 |
| 架构实体绑定 | drawio 和目标架构已绑定前端页面、API、服务、数据实体、Operation artifact 和审计产物 | 通过 |
| 开发计划粒度 | FTR-1 到 FTR-6 均有目标、开发内容、验收标准和用户效果 | 通过 |
| 出门验收 | 已定义 M1-M7、字段级证据、benchmark、formal validation、人工签核和 release gate | 通过 |
| 交易边界 | 明确保持 `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false` | 通过 |
| 风险路线 | 免费源、benchmark、交易约束、formal validation、人工签核风险均有备选路线和 gate 处理 | 通过 |
| Drawio 可读性 | 7 页，不超过 8 页；第 2 页按前端/API/服务/数据/审计分层说明当前到目标的关系 | 通过 |

## 5. 是否存在高开发失败风险

当前没有需要用户立即选择路线的文档级风险。后续真实开发仍有外部依赖风险，但这些风险已经被文档收敛到 release gate，不会导致虚假出门。

| 风险 | 当前处理 | 是否需要用户现在选择 |
| --- | --- | --- |
| 免费源覆盖不足 | 保持 research/fallback；字段不足进入 blocker | 否 |
| 官方或可信 total-return benchmark 不足 | free-source benchmark 只能 formal-review-ready，不能 release | 否 |
| 涨跌停/停牌/流动性约束不足 | tradeability 缺口阻断 formal validation | 否 |
| OOS、walk-forward、参数敏感性或分组稳定性不足 | formal validation 保持 warning/failed/insufficient | 否 |
| 人工签核缺失 | `ManualSignoffStatus=missing` 阻断 release | 否 |

推荐路线继续保持：

```text
免费源 + 本地缓存 + 严格 evidence/freshness + proxy 明示 + 后续正式 provider 升级
```

该路线可以支撑研究体验、长周期回测 formal-review-ready、人工计划草案和 release gate 审计；不能单独支撑正式交易 release。

## 6. 后续自动化开发准入结论

可以进入后续自动化开发的范围：

```text
FTR-1 正式数据源与字段级数据治理
FTR-1A 长周期真实数据组合回测维持与补证
FTR-2 官方或可信 total-return benchmark 资格建设
FTR-3 Formal validation artifact
FTR-4 人工签核与人工计划草案评审链路
FTR-5 Paper trading / sandbox 执行隔离
FTR-6 Release gate 与审计包
```

不能自动放行的范围：

```text
正式 provider 凭证与商业授权
官方 benchmark 授权数据
人工签核结论
正式 ADD / REDUCE
ORDER_CREATE
AUTO_TRADE
```

## 7. 出门验收标准

文档阶段出门验收通过条件：

1. `docs/target-architecture-gap.drawio` 可读，页数不超过 8 页。
2. drawio 中关键能力绑定真实代码实体或审计 artifact。
3. `FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md` 能按 FTR-1 到 FTR-6 指导开发。
4. PRD、目标架构、drawio、审计文档中的状态词典一致。
5. 文档不得把 formal-review-ready 写成正式交易 release。
6. 文档明确说明用户能看到的功能和仍被阻断的功能。
7. hard-fail 检查不得出现正向交易放行文案。

## 8. 审计命令

```bash
node docs/read-drawio.mjs docs/target-architecture-gap.drawio > docs/read-drawio-output.txt
rg -o "<diagram[^>]*name=\"[^\"]+\"" docs/target-architecture-gap.drawio
rg -n "DividendLowVol.tsx|Backtest.tsx|Operations.tsx|portfolioBacktest.ts|PortfolioBacktestEngine|portfolioBacktestReviewService|dividendLowVolTradingZoneService" docs
rg -n "formalTradingUnlocked=false|autoTradeUnlocked=false|canCreateOrder=false|orderCreateAllowed=false" docs
P_TRUE="true"
rg -n "formalTradingUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|autoTradeUnlocked[[:space:]]*=[[:space:]]*$P_TRUE|orderCreateAllowed[[:space:]]*=[[:space:]]*$P_TRUE|canCreateOrder[[:space:]]*=[[:space:]]*$P_TRUE" docs backend/src frontend/src backend/scripts
git diff --check -- docs
```

## 9. 最终判断

当前文档水平可以完整支撑本阶段后续开发计划。本阶段开发完成后，可以顺利完成“正式交易 release 前置材料完整、长周期真实数据组合回测 formal-review-ready、人工计划草案 ready、release gate 可审计”的出门验收。

当前不需要继续文档修订来消减重大规格风险；后续应进入代码开发前的子阶段计划与验收闭环。若后续真实数据、benchmark、formal validation 或人工签核无法达标，应按 release gate 阻断，而不是回头修改文档降低门槛。
