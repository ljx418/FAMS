# FAMS PRD 完成追踪与集中验收矩阵

更新时间：2026-09-14

## 1. 权威规格与状态优先级

自动化读取顺序固定为：

1. `docs/current-stage-state.json`：唯一当前机器状态。
2. 本矩阵：跨 PRD 完成度、剩余门禁和验收责任。
3. 各 PRD 的 requirement 表与专项 traceability matrix。
4. FTR manifest、合同和审计 artifact。
5. 历史 Markdown 状态仅供追溯，不得覆盖前四项。

## 2. 产品规格完成度

| 规格域 | 需求范围 | 工程/自动验收现状 | 未完成内容 | 最终证据 | 集中人工项 |
| --- | --- | --- | --- | --- | --- |
| 红利低波研究 | `DIVIDEND_LOW_VOL_PRD.md` §3-§8 | 候选、区间、滚动回测、FIVD-R、人工计划草案和交易阻断已实现 | 正式 provider、可信 benchmark、formal validation | 15/16/17 audit +真实回测 | 数据、模型、风险 |
| 每日投资组合复盘 | DPR-001..DPR-030 | `30/30` 工程追踪；真实数据 E2E 已通过；人工未执行 | 集中普通用户体验验收；正式数据/模型门禁不属于 DPR 产品功能完成 | `DAILY_PORTFOLIO_REVIEW_TRACEABILITY_MATRIX.md` + 私有证据索引 | 普通用户体验 |
| V2-PX External Brain | PX-REQ-001..PX-REQ-020 | `20/20` 工程合同和自动验收；PX6-02 为 `0/10` | 集中真实 Chrome 人工体验 10 项 | `V2_PX_PRD_TRACEABILITY_MATRIX.md` + 私有 Chrome 证据索引 | V2-PX 体验 |
| ChatBox 第一入口 | 工具矩阵与结构化结果合同 | 查询、quick-run、确认、Operation、图表、数据健康与阻断已实现 | 最终用户可理解性核查 | ChatBox audits + E2E screenshots | 普通用户体验 |
| 双轨工作台/资产 Excel | UX-F7 合同 | 普通用户入口、专家多页、Excel 导入导出已自动验收 | 集中人工视觉/可读性确认 | UX-F7 HTML/audit | 产品体验 |
| Formal Release Readiness | FTR-0..FTR-6 | A0/FTR-1/FTR-2/FTR-3 point-in-time v2 正式链已通过；FTR-3 为 5/6 窗口、53 条动态路径且失败窗口保留；8 项不可自签队列、执行隔离和 28-artifact provisional package 已完成 | 使用 A6 图文工作台完成集中人工核查；通过后按同一哈希生成 A7 final review package | 13-18 audit + FREE-P1/R0/R1 evidence + v2 正式链 + A6 draft + final package | 数据/模型/风险/合规/final |

## 3. 剩余目标到实体、步骤和证据

