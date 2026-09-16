# FAMS 正式数据治理合同

更新时间：2026-09-14

## 1. 目的与边界

本合同定义 `FTR-1` 正式数据治理的机器可判定边界。它用于区分“真实数据可用于研究”“数据可进入正式评审”和“数据通过正式 release gate”，不得把本地缓存、免费源或可复算解释为正式 provider 已授权。

2026-07-16 的历史基线曾出现 `providerClass=unknown`、`freshnessStatus=unknown` 和覆盖阻断。2026-09-14 FTR-1 已对真实用户 `default` 的 7 个冻结候选生成 49 项 v2 字段证据，并经严格 Schema 与 semantic validator 复核通过。当前状态为：

```text
formalDataGovernancePassed=true
benchmarkQualificationPassed=false
finalFormalReleaseReviewPackageReady=false
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
candidateStrategyId
candidateStrategyVersion
fieldId
critical
applicability
notApplicableReason
providerId
providerClass
sourceEndpoint
asOfDate
fetchedAt
freshnessStatus
coveragePercent
crossCheckStatus
evidenceRefs
evidenceHash
inputBlockers
blockers
warnings
```

`providerClass` 规范值：

```text
official
authorized_commercial
trusted_internal
trusted_public_noncommercial
research_proxy
unknown
```

`unknown`、`research_proxy`、`free_source` 和未经本合同授权/交叉验证的来源不得通过正式数据 gate。

### 2.1 本阶段公开数据授权路线

当前候选与 benchmark 的 FTR-1/FTR-2 公开来源路线不依赖付费 provider。项目负责人已把用途冻结为本机、个人、非商业研究和正式评审准备；该决定只授权 FAMS 在此范围内抓取、缓存、计算和生成私有证据，不代表数据源授予商业再分发权。

FTR-3R0 历史 point-in-time 批量重建是独立数据路径。原路线 A 为 Tushare Pro 批量主源 + BaoStock/AKShare 开源交叉检查；该 adapter 与授权合同已实现，但因项目所有者无法提供付费数据源而保留为 blocked 历史分支。2026-09-14 新增路线 A-FREE：BaoStock 批量历史证券/行业 + AKShare 全市场报告期财务/分红 + AKShare 腾讯未复权价格分片。FREE-P0 真实探针的核心域覆盖为 96.510%-100%，30/30 价格样本通过，预计全市场串行约 2.655 小时，因此允许规划 FREE-P1；仍不得声明全市场六时点回填已经完成。

Tushare token/积分只证明 API 身份或访问能力，不等于用途授权；若未来恢复原路线 A，仍必须同时通过：

```text
apiAuthorizationUsable=true
usageAuthorizationVerified=true
provider authorization chain valid=true
endpoint allowlist covers the requested endpoint=true
source terms evidence/hash present=true
```

任一条件缺失，FTR-3R0B 必须返回 `blocked_provider_not_configured` 或 `blocked_provider_permission`。不得把开源 SDK 许可证解释成数据授权，也不得把项目所有者批准技术路线解释成第三方数据源授权。

路线 A-FREE 必须额外满足：

```text
usageScope=local_personal_noncommercial
AKShare 学术研究用途声明已保存并哈希
BaoStock 官方文档来源与用途判断已保存并哈希
raw response/request parameters/provider version/SHA-256 present=true
full-market work is resumable and shard hashes verified=true
announcementDate<=decisionDate for every usable report row
missing dividend row is not silently treated as confirmed no-dividend
derived turnover/share-capital/market-cap fields carry formula and evidence refs
```

路线 A-FREE 不允许商业再分发，也不把 AKShare MIT 代码许可写成底层网站数据授权。接口字段漂移、公开源限流、条款不支持当前用途或哈希不可重放时必须 blocked。

公开数据只有同时满足以下条件，才能映射为 `trusted_public_noncommercial`：

```text
usageScope=local_personal_noncommercial
sourceTermsSnapshotPresent=true
sourceTermsPermitConfiguredUse=true
sourceEndpointAllowlisted=true
requestParametersRecorded=true
rawResponseSha256Present=true
retrievalReplayPassed=true
providerAuthorizationVerified=true
```

`providerAuthorizationVerified=true` 在本路线中的含义是“公开来源条款与项目用途声明共同支持当前用途”，不得显示为付费商业授权或官方授权。来源条款不清、禁止当前用途、端点不可重放或原始哈希缺失时必须 blocked。

当前冻结来源策略：

