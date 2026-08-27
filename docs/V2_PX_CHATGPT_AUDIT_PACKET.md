# V2-PX 提交 ChatGPT 的独立文档审计说明

更新时间：2026-08-27

## 1. 审计目的

请只审查文档，不编写或修改代码。当前用户已认可 V2-PX draw.io 的开发方向，但尚未批准实际开发。

需要独立判断：

1. 当前 19 个文件能否在本地单用户范围内完整指导 PX-1～PX-6，而不迫使开发者自行决定关键产品/架构问题。
2. 开发完成后是否能满足 PRD 的 Side Panel、Workspace、Host App、五 intent、恢复、证据和反假绿体验。
3. 目标架构的实体、依赖、权限、状态、API、消息和业务事实所有权是否一致。
4. 分阶段计划是否在最早阶段验证高风险假设，是否存在“空壳先通过、集成后补”的假绿。
5. 验收是否具备用户场景、操作步骤、量化阈值、原始证据、失败归属和出门条件。

ChatGPT 的审查结论不是实施批准。无论结论如何，`implementationApprovalStatus` 均保持 pending，直到用户明确批准。

## 2. 当前内部结论（请质疑，不要直接采信）

```text
prdTraceability=20/20
decisionCompleteness=40/40
knownBlockingCrossDocumentConflicts=0
internalDocumentationAudit=PASS_FOR_EXTERNAL_AND_USER_REVIEW
targetIntentRoute=v2-px-intent-route/3 PLANNED_NOT_IMPLEMENTED
currentIntentRoute=v2-px-intent-route/2 PX0_BASELINE
targetOperationCommand=v2-px-operation-command/2 PLANNED_NOT_IMPLEMENTED
currentOperationCommand=v2-px-operation-command/1 PX0_BASELINE
targetLifecycleAudit=v2-px-dual-container-lifecycle/3 PLANNED_NOT_IMPLEMENTED
currentLifecycleAudit=v2-px-dual-container-lifecycle/2 PX0_BASELINE
targetRealChromeEvidence=v2-px-real-chrome-evidence/2 PLANNED_NOT_IMPLEMENTED
currentRealChromeEvidence=v2-px-real-chrome-evidence/1 PX0_BASELINE
targetAcceptanceManifestReport=/2 PLANNED_NOT_IMPLEMENTED
currentAcceptanceManifestReport=/1 PX0_BASELINE
px1PlusImplementation=0/20
realChromeEvidence=0
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
```

请重点查找内部作者可能遗漏的冲突，而不是只验证文件是否存在。

## 3. 剩余开发大纲

| 阶段 | 目标开发 | 关键出门 |
| --- | --- | --- |
| PX-1 | WXT/MV3 双容器 spike；target v3/v2 schema/validator/fixtures/types 原子迁移；4000 optional permission；真实 Chrome evidence | 六项 spike、合同迁移、权限/负例、真实 trace 全通过；否则 RETURN_TO_ADR |
| PX-2 | External Brain API/DTO/Read/Ask/Policy、FAMS adapter、Workspace 五视图垂直切片 | 五端点同源/错误/policy 合同，768/1280、六状态和刷新恢复 |
| PX-3 | Side Panel 轻入口、Quick Ask、Host bridge/button 三页面接入 | 360/420、1 秒 ack、最终摘要、Host fallback、缺扩展降级 |
| PX-4 | 三入口 router、canonical tab、24h dispatch ledger、at-most-once 与交易/隐私边界 | 20 次重复 tab=1；同 key dispatch=1；POST retry=0；订单请求=0 |
| PX-5 | Back/Forward/Refresh/重开/断连/suspend/reload/update、TTL/LRU/storage migration | 必测场景 100% 由事件推导，5 秒内进入 restored/recovering/blocked |
| PX-6 | G1～G7、四视口、可访问性、脱敏、JSON/HTML、人类 AC-PX-01～10 | 所有自动 gate 与负例通过，人工逐项完成；仅声明本地 productization candidate |

详细 work package 是计划文档第 13 节；不得用本表替代详细审查。

## 4. 必须重点攻击的风险

1. `intent-route/2` 当前规则和目标 v3 动作矩阵是否被正确识别为迁移，而非同时生效的两个真相。
2. Ask 是否真正与只读查询分离；是否仍有自动确认、自动重试、重复 Operation 或交易解锁路径。
3. `prepared -> dispatched -> completed/unknown` 是否足以防止 reload/timeout 导致重复副作用，用户体验是否诚实。
4. extension 对 4000 的 optional host permission、3000 的 external connect、backend extension allowlist、frontend extension ID 是否形成闭环。
5. WorkspaceState、session/local、TTL/LRU、unknown major、业务事实不复制是否无矛盾。
6. PX-2 是否确实是 API + Workspace 真实 read model 垂直切片，而非 mock 空壳出门。
7. 计划命令、证据路径、manifest/hash/commit 和真实 extension URL 是否足以阻断假绿。
8. current lifecycle/Chrome/acceptance schema 与 target 版本的分批迁移是否足够完整，是否仍可用“结构合法”冒充“体验已验收”。
9. Draw.io 8 页是否与 Markdown 同口径，能否判断当前/目标状态、规格漂移和出门风险。

