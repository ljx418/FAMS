# FAMS 集中人工验收执行计划

更新时间：2026-09-14

## 1. 决策与边界

本计划把原先分散在各子阶段的产品体验、模型、风险、合规和最终 release 人工核查，后置为一次集中验收。它不删除人工门禁，也不允许自动化代签。

```text
humanReviewExecutionMode=batch_after_automated_scope
automationSelfApprovalAllowed=false
downstreamEvidenceStatus=provisional_until_human_pass
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

以下事项不是可后置签核，而是自动化运行所需的外部输入，必须先取得：

1. 已冻结的公开来源条款、本机个人非商业用途声明、受控端点清单、请求参数和原始响应哈希；当前路线不要求付费 provider credential。
2. 中证指数 H00300 `trusted_total_return` 的来源条款、信任结论、版本、请求与重放哈希；不得宣称商业授权或 `official_total_return`。
3. 固定的 `ReleaseCandidateSet`、策略版本和排除理由。

这里的“使用依据”由公开来源条款与项目负责人冻结的本机个人非商业用途共同构成，并形成不可变 artifact；它不等于商业数据许可，也不是 FTR release 审核结论。A6 只能复核 A0 冻结的条款快照、用途范围和哈希，不能在验收时补造或替代缺失证据。A6 若否决其真实性或适用范围，所有依赖证据立即失效并打回 A0。

生产订单适配器启用、真实资金操作和正式交易解锁不属于本计划，必须进入独立高风险阶段。

## 2. 自动化阶段顺序

| 顺序 | 阶段 | 实施与验证 | 自动出门状态 | 失败打回 |
| --- | --- | --- | --- | --- |
| A0 | 输入依据冻结 | 校验公开来源条款与本机非商业用途；验证受控端点；导入 H00300 trusted benchmark；冻结 candidate set | `externalInputsReady=true` | 来源条款/用途/数据输入 |
| A1 | FTR-1 数据治理 | 真实数据抓取、字段 evidence、freshness、coverage、交叉校验 | `formalDataAutomatedCheck=passed`，证据 provisional | FTR-1 |
| A2 | FTR-2 Benchmark | 回放 total-return 曲线、资格和 alias 合同 | `benchmarkAutomatedCheck=passed`，证据 provisional | FTR-2 |
| A3 | FTR-3 模型验证 | OOS、walk-forward、参数敏感、行业/市场/流动性分组 | `formalValidationAutomatedCheck=passed`，证据 provisional | FTR-3 |
| A4 | FTR-5 隔离回归 | ChatBox、专家页、API、paper/sandbox 交易边界 | `executionIsolationPassed=true` | FTR-5 |
| A5 | 预审包 | 冻结 A0-A4 artifact 哈希、用户路径截图和 provisional HTML | `batchHumanReviewReady=true` | FTR-6 |
| A6 | 集中人工核查 | 按本文件第 4 节一次完成产品体验、数据、模型、风险、合规、final release 核查 | `humanAcceptanceStatus=passed/failed` | 对应责任阶段 |
| A7 | 最终评审包 | 只消费已签核 artifact，重建最终 HTML、manifest、SUMMARY | `finalFormalReleaseReviewPackageReady=true` | FTR-6 |

不得因为 A6 被后置而跳过 A0 的授权输入，也不得在 A6 之前写入 `manualSignoffPassed=true`。

## 3. Provisional 证据合同

每个 A1-A5 artifact 必须包含：

```text
automatedAcceptanceStatus=passed|blocked|failed
humanAcceptanceStatus=pending_batch_review
downstreamEvidenceStatus=provisional_until_human_pass
inputArtifactHashes
generatedAt
commitSha
failureOwner
rollbackStage
```

规则：

1. 自动化通过只证明计算、合同和可复算性通过。
2. 人工批次未通过前，下游报告不得使用 `final`、`approved` 或 `release passed`。
3. 任一输入 artifact 哈希变化，依赖它的签核和下游 package 全部 invalidated。
4. 任一人工项失败，保留失败证据，按 `rollbackStage` 打回；不得只改摘要文字。
5. `ReleaseGateService` 不得覆盖 FTR-1 至 FTR-5 的原始状态。

## 4. 集中人工核查清单

| 核查角色/对象 | 操作步骤 | 必看证据 | 通过门槛 | 失败归属 |
| --- | --- | --- | --- | --- |
| 普通用户体验 | 导入真实资产 -> Dashboard -> ChatBox 比较 -> 工作台 -> 专家页 -> Operations | 真实浏览器截图、输入快照、Operation/artifactRefs | 能理解结论、关键数字、数据健康、下一步；无隐蔽错误或订单入口 | UX/产品阶段 |
| V2-PX 体验 | Side Panel、Workspace、Host App 完成 10 项 PX6-02 路径 | Chrome trace、四 viewport、lifecycle、G1-G7 | 10/10；无 mock、权限越界和状态丢失 | V2-PX PX6-02 |
| 数据审核 | 独立复核 A0 已冻结的 provider 授权、字段 evidence、freshness、coverage；不得补授权 | FTR-1 artifact、授权 artifact 与源版本 | 授权适用范围和哈希一致；关键字段无 unknown/stale/blocked；秘密未泄露 | 授权不成立打回 A0，字段问题打回 FTR-1 |
| Benchmark 审核 | 独立复核 A0 已冻结的来源许可、曲线版本和 replay；不得追认未授权来源 | FTR-2 artifact、授权 artifact | official/trusted total-return；许可范围、哈希与 replay 一致 | 授权不成立打回 A0，曲线问题打回 FTR-2 |
| 模型审核 | 核对 candidate、OOS、walk-forward、参数和分组 | FTR-3 artifact | 所有 candidate 达冻结阈值；失败/insufficient 未隐藏 | FTR-3 |
| 风险审核 | 尝试四类禁止动作并核对持仓/订单零变化 | FTR-5、trade boundary audit | 所有入口 blocked；production adapter disabled | FTR-5 |
| 合规审核 | 核对授权、隐私、非投资建议边界和 artifact 链 | provider/benchmark/隐私/审计包 | 来源和责任可追溯；无 secret/账户原图进入公开包 | 对应数据或报告阶段 |
| 最终 release 审核 | 前七项通过后，从 HTML 逐项进入原始 evidence 并核对哈希 | FTR-6 provisional package、A6 feedback draft | 前述七项全部 passed；反馈绑定同一 source manifest；只批准生成 A7 | FTR-6 |

### 4.1 A6 人工验收工作台

统一入口为 `frontend/public/formal-release-human-checklist.html`。页面从本机 `GET /api/v1/formal-release/human-review-drafts/current` 读取当前 FTR-6 provisional 包、8 类 review guide 和草稿；通过 `PUT` 写入 Git 忽略的 `.verification/private/formal-release/A6/<packageId>/human-feedback-draft.json`。

页面对每个 review type 必须同时展示：

1. 功能介绍；
2. 对应真实代码/证据架构；
3. 开始条件、逐步操作、每步配图、现场采证要求和通过标准；
4. 核验结果、严重度、实际结果、预期差异、复现步骤、修复建议和私有证据引用。

配图合同：32 个步骤必须 32/32 有图。普通用户路径使用已有真实运行截图；数据、benchmark、模型、风险、合规和最终审核使用当前 provisional 包的冻结证据阅读截图；原生 Side Panel 和双容器生命周期使用 4 张明确标注“操作示意、非验收证据”的指导图。指导图只告诉人类如何操作，仍必须由人类回填真实 Chrome 截图/trace，且不得用 headless、静态 mock 或指导图冒充通过证据。

```text
reviewTypeCount=8
illustratedHumanStepCount=32
illustratedHumanStepCoveragePercent=100
realOrFrozenEvidenceImageStepCount=28
instructionalDiagramStepCount=4
manualChromeCaptureRequiredStepCount=4
draftOnly=true
officialSignoffCreated=false
humanAcceptanceStatus=pending_batch_review
```

草稿即使 8/8 都选择 passed，也只能进入 `ready_for_authorized_signoff`，不得直接写 `ManualSignoffRecord`、不得把 `humanAcceptanceStatus` 改为 passed。最终 release 项在前七项全部 passed 前禁止选择 passed，从而消除“A6 依赖尚未生成的 A7、A7 又依赖 A6”的循环。

## 5. 集中验收退出条件

```text
batchHumanReviewItemsComplete=true
dailyPortfolioReviewHumanAcceptancePassed=true
v2PxPx6_02Passed=true
dataSignoffPassed=true
benchmarkSignoffPassed=true
modelSignoffPassed=true
riskSignoffPassed=true
complianceSignoffPassed=true
finalReleaseReviewPassed=true
signedArtifactHashesMatch=true
automationSelfApprovalBlocked=true
```

即使全部满足，本阶段也只允许生成正式交易 release 的评审材料；生产适配器和交易权限必须在独立高风险阶段再次审批。

## 6. 自动化停止条件

以下任一项出现，自动化停止并向人类报告，不进入 A6：

- 公开来源条款不支持冻结用途、benchmark trust decision 不成立或来源不可重放；
- 真实数据无法满足 freshness/coverage；
- 统计门槛无法在冻结规则下满足；
- 证据哈希、输入快照或 candidate set 不一致；
- 任何路径出现真实订单或持仓修改；
- 需要降低门槛、隐藏失败样本或使用 mock 才能通过。
