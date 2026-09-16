# FAMS 当前阶段独立审计入口

## 1. 审计对象与边界

- 产品：FAMS（Financial Asset Manager System）
- 权威仓库：`https://github.com/ljx418/FAMS.git`
- 基线分支：`main`
- 产品实现基线提交：`ca99c25ac0d8295f2bf5c2266c19dfd230a4c206`
- 文档有效时间：2026-09-16（Asia/Shanghai）
- 审计包结构：19 个文件全部平铺在本目录，除本说明外有 18 个带 SHA-256 的审计对象
- 当前范围：原始 PRD、当前/目标架构、投资工作流、FTR provisional 链、集中人工验收计划、交易边界与出门条件
- 当前不声明：完整 PRD 出门、人工签核完成、正式交易解锁、订单创建或自动交易

本目录已经按当前权威文件重新清空式构建。不得使用历史审计包或旧 Draw.io 替代这里列出的对象。

## 2. 请求独立复核的当前声明

请对照 PRD、代码实体、Draw.io、manifest、Schema 和反假绿约束逐项复核：

```text
documentationSupportedAutomatedScope=passed
investmentWorkflowAutomatedCoverage=18/20
fullPrdExitStatus=blocked
prdFullyComplete=false

ftr1PointInTimeDataGovernancePassed=true
ftr2V2BenchmarkQualificationPassed=true
ftr3PointInTimeFormalValidationPassed=true
ftr4DeferredHumanReviewQueuePassed=true
ftr5CurrentChainExecutionIsolationPassed=true
ftr6ProvisionalReviewPackagePassed=true

batchHumanReviewReady=true
manualSignoffPassed=false
finalFormalReleaseReviewPackageReady=false

adviceLevelPointInTimeSimulationImplemented=false
pendingStrategyAssignmentCount=16

formalTradingReleaseReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

## 3. 人工审计必须挑战的问题

1. Draw.io 是否准确区分“自动化范围通过”“完整 PRD 未出门”和“正式交易未解锁”。
2. 投资工作流是否真实覆盖 Assets → Positions → 三类策略 → Backtest → DailyReviews → Operations，且没有删除专家页。
3. 16 项策略归属、截图纠错和最终 UX 语义确认是否仍为人工待验，而非被自动化代签。
4. `ScenarioComparisonService` 的 saved replay 是否被诚实区分于冻结策略逐日动态重算；不得把前者冒充 advice-level point-in-time simulation。
5. FTR-1..6 是否只形成 provisional 工程评审链；FTR-6 的 28 个 artifact 哈希通过不得解释为最终 release。
6. `wf-04` 失败结果是否继续保留，是否存在更换候选或阈值求绿。
7. 数据、benchmark、模型、风险、合规和 final review 的人工 gate 是否仍存在且不可由 Agent 写为 passed。
8. ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 是否在 ChatBox、页面、API、artifact 和运行态持续阻断。

## 4. 当前已知未完成项

以下内容必须保持未完成；它们是本轮完整 PRD 出门的真实阻断，不是文档遗漏：

```text
strategy_assignment_and_capture_correction_human_review=pending
pendingStrategyAssignmentCount=16
advice_level_point_in_time_dynamic_recompute=not_implemented
batchHumanReview=pending
manualSignoffPassed=false
finalFormalReleaseReviewPackageReady=false
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

自动化可声明的是“文档支撑范围通过并准备进入集中人工复核”，不能声明“PRD 全部完成”或“正式交易 release”。

## 5. 文件清单与 SHA-256

本文件不记录自身哈希，以避免自引用：

```text
88d6c1e79d068cd92cc17a887571b79f26356751fcc0ae8581d2e945603c3484  01_CURRENT_STAGE_STATE.json
85a7f55e7046911471f2024e63bd8b112508eb3fb8c2be73f7507e02de53b42e  02_DIVIDEND_LOW_VOL_PRD.md
268ba43b8be93ce95fee856d95b183ec116e531bf2854cbaff3b70c02d7c6bc3  03_DAILY_PORTFOLIO_REVIEW_PRD.md
1c4fb29deb465024b245c580aea00eaedaf97c6f178177844c81629e16bead4f  04_V2_PX_PRD.md
f1536636d3875fe6031312b1df938ca8acfde17f381e81214fdb9a743c2529fe  05_ARCHITECTURE_CURRENT_TARGET.md
36dbc8a24d5088c99b611a33be394a5b5aa365e77aa81a7bf907c55fec10d56d  06_TARGET_ARCHITECTURE_GAP.drawio
4f56e7a0f4af264286b5936de3998bb16898f7e301c725b34f153aa7dbba1470  07_READ_DRAWIO_OUTPUT.txt
97c162a20183cbbe0c0b2592d07db2a2253f9a370135f2888fa7e7f9794f4165  08_NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md
277165827f88f895745090f4388b4a078a9a2b2561ba8c664dc86947ea9dcd63  09_DEFERRED_HUMAN_ACCEPTANCE_EXECUTION_PLAN.md
9883162ba0399f5adaa32e428aac306acd7425ea6cfa9410d67e110162326780  10_PRD_COMPLETION_TRACEABILITY_MATRIX.md
20f786b3999307d6224af9770978201193666fe160c4566c6cb2bb8f584c7c4a  11_FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json
96efa3e9403c2e09933b757325537c15567049907d339c6c6cbbefbdb2a3fc3a  12_FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md
39c7a25ccf764fee63f2375484131071c5abe69893d81e89ccdded2be2fb6409  13_FORMAL_DATA_GOVERNANCE_CONTRACT.md
fb4572db5cbf84491d98f622db5fe075b538e106704cbc26a5af2a71a3136c39  14_BENCHMARK_ENUM_CONTRACT.md
032f522657aed36316223c082e7c51d7a0ede84ce4495a409088ea936f8ff5ba  15_FORMAL_VALIDATION_METRIC_DEFINITIONS.md
d517320721e4b159cfe2e7dd3b6b5ff17d198858cbc99cd29b2a3a8222cd23b3  16_TRADE_BOUNDARY_CONTRACT.md
d874fdc3856a4452a24c73864fc39cbb9453e819d9d3231f557c3297f6b206e7  17_INTERNAL_DOCUMENT_RISK_CLOSURE_AUDIT.md
bb68ad236ef0c65a955b00d1973902e86b47a67bf7bf5cde6d50ce8bc5c5316a  18_DEFERRED_HUMAN_REVIEW_QUEUE_SCHEMA.json
```

## 6. 期望输出

```text
reviewVerdict=PASS_AUTOMATED_SCOPE | CONDITIONAL_PASS | FAIL
automatedScopeStatus=PASS | FAIL
fullPrdExitStatus=BLOCKED | PASS
fatalIssueCount=<number>
majorIssueCount=<number>
drawioPageCount=8 | mismatch
architectureEntityFidelity=PASS | FAIL
prdTraceability=PASS | FAIL
visualEvidenceBoundaryDisclosure=PASS | FAIL
antiFalseGreenContract=PASS | FAIL
humanGateIntegrity=PASS | FAIL
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

发现 Fatal 或 Major 时，请给出文件、章节、触发场景、失败归属和可执行修订建议。若自动化范围通过但完整 PRD 仍有人工或产品缺口，请明确输出分层结论，禁止合并为全绿。
