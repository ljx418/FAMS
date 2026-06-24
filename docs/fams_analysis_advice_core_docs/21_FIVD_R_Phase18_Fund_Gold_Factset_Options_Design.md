# FIVD-R Phase 18 基金/债基与黄金事实集闭环方案设计

日期：2026-06-02

## 1. 背景与目标

Phase 12-17 已经完成：

- `DataGapSummary` 结构化缺口。
- `asset_identity_missing` research identity remediation。
- `market_data / provider_health` symbol 级行情缓存 remediation。
- trade gate contract tests。
- validation evidence 失败归因。

当前剩余高风险缺口主要是：

```text
fund_like_value_factset_missing
gold_macro_value_factset_missing
validation_evidence failed
```

本阶段目标不是放行交易动作，而是设计后续可落地路径，把基金/债基、黄金类资产从“只知道缺什么”推进到“能用真实数据做研究/观察级分析”。

硬边界：

```text
validation_evidence failed => formal ADD / REDUCE 禁止
manual trade draft blocked
AUTO_TRADE out of scope
LLM 不直接决定买卖
事实集不足不能包装成 available
```

## 2. 需求拆解

### 2.1 基金/债基 FactSet

最低研究级字段：

```text
fundType
navHistory
navDate
rollingReturn
maxDrawdown
volatility
fee
manager
fundScale
riskLevel
holdingsStyle 或 assetAllocation
sourceRefs
providerHealth
```

债基额外字段：

```text
durationProxy
creditRiskProxy
interestRateSensitivity
drawdownUnderRateShock
cashLikeOrCreditLike classification
```

### 2.2 黄金宏观 FactSet

最低研究级字段：

```text
goldPriceSource
goldPriceHistory
realRateProxy
usdTrend
inflationExpectationProxy
volatility
drawdown
correlationWithEquity
sourceRefs
providerHealth
```

黄金不能套用股票 PE/PB 或股票基本面模型。

### 2.3 FIVD-R 接入要求

所有方案最终都必须输出：

```text
factsetStatus: available | partial | missing
dataGapSummary
evidenceRefs
providerHealth
lastRefreshAt
blockedReasons
researchAvailable
observeAllowed
formalTradeActionAllowed=false when validation failed
prohibitedActions includes ADD / REDUCE / AUTO_TRADE
```

## 3. 方案 A：保守内置 Provider + 本地事实集缓存

### 3.1 设计

使用现有免费或低门槛数据源，只做研究/观察级事实集：

基金/债基：

- 天天基金/东方财富公开基金信息页面或已有 fund NAV 源。
- 本地 `FundNav` / price history 作为净值历史主源。
- 费用、规模、基金经理、风险等级先从公开基金资料抓取或缓存。

黄金：

- 使用黄金 ETF/黄金基金持仓对应的本地行情。
- 宏观代理先使用可获取的公开代理指标：
  - 黄金价格：黄金 ETF 或公开金价源。
  - USD trend：美元指数或替代 ETF/公开指数。
  - realRateProxy：先用“名义利率/通胀预期缺失”标记 partial，不伪造。

新增服务建议：

```text
backend/src/services/fund/fundFactsetService.ts
backend/src/services/commodity/goldMacroFactsetService.ts
backend/src/services/analysis/fivdRAlternativeAssetFactsetAdapter.ts
```

新增 Operation：

```text
fund_factset_refresh
gold_macro_factset_refresh
```

### 3.2 影响

正向影响：

- 最快把 fund/gold gap 从 unsupported 变成 partial/executable。
- 可直接服务持仓研究和 FIVD-R position detail。
- 对现有架构改动小。
- 不需要立即引入付费 API。

负向影响：

- 数据完整性有限。
- 宏观代理不够强，黄金 factset 可能长期 partial。
- 免费源稳定性、字段变化、反爬风险较高。
- 不足以支持交易动作放行。

### 3.3 代价

开发成本：中等。

预计工作量：

```text
5-8 个开发日
```

主要成本：

- Provider parser 和字段标准化。
- Provider health 和缓存。
- Operation + artifact。
- 真实数据验收。
- 前端 DataGapPanel / FactSet 展示适配。

验收成本：

- 每类资产至少 2-3 个真实样本。
- 免费源失败/字段缺失场景必须覆盖。

### 3.4 适用场景

适合当前阶段作为首选，因为目标是 research/observe 质量提升，不是交易放行。

## 4. 方案 B：正式金融数据 Provider 接入

### 4.1 设计

接入正式数据源，基金和宏观数据使用商业或准商业 API。

可能 provider：

```text
Tushare Pro
Wind / Choice / iFinD
AkShare 作为中间层
交易所/基金公司公开披露文件
```

基金/债基字段：

- 基金净值。
- 基金规模。
- 持仓明细。
- 费用。
- 基金经理。
- 评级/风险等级。
- 债券久期、信用等级、券种分布。

黄金宏观字段：