| ID | PRD 目标体验 | 当前实体 | 本阶段工作 | 自动验收门槛 | 人工验收门槛 |
| --- | --- | --- | --- | --- | --- |
| RC-01 | 用户知道行情来源、日期和缺口 | `FormalDataProviderService`、`FormalDataFreshnessPolicy`、`FieldEvidenceValidator` | A0 冻结公开来源条款、本机非商业用途和受控端点；以交叉检查数据生成 `FormalDataSnapshot` | 关键字段 evidence 非空；无 unknown/stale/blocked；用途/请求/原始哈希可追溯 | A6 复核使用依据 artifact 与字段链，不得补造；依据失败回 A0 |
| RC-02 | 用户比较真实 total-return benchmark | `FormalBenchmarkService.importBenchmark/buildSeries/qualificationAudit` | A0 冻结 H00300 来源条款与 trust decision；导入版本化 `trusted_total_return` 曲线并 replay | 类型、哈希、sourceRefs、日期连续性和 replay 全通过；不得写成商业授权 | A6 复核既有使用依据和 replay，不得追认来源；依据失败回 A0 |
| RC-03 | 用户看懂策略为何通过或失败 | `ReleaseCandidateSet`、`FormalValidationProfileSet`、`FormalValidationService`、point-in-time v2 artifacts | 七对象保留，红利低波为唯一产品候选；六时点数据门禁 6/6，正式 v2 为 5/6 窗口、53 条动态路径，参数/行业/市场/流动性门槛通过 | 自动门槛已通过；持续要求失败的 `wf-04` 可见、path>=30、样本>=60 日、回撤>=-35%、年换手<=200%、窗口>=6、通过率>=0.6，且不得挑窗口或虚构分组 | A6 模型审核人复核 point-in-time 证据、profile 适用性、真实统计和失败保留 |
| RC-04 | 自动结果能集中核查而不重复计算 | `DeferredHumanReviewQueueService`（已实现）、`HumanAcceptanceDraftService`（已实现）、`ManualSignoffService` | 8 类 artifact hash 已冻结；A6 工作台按当前 package 绑定私有反馈草稿 | 8 类唯一；32/32 步有图，其中 28 步为真实运行或冻结证据截图、4 步为明确标注非证据的现场采证指导图；草稿 API/版本冲突/敏感信息/交易边界合同通过；automation 无批准权限 | 人类完成 8 类核查并由授权流程签核；V2-PX 4 步另附真实 Chrome 截图/trace |
| RC-05 | 所有入口不可能误下单 | `ExecutionIsolationService`、trade gate | 回归 ChatBox/专家页/API/paper | 四锁 false；真实订单/持仓变化=0 | 风险审核复核 |
| RC-06 | 审计者可从一份报告判断是否可进入下一高风险阶段 | `ReleaseGateService`、`FormalReleasePackageService.buildProvisional`、A6 图文工作台 | provisional 包已生成；前七项通过后由 final reviewer 决定是否允许 A7 按同一哈希重建 | artifact 哈希、状态、失败归属完整；A6 final 项不能先于前七项通过 | final reviewer 审核 provisional 包并批准 A7 生成；A7 不解锁交易 |

## 4. 依赖与失效规则

```text
RC-01 -> RC-02 -> RC-03 -> RC-04 -> RC-06
RC-05 -----------------------------> RC-06
Daily/V2/ChatBox/UX human review ---> RC-06
```

- RC-01 失败：RC-02、RC-03、RC-04、RC-06 全部 invalidated。
- RC-02 失败：RC-03、RC-04、RC-06 invalidated。
- RC-03 失败：RC-04、RC-06 invalidated。
- RC-05 失败：立即停止，RC-06 invalidated；不得进入任何生产解锁阶段。
- 任一人工签核失败：保留自动化结果，但 `downstreamEvidenceStatus=invalidated`，回到失败责任阶段。
- artifact 哈希变化：所有基于旧哈希的人工签核失效。
- A6 对 provider 或 benchmark 授权的复核失败：不得在 A6 补签；按授权责任回到 A0，并按上述依赖关系失效后续证据。

## 5. 可声明与禁止声明

自动化范围完成但集中人工核查未完成时，只能声明：

```text
automatedAcceptanceStatus=passed
humanAcceptanceStatus=pending_batch_review
downstreamEvidenceStatus=provisional_until_human_pass
batchHumanReviewReady=true
```

集中核查全部通过后，可声明：

```text
finalFormalReleaseReviewPackageReady=true
humanAcceptanceStatus=passed
```

任何时候都不得由本阶段声明：

```text
formalTradingUnlocked=true
autoTradeUnlocked=true
canCreateOrder=true
orderCreateAllowed=true
productionAdapterEnabled=true
```

## 6. PRD 完成判定

产品功能工程实现、自动验收、集中人工验收和正式 release readiness 是四个独立维度。只有本矩阵 RC-01..RC-06、DPR 30/30、PX 20/20 及集中人工项目全部通过，才能声明“当前 PRD 约定的研究与评审体验完成”。这仍不等于正式交易 release。
