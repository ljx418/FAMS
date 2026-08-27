# V2-PX External Brain Productization 审计基线

更新时间：2026-08-27（PX-0 seal 复核）

> 历史基线说明：本文记录 PX-0 seal 时点的审计结论。2026-08-27 用户认可产品目标但要求先回到文档开发阶段；当前实施许可以 `V2_PX_DOCUMENTATION_COVERAGE_REVIEW.md`、`V2_PX_PRD.md` 和 `V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md` 为准。当前 `px1FeasibilitySpikeAllowed=false`，不得把本文的 `READY_FOR_SPIKE` 理解为已获代码开发授权。

## 1. 当前结论

```text
px0GithubReviewGate=PASS
routeAFatalArchitectureBlocker=none_found
fatalDocumentationBaselineIssueCount=0
majorIssueCountClosedAtPx0=6
majorIssueCountDeferredToPx1Plus=3
routeAStatus=ACCEPTED_FOR_SPIKE
routeAConceptualFeasibility=PASS
routeAImplementationReadiness=READY_FOR_SPIKE
prototypePrdAlignment=NOT_TESTABLE_UNTIL_PX1
prototypeGate=FAIL
schemaMetaValidation=PASS_6_OF_6
intentSchemaStructuralDefense=PASS
realChromeEvidenceStructuralDefense=PASS_CONTRACT_ONLY
lifecycleSchemaStructuralDefense=PASS_CONTRACT_ONLY
acceptanceManifestStructuralDefense=PASS
acceptanceReportStructuralDefense=PASS
semanticValidatorImplemented=true
px1PlanningAllowed=true
px1Allowed=false
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
px2PlusAllowed=false
v2PxComplete=NO_GO
pxCoreDomainPolicy=DOMAIN_NEUTRAL
famsTradingGateFieldsExcludedFromPxCoreSchema=true
```

PX-0 审计对象已提交到可复核本地分支，基线 SHA 为 `6e5fd81157c8eec081637b901351465332617f98`，因此 PX-0 合同门禁为 **PASS**。当前没有真实浏览器原型或证据，PX-1 尚未执行，V2-PX 仍为 No-Go。

## 2. Fatal 问题

未发现使 Route A 本质不可实现的架构障碍，原文档权威基线 Fatal 已关闭：

```text
fatalIssueCount=0
routeAArchitecturallyFeasible=true
fatalDocumentationBaselineIssueCount=0
```

说明：Route A 可以作为后续候选技术路线继续文档化和 spike 验证，但不能因为“可实现”直接进入生产开发。

## 2.1 Fatal 文档基线问题

| 编号 | 问题 | 影响 | 处置 |
| --- | --- | --- | --- |
| F-DOC-1 | 产品与代码仓权威基线未冻结 | 已关闭 | `docs/V2_PX_AUTHORITY_BASELINE.md` 已冻结为 FAMS，基线 SHA 可复核 |

## 3. Major 问题