- 伦敦金/上海金价格。
- 美元指数。
- 实际利率。
- CPI/通胀预期。
- 美债收益率。
- 黄金 ETF 持仓。

### 4.2 影响

正向影响：

- 数据可信度最高。
- 可形成更完整 evidenceRefs。
- 更接近未来 validation evidence 攻关所需的数据质量。
- 能减少“字段缺失导致 partial”的比例。

负向影响：

- 成本高。
- API 授权、频率、字段权限存在不确定性。
- 本地开发环境无法保证所有用户都具备 token。
- 数据授权可能限制文档、截图、审计包分发。

### 4.3 代价

开发成本：高。

预计工作量：

```text
10-20 个开发日
```

主要成本：

- Provider adapter。
- token/config 管理。
- 字段权限探测。
- 数据授权边界。
- fallback 设计。
- provider health 和 circuit breaker。
- 大量真实样本验收。

外部成本：

```text
API 订阅费用
授权审批
配额管理
```

### 4.4 适用场景

适合中长期生产化，尤其当 FAMS 要从研究工作台进入正式投研系统时采用。

不建议作为当前第一步，因为会把进度卡在授权和 provider 不确定性上。

## 5. 方案 C：人工导入 + 审计证据包

### 5.1 设计

不先接自动 provider，而是允许用户导入基金/黄金事实集 CSV/Excel/JSON，并强制附 evidenceRefs。

导入文件：

```text
fund_factset_import.csv
gold_macro_factset_import.csv
```

导入后生成：

```text
fund_factset_import_audit.json
gold_macro_factset_import_audit.json
```

规则：

- 所有导入字段必须有 source/date。
- 缺 source 的字段只能作为 optional，不能作为 blocking gap 的闭环证据。
- 导入数据必须通过 schema validation。
- 旧数据超过 freshness window 自动降级 partial。

### 5.2 影响

正向影响：

- 对 provider 依赖最低。
- 可以快速支持用户已有研究资料。
- 审计可控，适合 GPT 审计包。
- 很适合基金经理、费用、持仓风格等难以稳定抓取的字段。

负向影响：

- 用户操作成本高。
- 数据质量取决于导入人。
- 不适合大规模自动刷新。
- 仍需要防止用户导入低质量数据后误以为交易可用。

### 5.3 代价

开发成本：中等偏低。

预计工作量：

```text
4-7 个开发日
```

主要成本：

- 导入 schema。
- 文件解析。
- 字段级审计。
- freshness check。
- artifact 生成。
- 前端导入入口。

运营成本：

```text
用户需要维护导入模板和来源说明
```

### 5.4 适用场景

适合快速闭环“研究证据可审计”，尤其在 provider 不稳定或数据授权未确定前。

## 6. 方案 D：混合方案，推荐

### 6.1 设计

采用分层事实集策略：

```text
Level 1：本地行情/净值缓存
Level 2：免费公开 Provider
Level 3：人工导入证据
Level 4：正式商业 Provider
```

当前阶段先实现：

```text
Level 1 + Level 2 + Level 3
```

正式商业 provider 作为后续可插拔增强。

基金/债基：

```text
navHistory：优先本地/已有 fund NAV 源
drawdown/volatility/rollingReturn：本地计算
fee/manager/scale/riskLevel：免费源或人工导入
holdingsStyle：免费源可用则接入，否则人工导入
duration/creditRisk：没有可靠源时 partial
```

黄金：

```text
goldPriceHistory：本地 ETF/黄金标的行情
volatility/drawdown/correlation：本地计算
usdTrend/realRate/inflation：免费宏观代理或人工导入
宏观代理缺失时 partial，不伪造
```

### 6.2 影响

正向影响：

- 最平衡。
- 能最快把 unsupported 降为 partial/executable。
- 保留未来正式 provider 扩展空间。
- 真实数据验收可控。
- 不强依赖 API token。

负向影响：

- 架构比单 provider 复杂。
- 同一字段可能有多个来源，需要 source precedence。
- 需要字段级 freshness 和 confidence。
- 前端需要解释“哪些字段来自自动源，哪些来自人工源”。

### 6.3 代价

开发成本：中等偏高。

预计工作量：

```text
8-14 个开发日
```

主要成本：

- FactSet schema。
- Provider abstraction。
- Manual import。
- Operation orchestration。
- source precedence。
- evidenceRefs。
- frontend 展示。
- E2E 验收。

### 6.4 推荐理由

推荐采用方案 D。

原因：

- 方案 A 快，但数据深度不足。
- 方案 B 质量高，但授权和成本风险大。
- 方案 C 审计强，但自动化不足。
- 方案 D 能先让 FIVD-R 的研究/观察能力落地，同时保留生产版扩展路径。

## 7. 推荐实施路线

### Phase 18.1：FactSet Schema 与 Gate

目标：

```text
定义 fund/gold factset 标准结构和状态规则
```

任务：

- 新增 `FundLikeFactSet`。
- 新增 `GoldMacroFactSet`。
- 新增 freshness/confidence/evidenceRefs 规则。
- DataGapSummary 支持字段级闭环状态。

