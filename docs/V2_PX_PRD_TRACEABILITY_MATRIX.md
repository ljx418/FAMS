# V2-PX PRD 需求追踪矩阵

更新时间：2026-08-29

## 1. 当前结论

```text
traceabilityMatrixReady=DOCUMENTATION_20_OF_20
runtimeDecisionChecks=40/40
implementationMappingStatus=PX1_PX2_WORKSPACE_SLICE_ACCEPTED_NEXT_SIDEPANEL_HOST_ENTRY_AUDIT
prototypeDesignCoverage=WORKSPACE_INTERACTIVE_SIDEPANEL_HOST_PARTIAL
realChromeEvidencePresent=true
px1FeasibilitySpikeAllowed=true
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
externalIndependentAuditStatus=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_INTERNAL_REAUDIT_PASSED
```

本矩阵覆盖 PRD 的 20 项需求。目标文件、测试和证据凡标记“计划”的都尚不存在，不能因为出现在矩阵中就声明已实现。

## 2. 追踪矩阵

| Requirement | 目标体验/原型 | 目标代码实体 | 阶段 | 计划自动验收 | 计划证据 | 人类核查 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PX-REQ-001 三入口 | Side Panel / Workspace / FAMS 页面均能进入同一任务 | `background.ts`、`pxExternalBrainBridge.ts`、`WorkspaceApp.tsx` | PX-1/PX-4 | `test:v2-px-entry-matrix` | `entry_matrix_audit.json` | 三入口是否真实可见 | 文档完成，代码未开发 |
| PX-REQ-002 三动作 | 按入口查看来源、打开工作台、在工作台定位；Host view_source→Workspace | `intentRoute/3`、`intentRouter.ts`、`OpenInExternalBrainButton.tsx` | PX-1/PX-4 | extension `test:contracts/test:router` | `entry_action_audit.json` | 3×3 目标容器与文案是否清晰 | 目标合同已冻结；当前 v2 待 PX-1 迁移 |
| PX-REQ-003 五 intent | 来源库/详情/问答/追踪/图谱；Ask 导航与提交分离 | `WorkspaceApp.tsx`、五个 View、Read/Ask services | PX-1/PX-2/PX-4 | backend API contract + extension router | PX3 Chrome evidence | 五类结果是否与名称一致 | Workspace 五视图真实 Chrome 5/5；跨三入口矩阵待 PX4 |
| PX-REQ-004 轻量 Side Panel | 首屏摘要、连接、打开工作台 | `SidePanelApp.tsx`、`ConnectionGate.tsx` | PX-3 | `test:v2-px-sidepanel-entry` | `mobile_360/420_sidepanel.png` | 是否避免完整工作台挤压 | 原型文档完成，代码未开发 |
| PX-REQ-005 完整 Workspace | 五视图、摘要、证据抽屉 | `WorkspaceApp.tsx` | PX-2 | `test:workspace` + `verify:workspace-chrome` | PX3 768/1280 截图与 trace | 是否完整且易读 | 自动化 PASS；正式权限点击与最终人类体验待验收 |
| PX-REQ-006 标签复用 | canonical URL 忽略 view/ref，重复打开聚焦既有 tab | `workspaceTabManager.ts` | PX-1/PX-4 | extension `test:px1-spike/test:router` | `multi_window_tab_reuse_trace.json` | 多窗口聚焦是否符合预期 | 规则已冻结，代码未开发 |
| PX-REQ-007 刷新恢复 | Back/Forward/Refresh/关闭重开 | `workspaceStateStore.ts`、`RecoveryBanner.tsx` | PX-2/PX-5 | `test:v2-px-recovery` | `workspace_recovery_audit.json` | 恢复或阻断是否可理解 | 文档完成，代码未开发 |
| PX-REQ-008 断连重连 | FAMS/extension 中断后恢复 | `lifecycleAuditStore.ts`、`FamsApiClient.ts` | PX-1/PX-5 | `test:v2-px-reconnect` | `reconnect_event_log.json` | 5 秒内是否给结果 | 文档完成，代码未开发 |
| PX-REQ-009 幂等 | 先写/回读 local ledger；同 key 重放、冲突拒绝、未知结果不自动 dispatch；storage 失败按副作用前后分流 | `idempotencyRegistry.ts`、operation-command/2 | PX-1/PX-4 | extension contracts/storage fault + real Ask | PX3 tests/network；后续 reload audit | 重复/超时/结果后写失败是否无隐式副作用和安全重试假象 | Ask 切片已实现且真实 POST=1；完整跨 reload/三入口矩阵待 PX4 |
| PX-REQ-010 真实 Chrome | unpacked extension URL/ID/version/build、恰好四视口、实际像素尺寸/hash、trace/network/console | collector + target Chrome evidence/2 | PX-1/PX-6 | extension `verify:real-chrome`，少项/重复/尺寸不符负例 | `real_chrome_evidence.json` | URL/ID/四视口/manifest 是否真实 | current v1 已开发；target v2/真实证据未开发 |
| PX-REQ-011 四视口 | 360/420/768/1280 | 两个容器 UI | PX-2/PX-3/PX-6 | `test:v2-px-viewports` | 四张截图 + overflow audit | 遮挡、溢出、字号是否合格 | 原型文档完成，代码未开发 |
| PX-REQ-012 隐私脱敏 | 证据无 secret/cookie/账户原图 | evidence collector + sanitizer | PX-1/PX-6 | `test:v2-px-evidence-redaction` | `redaction_audit.json` | 私有目录是否被 Git 忽略 | schema 有约束；runtime 未开发 |
| PX-REQ-013 FAMS 适配 | Read/Ask 分离，五 intent 复用现有业务事实 | `externalBrainReadService.ts`、`externalBrainAskService.ts`、Policy、Adapter | PX-2/PX-4 | backend API/policy + adapter contract | PX2 API + PX3 Chrome/DB evidence | 与原 FAMS 对象同源且无自动确认 | Read/Ask/五端点/Adapter 已实现并由真实 DB/API/DOM 重签 |
| PX-REQ-014 单写状态 | background 拥有 route/lifecycle；session/local/TTL/migration 与 lifecycle/3 eventType 明确 | `background.ts`、Stores、`workspaceStateMigrator.ts` | PX-1/PX-5 | extension storage/lifecycle；后续完整 lifecycle | PX3 storage/Chrome；PX5 待生成 | 三入口是否无状态打架/静默清空 | Background 单写基础已实现；三入口竞争、TTL/reload 完整验收待 PX4/PX5 |
| PX-REQ-015 最小权限 | optional host 只含 4000；3000 只 external connect；每次 API 请求带公开 extension ID header；无 Origin+allowlist ID 才放行，Web Origin+伪造 ID拒绝 | `wxt.config.ts`、ConnectionGate、`FamsApiClient.ts`、Policy | PX-1/PX-2/PX-3 | manifest/network/policy/CORS switch + caller identity matrix | PX3 policy/API/Chrome network | 安装/连接/切换文案是否透明且无 Web Origin/缺 header 旁路 | 方案 A 已实现并由真实 Chrome 重签；正式 permission 弹窗点击待最终人类验收 |
| PX-REQ-016 摘要分层 | 普通话摘要 + 折叠 evidence | `WorkspaceApp.tsx`、Side Panel 摘要 | PX-2/PX-3 | workspace + 后续 sidepanel hierarchy | PX3 Workspace 截图；Side Panel 待生成 | 用户是否无需读原始字段 | Workspace PASS；Side Panel 业务摘要待下一子阶段 |
| PX-REQ-017 降级状态 | 未连接/加载/正常/空/失败/恢复/阻断映射十种 lifecycle state；closed 不渲染活动 UI | Workspace state UI、ConnectionGate、Recovery | PX-2/PX-3/PX-5 | workspace state + 后续 lifecycle matrix | PX3 DOM/Chrome；PX5 待生成 | 六种异常/过渡状态是否都有下一步，正常态是否无冲突 | Workspace 切片状态诚实；完整生命周期矩阵待 PX5 |
| PX-REQ-018 交易硬边界 | 无订单入口、四锁恒 false | `externalBrainPolicyService.ts`、`FamsDomainAdapter.ts` | 全阶段 | policy/API/Chrome trade monitors | PX2/PX3 evidence | 页面是否存在误导交易动作 | PX Adapter 与真实 Chrome PASS；broker/order/Transaction 变更=0，四锁=false |
| PX-REQ-019 可访问性 | 键盘、对比度、点击区、无溢出 | Side Panel/Workspace UI | PX-2/PX-3/PX-6 | `test:v2-px-accessibility` | `accessibility_audit.json` | 键盘走完整核心路径 | 原型门槛完成，代码未开发 |
| PX-REQ-020 防规格漂移 | PRD/运行时合同/实体/阶段/证据/commit 一致 | semantic validator + target acceptance manifest/report/2 | PX-0/PX-1/PX-6 | 分批 contract migration + extension `verify:acceptance` | `g1_g7_gate_audit.json` | 按 commit、AC01～10 和目标版本复核 | PX-0 历史合同已开发；target evidence/acceptance 未开发 |