- 价格和复权序列：使用项目已有腾讯/东方财富受控适配器交叉检查；只有一致性通过的字段可标记 `trusted_cross_checked`。
- 分红、基本面、行业和可交易性：优先交易所或发行人公开披露；第三方聚合只作索引或交叉检查。
- Benchmark：中证指数公开 `H00300` 全收益历史端点，FTR-2 定级为 `trusted_total_return`，不定级为 `official_total_return`。
- 现有等权 A 股价格收益文件继续是研究代理，不得升级为全收益 benchmark。

## 3. Freshness 与 Coverage

- 行情、benchmark 和可交易性必须以最近已完成交易日为基准；超过 provider SLA 或无法确定最近交易日时标记 `stale` 或 `unknown`。
- 分红和基本面按正式 provider 的公告/发布周期判断新鲜度，但必须记录事件生效日和抓取时间。
- `effectivePath` 的价格和可交易性覆盖率继续使用 `FORMAL_VALIDATION_METRIC_DEFINITIONS.md` 的最低 `80%` 门槛；低于门槛不得进入 formal validation 分母。
- FTR-1 通过要求所有 release candidate 的关键字段均无 `coverageStatus=blocked`，不能以其他策略的高覆盖率抵消单个候选的缺口。
- 缺失窗口必须单独计入 `insufficientWindowCount`，不得从报告中静默删除。

### 3.1 严格 LLM provider 可用性

LLM 只生成确定性结果的受控可读摘要，不参与价格、收益、回撤、benchmark 或 gate 计算。DeepSeek、MiniMax 或后续登记 provider 出现 HTTP 402、5xx、余额不足、超时或结构校验失败时：

```text
strictLlmGateStatus=failed
deterministicFallbackMayBeDisplayed=true
deterministicFallbackMayClaimLlmPassed=false
providerSwitchRequiresExplicitConfiguredProvider=true
failureEvidenceMustBeRetained=true
```

不得把 deterministic fallback、静态模板或上一次成功摘要冒充为本轮 LLM 成功证据。只有确定性输入快照仍新鲜且请求明确允许重试时，才可切换到已配置的备用 provider；原失败和重试链必须同时保留。

### 3.2 长时命令与 SQLite 验收窗口

真实数据全量回归、SQLite 大库检查和完整浏览器验收允许使用长时命令，但必须显式配置超时，不得用默认短超时制造假失败，也不得无限等待：

```text
defaultCommandTimeoutSeconds=120
longRunningAcceptanceTimeoutSeconds=420
sqliteLargeDatabaseThresholdMiB=512
sqliteLargeDatabaseAcceptanceTimeoutSeconds=420
timeoutIsPass=false
timeoutRequiresFailureEvidenceAndReplan=true
```

### 3.3 Web Origin 与 Extension caller identity 分离

Web 前端 Origin allowlist 与浏览器扩展 caller identity 是两套独立合同。增加 `http://localhost:3100` 等 Web Origin 不能自动授权扩展，扩展 ID 也不能作为 Web Origin 的替代品：

```text
webOriginSeparatedFromExtensionIdentity=true
webOriginAllowlistCannotGrantExtensionIdentity=true
extensionIdentityCannotBypassWebOriginValidation=true
providerCredentialNeverExposedToBrowser=true
```

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
| `15_data_governance_audit.json` | v2 真实用户 artifact 已通过，仍属人工复核前 provisional evidence | 同名 v2 artifact | 明确 candidate、字段、授权和失败归属 |

当前通过证据：

```text
backend/data/gpt-audit/formal-release-readiness/FTR-1/2026-09-14T08-51-05-698Z/15_data_governance_audit.json
candidateCount=7
fieldEvidenceCount=49
sourceSeriesCount=26
sameWindowAuditReplayCount=26
accountFactsUnchanged=true
```

同窗口审计重放只允许读取 FTR-1 自有、状态为 passed、窗口一致且 `contentHash` 重算一致的真实来源记录；不得读取普通研究缓存。重放不等于实时抓取，artifact 必须披露 `provenance.mode` 和原路径。

point-in-time v2 重放继承非产品候选时，必须先重算上一轮 `sourceEvidence`、`providerAuthorizationAudit`、`fieldEvidenceValidation` 的 canonical SHA-256，并与已通过的治理 artifact 引用逐项相等。通过该校验的 required 字段必须重新生成 `evidenceHash`，并明确标记：

```text
temporalScope=frozen_historical_window
crossCheckStatus=immutable_replay_verified
freshnessStatus=frozen_historical
```

固定历史窗口不得因墙钟日期推进被误判为当前行情 stale；反之，未通过来源哈希校验、仍需代表当前状态、或缺少 immutable replay 证据的字段不得使用该标记规避 freshness gate。

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
free_source / research_proxy 被写成 official / authorized_commercial
stale / unknown 被隐藏或从分母移除
provider secret 出现在日志或 artifact
formalTradingUnlocked=true
canCreateOrder=true
```