## 5. 请输出的结论格式

请按以下格式返回，不要只给总分：

```text
总体结论=PASS | CONDITIONAL_PASS | FAIL
是否完整支撑PX1-PX6=YES | NO
是否存在阻断级文档冲突=YES | NO
是否建议批准进入PX1=YES | NO（只作建议，不改变用户门禁）
```

然后分别列出：

1. 阻断问题：文件、章节、冲突双方、为何会导致错误实现、唯一建议修订。
2. 高风险问题：最早验证阶段、失败信号、应打回哪个阶段/ADR。
3. PRD 体验覆盖：20 项中遗漏或不可验收的 requirement。
4. 架构一致性：current→target 实体、依赖、所有权、版本迁移和信任边界。
5. 验收真实性：可以假绿的路径及应补的负例。
6. Draw.io：重复、矛盾、抽象、无法判断状态或出门的内容。
7. 最终建议：文档可直接进入用户批准环节，还是必须继续文档开发。

没有发现问题时也必须说明检索过哪些风险，禁止只写“文档完整”。

## 6. 审计文件清单（19 个，禁止扩散到无关历史文档）

1. `docs/V2_PX_CHATGPT_AUDIT_PACKET.md`
2. `docs/V2_PX_PRD.md`
3. `docs/V2_PX_TARGET_ARCHITECTURE.md`
4. `docs/V2_PX_API_RUNTIME_CONTRACT.md`
5. `docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md`
6. `docs/V2_PX_PRD_TRACEABILITY_MATRIX.md`
7. `docs/prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md`
8. `docs/adr/ADR-2026-07-15-v2-px-route-a.md`
9. `docs/V2_PX_AUTHORITY_BASELINE.md`
10. `docs/v2-px-target-architecture-gap.drawio`
11. `docs/V2_PX_DOCUMENTATION_COVERAGE_REVIEW.md`
12. `docs/current-stage-state.json`
13. `docs/V2_PX_SEMANTIC_VALIDATOR_PLAN.md`
14. `docs/schemas/v2-px-intent-route.schema.json`
15. `docs/schemas/v2-px-operation-command.schema.json`
16. `docs/schemas/v2-px-dual-container-lifecycle.schema.json`
17. `docs/schemas/v2-px-real-chrome-evidence.schema.json`
18. `docs/schemas/v2-px-acceptance-manifest.schema.json`
19. `docs/schemas/v2-px-acceptance-report.schema.json`

现有 schema 文件用于证明 PX-0 当前基线，不代表目标 message、lifecycle、Chrome evidence 或 acceptance 版本已实现。请同时对照运行时合同第 10 节的分批迁移要求，检查这种 current/target 区分是否足够明确。

## 7. 待外部确认的内部审查结论

| 待确认结论 | 内部判断 | 外部审计应回答 |
| --- | --- | --- |
| 文档能完整支撑批准范围内开发 | YES | 是否仍有实现必须自行选择的阻断决策 |
| PRD 体验可在 M6 达成 | YES，需真实 Chrome/人工证据 | 哪些需求仍只有字段检查而非用户体验证据 |
| Route A.1 风险被最早阶段阻断 | YES | PX-1/PX-2 是否遗漏关键 feasibility 问题 |
| v2/v1→v3/v2 迁移可受控完成 | YES | schema/validator/fixtures/types 是否还有未列的耦合 |
| evidence/acceptance target 迁移可阻止结构假绿 | YES | producers/consumers/semantic validator 和人工场景是否仍有遗漏 |
| 4000/3000 权限边界闭环 | YES（本地范围） | 是否存在过宽 origin、伪身份或不可配置路径 |
| at-most-once 不会假装 exactly-once | YES | unknown_result 与人工重试是否仍可能被误用 |
| 验收能够阻断 mock/空壳/状态自报 | YES | 还有哪些缺失 artifact 仍可能被报告自称替代 |
| 当前可以进入用户批准审查 | YES，不能自动实施 | 是否需先继续文档修订 |

## 8. 当前禁止事项

```text
doNotImplementCode=true
doNotCreateExtensionPackage=true
doNotModifySchemasOrValidators=true
doNotRunPx1Spike=true
doNotChangeTradingLocks=true
doNotTreatChatGptPassAsUserApproval=true
```