## 3. 当前代码实体状态总计

```text
existingReusableFamsEntities=16
existingPxContractOrValidatorEntities=IMPLEMENTED_TARGET_VERSIONS
targetEntitiesRequiringModification=SIDEPANEL_HOST_RECOVERY_ACCEPTANCE_REMAIN
targetProductionEntitiesNotDeveloped=SIDE_PANEL_HOST_BRIDGE_FULL_RECOVERY_FINAL_ACCEPTANCE
realChromeEvidenceArtifacts=PX1_AND_PX3_PRIVATE_EVIDENCE_PRESENT
implementedPx1PlusRequirements=SEE_ROW_LEVEL_PARTIAL_STATUS
documentationMappedRequirements=20/20
documentationDecisionChecks=40/40
```

## 4. 规格漂移检查

以下规则用于审查未来实现：

1. 任何新增生产文件必须能映射到本矩阵中的目标实体；无法映射则先改 PRD/架构并重新批准。
2. 五 intent 不得被替换成含义不同的页面标签却仍宣称通过。
3. Side Panel 不得膨胀成完整工作台；Workspace 不得退化为纯跳转页。
4. FAMS adapter 不得复制投资计算或绕过现有业务服务。
5. 未产生真实 Chrome evidence 前，PX-REQ-010 保持未实现。
6. 自动验收通过不能代替最终人类体验核查。
7. 所有“计划命令”只有在 package script 和测试实体真实存在后才能计入完成率。
8. 当前 `intent-route/2`、`operation-command/1` 只能称为 PX-0 历史基线；没有完成目标 v3/v2 原子迁移前不得声称 runtime contract ready。
9. 三入口相同动作要求 canonicalRouteKey/correlation 一致，不要求不同动作的 routeId 相同。

## 5. 当前阻断

```text
interactivePrototypePresent=true
extensionPackagePresent=true
implementationFileMappingPresentInDocs=true
px1BrowserTestsImplemented=true
realChromeEvidencePresent=true
targetRuntimeContractImplemented=PARTIAL_THROUGH_WORKSPACE_SLICE
explicitUserApprovalForImplementation=true
```

PX1 技术基座、External Brain API、方案 A caller policy、Adapter 与 Workspace 五视图已经通过真实 Chrome/DB/API/LLM 和 PRD 阶段复核。Side Panel 业务体验、Host Bridge、跨入口完整幂等、恢复和最终验收仍不得提前声明完成。