| 编号 | 问题 | 当前影响 | PX-0 处置 |
| --- | --- | --- | --- |
| M1 | PX 审计对象未提交、无法按 commit 复核 | GitHub main 无法作为审计基线 | 必须提交 PX 文档、ADR、schemas、原型增量到可复核分支 |
| M2 | active V2 文档存在 pending / passed 状态漂移 | 人类无法判断哪些能力真实完成 | 必须建立状态词典和状态漂移 grep 合同 |
| M3 | 旧 V2 evidence 为静态 mock HTML 截图 | 不能作为真实 Chrome 证据 | 必须标记 legacy mock，不得计入 PX Chrome 验收 |
| M4 | 当前 WXT / background / sidepanel 尚无独立 Workspace Page 宿主与复用路由 | Route A 的双容器宿主未验证 | 必须先做受限 feasibility spike |
| M5 | 当前 GitHub 原型未覆盖 PX 三入口、路由 intent 和双容器生命周期 | 无法证明目标体验可达 | 必须补三入口、intent、生命周期的原型与验收合同 |
| M6 | Intent schema 的字段、枚举和 payload shape 已修复，但仍缺 action-intent-permission 白名单、navigation/operation 分离和跨入口语义 validator | 纯 schema 仍不能证明三入口语义等价或幂等安全 | 必须补 `dispatchId / correlationId / canonicalRouteKey / scenarioId` 和 semantic validator |
| M7 | Lifecycle schema 已要求两容器事件存在，但仍缺事件顺序、跨对象 ID 一致、原生 Side Panel 证明、reload/update 事件和文件真实性 validator | 报告仍可能在纯 schema 层 false-green | 必须补真实 Chrome evidence 字段、semantic validator 和 lifecycle 扩展事件 |
| M8 | PX-2..PX-6 与 G1..G7 只有文档草案，尚未形成可执行 validator 和真实 Chrome 证据 | 不能据此声明生产实现可开始或 V2-PX 可完成 | 必须在 PX-1 之后逐阶段补目标文件、命令、fixture、证据、阈值和回滚规则的可执行验证 |
| M9 | 缺少权威 V2-PX PRD 与 requirement traceability | 原型是否符合 PRD 当前不可验 | 必须补 `V2_PX_PRD.md` 和 `V2_PX_PRD_TRACEABILITY_MATRIX.md` |

## 4. PX-1 进入条件

只有以下条件全部满足，才允许进入受限 feasibility spike：

```text
pxDocsCommittedToReviewableBranch=true
authorityBaselineStatus=FROZEN
activeV2StatusDriftCount=0
routeAAdrStatus=ACCEPTED_FOR_SPIKE
routeAImplementationDetailsFrozen=true
antiFalseGreenAcceptanceContractPassed=true
legacyMockEvidenceExcluded=true
intentSchemaFalseGreenDefense=PASS
lifecycleSchemaFalseGreenDefense=PASS
operationCommandContractReady=true
semanticValidatorImplemented=true
prototypePrdTraceabilityPassed=true
humanReviewForPx1Start=true
```

PX-1 只允许做 feasibility spike，不允许进入生产实现。PX-1 输出必须能回答 Route A 是否能在真实浏览器环境里建立三入口、intent route、双容器生命周期和 Workspace Page 宿主。

## 5. PX-2+ 禁止提前进入

```text
px2PlusParallelImplementationAllowed=false
```

PX-2+ 必须等待 PX-1 六项 spike 全部通过。不得在 PX-1 之前并行实现生产能力、不得把静态原型截图当作真实 Chrome 双容器证据。

## 6. V2-PX 完成条件

当前 V2-PX 为 **No-Go**。以下字段是未来完成条件，不是当前状态：

```text
px6Completed=true
realDualContainerChromeAcceptancePassed=true
g1ToG7AllGreen=true
manualExperienceReviewPassed=true
falseGreenRiskClosed=true
```

## 7. 审计口径

废止旧结论：

```text
previousPx0PassConclusion=deprecated
previousMajorIssueCountZeroConclusion=deprecated
previousRouteAFrozenConclusion=deprecated
previousPrototypePrdAlignmentPassedConclusion=deprecated
```

允许声明：

```text
routeADocumentationCanProceed=true
px0AuditBaselineRecorded=true
px1FeasibilitySpikeMayBePlanned=true
px1PlanningAllowed=true
```

禁止声明：

```text
px1SpikePassed 不得为 true
px2ProductionImplementationReady 不得为 true
v2PxComplete 不得为 true
realChromeEvidencePassed 不得为 true
```

## 8. 下一步

1. 对 PX-1 受限 feasibility spike 做单独启动确认。
2. 只创建 spike 包与最小 entrypoint，不进入 PX-2+ 生产功能。
3. 使用 Playwright + Chrome CDP headless 采集真实 unpacked extension 证据。
4. 让 semantic validator 校验 screenshot/trace/event log 文件、哈希、URL 和生命周期。
5. 六项 spike 与人工核查未全部通过前，保持 `px2PlusAllowed=false`。
