# V2-PX Semantic Validator 计划

更新时间：2026-07-15

## 1. 目标

JSON Schema 只能证明报告结构合法，不能证明截图文件真实存在、哈希一致、Chrome 扩展真实加载或生命周期事件顺序正确。因此 PX-0 必须新增独立 semantic validator 计划，并在 PX-1 前实现对应验证器。

当前状态：

```text
semanticValidatorImplemented=false
semanticValidatorRequiredBeforePx1=true
px1CodeSpikeAllowed=false
```

## 2. Validator 必须校验的内容

| 类别 | 必须校验 |
| --- | --- |
| 文件证据 | screenshot / trace 路径存在、SHA-256 与文件内容一致、不是空文件 |
| Chrome 证据 | URL 必须为 `chrome-extension://` 或经批准的 host app URL；必须记录 Chrome version、extensionId、commitSha |
| 入口语义 | `entryContainer / entryAction / routeIntent / targetContainer` 组合必须在白名单内 |
| 生命周期 | sidepanel 与 Workspace Page 必须都有 start、resume、reconnect、close；事件时间顺序必须合法 |
| 路由关联 | 同一任务的三入口必须共享 routeId / correlationId，且 routePayload 语义一致 |
| 幂等 | duplicate ingest 必须使用 idempotencyKey 去重 |
| 状态一致 | container 状态字段必须能由 events 推导出来，不能只由报告自称 |
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
```

## 4. 负向 fixture 必须覆盖

```text
unknown routeIntent
entryContainer 与 audit source 矛盾
workspaceId/sourceId/operationId 类型错误
payload 携带 arbitrarySecret
screenshot 路径不存在
sha256 与文件不匹配
mode 自称 real_chrome 但 URL 不是 chrome-extension://
sidepanel 未 start 但状态写 started=true
Workspace Page 未 close 但状态写 closed=true
PX-2+ 在 PX-1 passed 前启动
```

## 5. 出门结论

只有 schema 校验和 semantic validator 同时通过，才允许声明：

```text
antiFalseGreenAcceptanceContractPassed=true
```

当前不得声明该字段为 true。

