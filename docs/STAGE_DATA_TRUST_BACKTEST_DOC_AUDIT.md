# 数据可信与组合回测前置评审文档审计

更新时间：2026-06-29

## 1. 审计结论

当前文档可以支撑下一阶段“真实数据可信度可见、计算准确性可复核、组合回测可进入正式交易前置评审”的自动化开发，但不能支撑正式交易 release 自动放行。

阶段结论：

```text
documentationSupportsCurrentStageDevelopment=true
documentationSupportsExitAcceptance=true
documentationSupportsDataTrustAndCalculationAudit=true
documentationSupportsFormalTradingReleaseWithoutExternalEvidence=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
```

2026-06-29 实施结论：

```text
documentationStageImplemented=true
drawioPageCount=7
drawioPageLimit=8
targetArchitectureCoverage=complete_for_current_stage
developmentAcceptanceCoverage=complete_for_FTR1_to_FTR6_planning
formalTradingReleaseReady=false
```

本轮文档已经把 PRD、目标架构、开发计划、里程碑、验收门槛、drawio gap 图和审计口径统一到同一阶段目标：继续支持研究、组合回测、数据可信展示、计算复算展示和人工计划草案；继续阻断正式交易 release。

解释：

- 文档已经把用户体验目标收敛为“先看数据可信和复算状态，再看候选、区间和回测曲线”。
- 文档已经明确 `dataTrustGrade=INSUFFICIENT` 时只能研究观察，不能给出正式交易建议。
- 文档已经明确 `calculationAuditStatus=deterministic_replay_only` 只代表公式复算一致，不代表模型有效或策略胜率可靠。
- 文档已经把 drawio 目标架构绑定到具体前端页面、API、服务、数据缓存和审计产物。
- 正式交易 release 仍依赖正式 provider、可信 total-return benchmark、formal validation 和人工签核，不能由文档更新自动解锁。

## 2. 本轮文档覆盖范围

本轮只做文档开发，不修改业务代码。

已覆盖文档：

| 文档 | 本轮要求 | 状态 |
| --- | --- | --- |
| `docs/DIVIDEND_LOW_VOL_PRD.md` | 补齐数据可信、计算复算、首屏可读性和交易边界 | 已纳入 |
| `docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md` | 补齐组合回测的数据可信、复算、benchmark 和阻断展示 | 已纳入 |
| `docs/TARGET_ARCHITECTURE_GAP.md` | 补齐数据可信与计算复算架构要求、出门条件 | 已纳入 |
| `docs/target-architecture-gap.drawio` | 保持不超过 8 页，增强实体绑定和用户路径 | 已纳入 |
| `docs/read-drawio-output.txt` | 作为 drawio 原始 XML 可读性证据 | 已生成/可复核 |

2026-06-29 追加覆盖：

| 文档 | 本轮要求 | 状态 |
| --- | --- | --- |
| `docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md` | 明确 FTR-1 到 FTR-6 的开发顺序、出门标准和不能自动放行的边界 | 已纳入 |
| `docs/drawio-summary.txt` | 同步 drawio 7 页结构、颜色规则、实现实体和验收结论 | 已纳入 |
| `docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md` | 保留正式交易 release 文档审计入口和 blocked 结论 | 已纳入 |

## 3. 关键规格一致性

### 3.1 状态字段

所有主文档应使用以下 canonical 字段：

```text
dataTrustVisible=true
calculationAuditVisible=true
dataTrustGrade=INSUFFICIENT
calculationAuditStatus=deterministic_replay_only
portfolioBacktestFormalReviewReady=true
manualTradePlanDraftReviewReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### 3.2 允许动作

```text
RESEARCH
OBSERVE
COMPARE
ALERT
PLAN_DRAFT
MANUAL_TRADE_DRAFT
```

### 3.3 禁止动作

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
```

禁止动作可以出现在文档中，但只能出现在 `prohibitedActions`、硬边界、非目标、阻断原因或不能声明的上下文中。