代价：

```text
2-3 个开发日
```

影响：

- 不接 provider 也能先统一模型。
- 后续 provider 和导入都能复用。

### Phase 18.2：基金/债基本地计算

目标：

```text
用真实 NAV/price history 计算 rolling return、drawdown、volatility
```

任务：

- 读取本地基金净值/价格历史。
- 计算 20d/60d/120d rolling return。
- 计算 max drawdown 和 volatility。
- 缺 NAV 时保持 partial。

代价：

```text
2-4 个开发日
```

影响：

- 基金/债基研究能力立即提升。
- 仍无法完全闭环 fee/manager/holdings。

### Phase 18.3：黄金本地行情与宏观代理

目标：

```text
黄金类资产不再套股票估值，改用黄金专属 factset
```

任务：

- 使用黄金标的本地行情计算收益、波动、回撤。
- 增加宏观代理字段。
- 缺 realRate/USD/inflation 时 partial。

代价：

```text
2-4 个开发日
```

影响：

- 避免股票模型误用于黄金。
- 宏观解释更诚实，但可能仍 partial。

### Phase 18.4：人工导入审计

目标：

```text
允许用户补齐 provider 难以稳定获取的字段
```

任务：

- CSV/Excel/JSON schema。
- import audit artifact。
- sourceRefs 必填。
- freshness check。
- 前端导入入口。

代价：

```text
3-5 个开发日
```

影响：

- 快速补齐 fee/manager/holdings/macro proxy。
- 增加用户操作成本。

### Phase 18.5：Provider Adapter 增强

目标：

```text
可插拔正式 provider
```

任务：

- Provider interface。
- token/config。
- provider health。
- fallback。
- entitlement check。

代价：

```text
5-10 个开发日
```

影响：

- 为生产版数据质量打基础。
- 会引入授权、费用和环境配置复杂度。

## 8. 推荐验收命令

新增：

```bash
cd backend
npm run test:fivd-r-fund-factset
npm run test:fivd-r-gold-macro-factset
npm run test:fivd-r-factset-import-audit
```

固定：

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-core
npm run test:fivd-r-data-gap-remediation
npm run test:fivd-r-trade-gate-contract
npm run test:production-readiness
npm run test:trade-action-readiness

cd frontend
npm run build
```

预期：

```text
test:trade-action-readiness 继续因 validation_evidence 按预期失败
```

## 9. 决策建议

推荐采用方案 D：混合方案。

第一轮只做：

```text
Phase 18.1 + Phase 18.2 + Phase 18.3
```

也就是：

- 先统一 schema。
- 先用真实本地数据完成基金/债基、黄金的研究级计算。
- 缺少的 fee/manager/holdings/macro proxy 保持 partial。
- 不急于接商业 provider。

第二轮再做：

```text
Phase 18.4 人工导入审计
```

第三轮根据实际需要做：

```text
Phase 18.5 正式 provider adapter
```

## 10. 总体审计意见

当前不建议直接进入方案 B。

原因：

- provider 授权和字段权限不确定。
- 容易把开发计划卡在外部依赖。
- 当前目标仍是 research/observe，不是交易动作。

当前也不建议只做方案 C。

原因：

- 会让系统过度依赖人工维护。
- 自动化研究工作台体验不足。

推荐方案 D 的原因：

- 能最大化利用现有真实本地数据。
- 能尽快降低 `fund_like_value_factset_missing` 和 `gold_macro_value_factset_missing` 的严重度。
- 能保留严谨的 evidenceRefs 和 DataGapSummary。
- 不破坏 `validation_evidence` gate。

最终结论：

```text
允许进入 Phase 18.1-18.3 的开发前验收细化。
不允许宣称基金/黄金 factset 已生产级完整。
不允许因 fund/gold factset partial 就放行交易动作。
```

## 11. Phase 18.1-18.3 执行同步

已按方案 D 的第一轮执行：

- 建立 `FundLikeFactSet` / `GoldMacroFactSet`。
- 使用真实本地历史计算基金/债基和黄金研究级风险收益指标。
- 黄金增加 `priceScaleCheck`，单日涨跌超过 20% 时阻断为 `gold_price_scale_inconsistent`。

真实数据发现：

- `009725` 基金/债基样本历史不足，保持 `insufficient`。
- `002611` 黄金历史存在价格尺度混用，保持 `insufficient`。

下一步建议：

- 不直接进入黄金可用状态。
- 先执行方案 D 的 Phase 18.4 或方案 2 的黄金口径建模：
  - 区分黄金实物价格、黄金 ETF、黄金联接基金净值。
  - 建立 source precedence 和 conversion rule。

Phase 18.4 已执行：

- 黄金已按 source family 做价格尺度选择。
- `002611` 选择 `price_history:goldFund`。
- `market_bar_canonical:sina` 被排除。
- 尺度检查通过，但样本不足，仍为 `insufficient`。
