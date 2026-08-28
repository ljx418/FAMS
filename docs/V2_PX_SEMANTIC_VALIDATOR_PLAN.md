# V2-PX Semantic Validator 计划

更新时间：2026-08-27

## 1. 目标

JSON Schema 只能证明报告结构合法，不能证明截图文件真实存在、哈希一致、Chrome 扩展真实加载或生命周期事件顺序正确。PX-0 已实现 current v2/v1 semantic validator；文档复审已冻结 target `intent-route/3`、`operation-command/2`，因此 PX-1 必须同步迁移 schema、validator、fixtures 和 runtime types，不能把 current validator 通过冒充 target runtime 合同通过。

当前状态：

```text
semanticValidatorImplemented=true
semanticValidatorTargetContract=current_v2_v1_only
targetContractMigrationImplemented=false
semanticValidatorRequiredBeforePx1=true
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
```

## 2. Validator 必须校验的内容

| 类别 | 必须校验 |
| --- | --- |
| 文件证据 | screenshot / trace 路径存在、SHA-256 与文件内容一致、不是空文件 |
| Chrome 证据 | URL 必须为 `chrome-extension://` 或经批准的 host app URL；必须记录 Chrome version、extensionId、extensionVersion、buildDigest、commitSha；target /2 恰好覆盖 360/420/768/1280，且记录图像实际像素尺寸/hash |
| 入口语义 | `entryContainer / entryAction / routeIntent / targetContainer` 组合必须在白名单内 |
| 生命周期 | sidepanel 与 Workspace Page 必须都有 start、resume、reconnect、close；事件时间顺序合法；eventType 只能来自运行时合同 §5.4 封闭集合；previous/next state 可推导 |
| 路由关联 | 同一业务对象的三入口共享 workspaceId/canonicalRouteKey/correlationId；每个新动作 routeId 独立，同一动作交接不得改写 |
| 路由/命令分离 | intent route 只导航；Ask question 只能存在于 operation command；Host 只能发送 intent route |
| 幂等 | duplicate query/ingest 使用 local dispatch ledger；同 key 同 digest 重放、不同 digest 拒绝、unknown 不自动 dispatch |
| 状态一致 | container 状态字段必须能由 events 推导出来，不能只由报告自称 |
| 存储失败 | 网络前 ledger 写失败必须证明请求数为 0；网络结果后的 completed 写失败必须为 unknown_result、禁止重发，且有 `storage_write_failed` event |
| CORS 切换 | allowed extension 通过；错误 extension、缺 allowlist、Host 3000 origin 被 route pre-handler 拒绝；切换记录存在且可回退 |
| false-green | 静态 mock HTML、无 trace 截图、documentation_stub_only 原型不得作为通过证据 |

## 3. PX-1 前置门槛

```text
semanticValidatorPlanReady=true
semanticValidatorImplemented=true
positiveFixturePassed=true
negativeFixtureFailed=true
fakeChromeEvidenceRejected=true
missingFileRejected=true
hashMismatchRejected=true
eventOrderMismatchRejected=true
arbitrarySecretRejected=true
prematurePx2Rejected=true
idempotencyConflictRejected=true
targetContractVersionDriftRejected=true
unknownDispatchSuccessRejected=true
port3000HostPermissionRejected=true
missingRequiredViewportRejected=true
duplicateViewportRejected=true
imageViewportSizeMismatchRejected=true
unknownLifecycleEventTypeRejected=true
storageWriteFailureAfterEffectRejectedAsSafeRetry=true
emptySidepanelDomRejected=true
corsAllowlistFallbackRejected=true
```

实现入口：

```text
backend/scripts/verify-v2-px-semantic-contract.ts
npm --prefix backend run test:v2-px-semantic-contract
docs/prototypes/v2-px/fixtures/semantic-contract-fixtures.json
```

当前验证器使用本仓库现有 Ajv 2020 执行 PX-0 基线检查。未来 PX1-02 必须增加 target v3/v2 的 3×3 矩阵、Ask route/command 分离、canonical/correlation/route 关系、dispatch ledger、4000/3000 权限和 unknown result 负例；在这些测试真实存在前，target migration 状态保持 false。

PX1-02 必须新增且不得用 current fixture 覆盖替代的文件：

```text
docs/prototypes/v2-px/fixtures/intent-route-v3.positive.json
docs/prototypes/v2-px/fixtures/intent-route-v3.negative.json
docs/prototypes/v2-px/fixtures/operation-command-v2.positive.json
docs/prototypes/v2-px/fixtures/operation-command-v2.negative.json
docs/prototypes/v2-px/fixtures/dual-container-lifecycle-v3.positive.json
docs/prototypes/v2-px/fixtures/dual-container-lifecycle-v3.negative.json
docs/prototypes/v2-px/fixtures/real-chrome-evidence-v2.positive.json
docs/prototypes/v2-px/fixtures/real-chrome-evidence-v2.negative.json
```

## 4. 负向 fixture 必须覆盖

```text
unknown routeIntent
entryContainer 与 audit source 矛盾
workspaceId/sourceId/operationId 类型错误
intent route ask 携带 question
Host App 发送 operation command
Host view_source 错误目标为 sidepanel
payload 携带 arbitrarySecret
screenshot 路径不存在
sha256 与文件不匹配
mode 自称 real_chrome 但 URL 不是 chrome-extension://
sidepanel 未 start 但状态写 started=true
Workspace Page 未 close 但状态写 closed=true
PX-2+ 在 PX-1 passed 前启动
同 key 不同 digest 仍发起后端请求
dispatched 未知结果被汇总为 success 或自动重试
optionalHostPermissions 包含端口 3000
Host App view_source 合法落到 workspace_page 却被拒绝
intent-route/3 view_source 从 Host 错误落到 sidepanel
Chrome evidence/2 少于四视口、重复视口或缺任一 360/420/768/1280
截图声明 viewport 与图像实际像素尺寸/hash 不一致
lifecycle/3 使用未登记 eventType，或把 disconnected/recovering/closed 当 eventType
events 少于场景必需最小事件却自报 derived result 通过
prepared/dispatched 持久化失败后仍发网络请求
后端结果已发生但 completed 持久化失败被写为 failed_before_effect 或触发自动重试
Side Panel 真实 extension 页面只有空 body/root/shell，没有摘要、时间、下一步和主动作
错误 extension、缺 allowlist 或 Host 3000 origin 借全局 CORS 进入 External Brain handler
```

## 5. 出门结论

当前 schema 校验和 semantic validator 的 PX-0 current v2/v1 正反例已经同时通过，允许声明：

```text
antiFalseGreenAcceptanceContractPassed=true
targetRuntimeContractValidationPassed=false
```

这只表示“验收合同可以拦截已知假绿”，不表示真实 Chrome 已运行，也不表示 PX-1 spike 通过：

```text
realChromeAcceptanceClaimed=false
px1SpikePassed=false
px2PlusProductionImplementationAllowed=false
```