## 4. 用户体验验收门槛

文档支撑的下一阶段用户体验必须满足：

1. 用户进入红利低波策略页，首屏能看到数据可信、计算复算、价格新鲜度和正式交易锁定状态。
2. 用户查看候选池时，能理解“为什么入选、为什么被剔除、哪些指标可信、哪些字段不足”。
3. 用户查看买入/卖出观察区间时，能看到价格来源、交易日期、失效条件和“不是交易指令”的提示。
4. 用户进入组合回测页，能选择 1 年、3 年、5 年和自定义区间，并在曲线旁看到数据可信、benchmark 资格和模型有效性。
5. 用户生成人工计划草案时，系统仍显示 `formalTargetWeight=0`、`canCreateOrder=false`。
6. 用户可以从任务中心或审计包追溯输入数据、公式复算、回测参数、模型验证和 release blockers。

## 5. 架构验收门槛

`docs/target-architecture-gap.drawio` 必须满足：

- 页数不超过 8 页。
- 全文中文为主，能让人类快速理解目标体验和目标架构。
- 颜色语义固定：灰色已实现、黄色需修改、橘黄待新增、红色硬边界、绿色用户出门体验。
- 每个关键模块绑定具体实现实体，不接受只写“数据层、策略层、验证层、审计层”的泛化表达。
- 当前架构到目标架构必须能沿前端、API、服务、数据、审计/Gate 五层读出交互关系。
- 开发计划必须同时说明实现后用户能看到什么、系统能验收什么、哪些 gate 仍 blocked。
- 出门条件必须明确当前可声明和不能声明的状态。

## 6. 仍未关闭的真实风险

| 风险 | 当前影响 | 文档处理方式 |
| --- | --- | --- |
| 免费源覆盖率和新鲜度不足 | 不能证明正式交易级数据真实性 | 保持 `dataTrustGrade=INSUFFICIENT`，进入 blocker |
| 复算通过被误解为模型有效 | 可能造成虚假验收 | 明确 `calculationAuditStatus` 只代表 deterministic replay |
| proxy benchmark 被误认为正式 benchmark | 可能误放 release gate | 明确 proxy 只能 research/fallback |
| 页面信息密度过高 | 用户难以理解结论 | 文档要求首屏摘要优先，高级指标折叠 |
| formal-review-ready 被误写成 formal-trading-ready | 可能绕过交易边界 | 强制 `formalTradingUnlocked=false` 和 `canCreateOrder=false` |

## 7. 下一阶段开发准入结论

可以进入下一阶段自动化开发的内容：

- 数据可信首屏摘要与字段级缺口展示。
- 计算复算审计展示与 golden sample 复核。
- 红利低波页面信息层级和可读性优化。
- 组合回测页多区间曲线与数据可信联动。
- 审计包生成与任务中心追溯。

不能由自动化流程自行放行的内容：

- 正式 provider 授权结论。
- 官方或授权 total-return benchmark 资格结论。
- formal validation 全通过结论。
- 人工签核结论。
- 正式 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

最终审计结论：

```text
pass_for_documentation_stage=true
pass_for_automated_development_planning=true
pass_for_formal_trading_release=false
external_chatgpt_audit_required=false
external_chatgpt_audit_recommended_after_next_doc_or_code_stage=true
```

## 8. 文档阶段出门清单

- PRD 说明当前用户体验和交易边界。
- 目标架构说明当前架构、目标架构、实现实体和演进路径。
- Drawio 不超过 8 页，当前为 7 页。
- 开发计划把 FTR-1 到 FTR-6 绑定到用户效果、审计产物和验收标准。
- 里程碑明确当前可声明和不能声明的状态。
- 所有主文档保持 `formalTradingUnlocked=false / autoTradeUnlocked=false / canCreateOrder=false / orderCreateAllowed=false`。
- 文档可以指导下一阶段自动化开发；不能替代正式 provider、可信 benchmark、formal validation 或人工签核。
