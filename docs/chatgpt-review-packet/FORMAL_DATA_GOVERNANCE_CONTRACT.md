# FAMS 正式数据治理合同

更新时间：2026-07-16

## 1. 目的与边界

本合同定义 `FTR-1` 正式数据治理的机器可判定边界。它用于区分“真实数据可用于研究”“数据可进入正式评审”和“数据通过正式 release gate”，不得把本地缓存、免费源或可复算解释为正式 provider 已授权。

当前基线来自 2026-07-16 最新审计：价格、benchmark、分红和可交易性合同已经输出字段级证据，但部分策略仍出现 `providerClass=unknown`、`freshnessStatus=unknown`、`coverageStatus=blocked`；benchmark 为免费源，分红贡献仍包含研究级估算。因此当前状态必须保持：

```text
formalDataGovernancePassed=false
formalTradingReleaseReviewReady=false
formalTradingUnlocked=false
```

## 2. 关键字段与来源类别

每个 release candidate 的以下数据域必须分别审计：

```text
price
benchmark
dividend
tradeability
fundamental
industryClassification
costModel
```

每项必须包含：

```text
fieldId
releaseCandidateStrategyId
sourceProvider
providerClass
sourceEndpoint
asOfDate
fetchedAt
freshnessStatus
coverageStatus
coveragePercent
crossCheckStatus
evidenceRefs
blockers
warnings
```

`providerClass` 规范值：

```text
official_authorized
trusted_authorized
free_source
local_cache
research_proxy
unknown
```

`unknown`、`research_proxy` 和未经上游来源追溯的 `local_cache` 不得通过正式数据 gate。

## 3. Freshness 与 Coverage

- 行情、benchmark 和可交易性必须以最近已完成交易日为基准；超过 provider SLA 或无法确定最近交易日时标记 `stale` 或 `unknown`。
- 分红和基本面按正式 provider 的公告/发布周期判断新鲜度，但必须记录事件生效日和抓取时间。
- `effectivePath` 的价格和可交易性覆盖率继续使用 `FORMAL_VALIDATION_METRIC_DEFINITIONS.md` 的最低 `80%` 门槛；低于门槛不得进入 formal validation 分母。
- FTR-1 通过要求所有 release candidate 的关键字段均无 `coverageStatus=blocked`，不能以其他策略的高覆盖率抵消单个候选的缺口。
- 缺失窗口必须单独计入 `insufficientWindowCount`，不得从报告中静默删除。

## 4. Cross-check 与 Evidence

正式数据 gate 通过必须满足：

```text
providerAuthorizationVerified=true
criticalFieldsHaveEvidenceRefs=true
noCriticalProviderUnknown=true
noCriticalFreshnessUnknownOrStale=true
noCriticalCoverageBlocked=true
crossCheckStatus in official_verified / trusted_cross_checked
providerSecretNotLogged=true
researchFallbackPromotedToFormal=false
```

`evidenceRefs` 必须能定位到 provider、请求或导入批次、资产、时间区间和数据版本。只有 URL、文件名或自报状态而无法定位版本的 evidence 不足以通过。

## 5. 当前实体到目标实体

| 当前实体 | 当前职责/缺口 | 下一阶段目标实体 | 目标结果 |
| --- | --- | --- | --- |
| `formalProviderIngestionService` | 红利低波正式源导入基础，尚未统一覆盖组合回测所有字段 | `FormalDataProviderService` | 统一 provider 授权、抓取、版本和字段证据 |
| `marketDataFreshnessService` | 提供缓存 freshness；部分策略仍 unknown | `FormalDataFreshnessPolicy` | 按交易日和 provider SLA 判定 |
| `PortfolioBacktestEngine.buildDataGovernanceAudit` | 在回测引擎内聚合审计，职责过重 | `FieldEvidenceValidator` | 独立验证关键字段和候选策略覆盖 |
| `market_bar_canonical / market_tradeability_daily / DividendLowVolDaily` | 本地证据缓存 | `FormalDataSnapshot` | 保存 provider 版本、来源链和哈希 |
| `15_data_governance_audit.json` | 当前合同可生成但业务状态 blocked | 同名 v2 artifact | 明确 candidate、字段、授权和失败归属 |

## 6. 用户验收场景

1. 用户在 Backtest 选择 release candidate 并运行正式评审。
2. 页面逐项显示价格、benchmark、分红和可交易性的 provider、日期、覆盖率和跨源状态。
3. 任一关键字段缺失或过期时，页面显示具体资产/窗口及恢复动作，状态为 `blocked`。
4. 审计用户从 Operations 打开 `15_data_governance_audit.json`，能从页面状态追溯到同一 evidenceRefs。
5. 数据 gate 未通过时，ChatBox 和专家页都只能给出研究解释，不能生成正式交易动作。

## 7. Hard Fail

以下任一项出现即 FTR-1 失败并打回数据治理计划：

```text
关键字段 providerClass=unknown 仍标记 passed
critical evidenceRefs 为空仍标记 passed
free_source / research_proxy 被写成 official_authorized
stale / unknown 被隐藏或从分母移除
provider secret 出现在日志或 artifact
formalTradingUnlocked=true
canCreateOrder=true
```
